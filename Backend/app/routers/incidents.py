"""Incident CRUD, statistics and snapshot images.

POST   /api/v1/incidents             Vision server reports an incident
GET    /api/v1/incidents             list, filterable, newest first
GET    /api/v1/incidents/count       totals per severity, status and event type
GET    /api/v1/incidents/{id}        one incident
PUT    /api/v1/incidents/{id}        change status / severity / description
DELETE /api/v1/incidents/{id}        remove the incident and its snapshot
GET    /api/v1/incidents/{id}/image  the snapshot as JPEG

Storage goes through the project's db.py; images stay on disk under
Settings.incident_images_dir and only their relative path is stored.
"""

import logging
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Optional, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse

from app.config import PROJECT_ROOT, Settings
from app.deps import get_settings, require_ingest_key
from app.incident_store import incident_db
from app.schemas import (
    EVENT_TYPE_PATTERN,
    IncidentCounts,
    IncidentIn,
    IncidentOut,
    IncidentPage,
    IncidentStatus,
    IncidentUpdate,
    Severity,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/incidents", tags=["incidents"])

T = TypeVar("T")


def _run_db(action: str, fn: Callable[..., T], *args, **kwargs) -> T:
    """Call db.py, turning a database failure into a logged HTTP 500."""
    try:
        return fn(*args, **kwargs)
    except sqlite3.Error:
        logger.exception("Database error while trying to %s", action)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to {action}")


def _to_out(row: dict) -> IncidentOut:
    image_url = f"{router.prefix}/{row['id']}/image" if row.get("image_path") else None
    return IncidentOut(**row, image_url=image_url)


def _get_or_404(incident_id: int) -> dict:
    row = _run_db("load incident", incident_db.get_incident_by_id, incident_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Incident {incident_id} not found")
    return row


def _resolve_image(settings: Settings, image_path: str) -> Optional[Path]:
    """Absolute path of a stored image_path, or None if it is outside the images folder.

    Relative paths are resolved against the project root. Anything that lands
    outside incident_images_dir (absolute paths elsewhere, "..", etc.) is refused,
    so a stored path can never be used to read arbitrary files.
    """
    images_dir = Path(settings.incident_images_dir).resolve()
    candidate = Path(image_path)
    if not candidate.is_absolute():
        candidate = PROJECT_ROOT / candidate
    candidate = candidate.resolve()
    return candidate if candidate.is_relative_to(images_dir) else None


def _normalize_image_path(settings: Settings, image_path: str) -> str:
    resolved = _resolve_image(settings, image_path)
    if resolved is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="image_path must point inside the incident images folder",
        )
    # Store a portable, project-relative path (never a raw Windows path) when possible.
    try:
        return resolved.relative_to(PROJECT_ROOT.resolve()).as_posix()
    except ValueError:
        return resolved.as_posix()


# --- Vision -> Backend -------------------------------------------------------


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=IncidentOut,
    dependencies=[Depends(require_ingest_key)],
    responses={
        400: {"description": "image_path outside the images folder"},
        422: {"description": "Invalid incident data"},
        500: {"description": "Database failure"},
    },
)
def create_incident(incident: IncidentIn, settings: Settings = Depends(get_settings)) -> IncidentOut:
    record = incident.model_dump()
    if record["image_path"]:
        record["image_path"] = _normalize_image_path(settings, record["image_path"])

    incident_id = _run_db("store incident", incident_db.create_incident, **record)
    logger.info(
        "Incident %s stored: %s/%s camera=%s person=%s",
        incident_id, record["event_type"], record["severity"], record["camera_id"], record["person_id"],
    )
    return _to_out(_get_or_404(incident_id))


# --- Dashboard ---------------------------------------------------------------


@router.get("", response_model=IncidentPage)
def list_incidents(
    camera_id: Optional[str] = Query(default=None),
    severity: Optional[Severity] = Query(default=None),
    status_: Optional[IncidentStatus] = Query(default=None, alias="status"),
    event_type: Optional[str] = Query(default=None, pattern=EVENT_TYPE_PATTERN),
    limit: Optional[int] = Query(default=None, ge=1, description="Maximum number of incidents"),
    offset: int = Query(default=0, ge=0),
    settings: Settings = Depends(get_settings),
) -> IncidentPage:
    if limit is None:
        limit = settings.default_page_size
    if limit > settings.max_page_size:
        raise HTTPException(422, detail=f"limit must be at most {settings.max_page_size}")

    filters = dict(camera_id=camera_id, severity=severity, status=status_, event_type=event_type)
    rows = _run_db("list incidents", incident_db.get_incidents, **filters, limit=limit, offset=offset)
    total = _run_db("count incidents", incident_db.get_incident_count, **filters)
    return IncidentPage(items=[_to_out(r) for r in rows], total=total, limit=limit, offset=offset)


# Declared before /{incident_id} so "count" is not read as an id.
@router.get("/count", response_model=IncidentCounts)
def count_incidents(
    camera_id: Optional[str] = Query(default=None),
    event_type: Optional[str] = Query(default=None, pattern=EVENT_TYPE_PATTERN),
) -> IncidentCounts:
    filters = dict(camera_id=camera_id, event_type=event_type)
    return IncidentCounts(
        total=_run_db("count incidents", incident_db.get_incident_count, **filters),
        by_severity=_run_db("count incidents", incident_db.get_incident_breakdown, "severity", **filters),
        by_status=_run_db("count incidents", incident_db.get_incident_breakdown, "status", **filters),
        by_event_type=_run_db("count incidents", incident_db.get_incident_breakdown, "event_type", **filters),
    )


@router.get("/{incident_id}", response_model=IncidentOut, responses={404: {"description": "Not found"}})
def get_incident(incident_id: int) -> IncidentOut:
    return _to_out(_get_or_404(incident_id))


@router.put(
    "/{incident_id}",
    response_model=IncidentOut,
    responses={400: {"description": "Nothing to update"}, 404: {"description": "Not found"}},
)
def update_incident(incident_id: int, changes: IncidentUpdate) -> IncidentOut:
    fields = changes.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Provide at least one of status, severity, description"
        )
    _get_or_404(incident_id)
    _run_db("update incident", incident_db.update_incident, incident_id, **fields)
    logger.info("Incident %s updated: %s", incident_id, fields)
    return _to_out(_get_or_404(incident_id))


@router.delete(
    "/{incident_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"description": "Not found"}},
)
def delete_incident(incident_id: int, settings: Settings = Depends(get_settings)) -> Response:
    row = _get_or_404(incident_id)
    _run_db("delete incident", incident_db.delete_incident, incident_id)

    # The snapshot belongs to the incident, so it goes too. A failure here is
    # logged but does not undo the delete.
    if row["image_path"]:
        image = _resolve_image(settings, row["image_path"])
        if image is not None:
            try:
                image.unlink(missing_ok=True)
            except OSError:
                logger.exception("Incident %s deleted but its image %s could not be removed", incident_id, image)

    logger.info("Incident %s deleted", incident_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{incident_id}/image",
    response_class=FileResponse,
    responses={
        200: {"content": {"image/jpeg": {}}},
        404: {"description": "Incident or image not found"},
    },
)
def get_incident_image(incident_id: int, settings: Settings = Depends(get_settings)) -> FileResponse:
    row = _get_or_404(incident_id)
    image = _resolve_image(settings, row["image_path"]) if row["image_path"] else None
    if image is None or not image.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Incident {incident_id} has no image")
    return FileResponse(image, headers={"Cache-Control": "private, max-age=3600"})
