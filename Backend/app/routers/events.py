"""POST /api/v1/events (ingestion) and GET /api/v1/events (history)."""

import logging
import sqlite3
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status

from app import database
from app.config import Settings
from app.deps import (
    TimeRange,
    get_db,
    get_manager,
    get_settings,
    get_time_range,
    require_ingest_key,
)
from app.schemas import (
    Direction,
    EventCreatedResponse,
    EventIn,
    EventOut,
    EventPage,
    PersonCountEventMessage,
)
from app.websocket import ConnectionManager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["events"])


@router.post(
    "/events",
    status_code=status.HTTP_201_CREATED,
    response_model=EventCreatedResponse,
    dependencies=[Depends(require_ingest_key)],
    responses={
        409: {"description": "Duplicate event"},
        422: {"description": "Invalid request data"},
        500: {"description": "Database or server failure"},
    },
)
def create_event(
    event: EventIn,
    background_tasks: BackgroundTasks,
    conn: sqlite3.Connection = Depends(get_db),
    manager: ConnectionManager = Depends(get_manager),
) -> EventCreatedResponse:
    record = event.model_dump()

    try:
        database.insert_event(conn, record)
    except database.DuplicateEventError:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Event already exists")
    except sqlite3.Error:
        logger.exception("Failed to store event %s", event.event_id)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to store event")

    # Only reached after a successful commit, so failed writes are never broadcast.
    # Runs after the response is sent, so slow WebSocket clients don't delay the AI Engine.
    message = PersonCountEventMessage(data=EventOut(**record))
    background_tasks.add_task(manager.broadcast, message.model_dump())

    return EventCreatedResponse(event_id=event.event_id)


@router.get("/events", response_model=EventPage)
def list_events(
    limit: Optional[int] = Query(default=None, ge=1, description="Maximum number of events"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    direction: Optional[Direction] = Query(default=None, description="ENTRY or EXIT"),
    camera_id: Optional[str] = Query(default=None, min_length=1, max_length=64),
    track_id: Optional[int] = Query(default=None, ge=0),
    time_range: TimeRange = Depends(get_time_range),
    conn: sqlite3.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> EventPage:
    if limit is None:
        limit = settings.default_page_size
    if limit > settings.max_page_size:
        raise HTTPException(
            422,
            detail=f"limit must be at most {settings.max_page_size}",
        )

    items, total = database.list_events(
        conn,
        limit=limit,
        offset=offset,
        direction=direction,
        camera_id=camera_id,
        track_id=track_id,
        start=time_range.start,
        end=time_range.end,
    )
    return EventPage(items=items, total=total, limit=limit, offset=offset)
