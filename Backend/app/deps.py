"""Shared FastAPI dependencies."""

import secrets
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Optional

from fastapi import Header, HTTPException, Query, Request, status
from pydantic import AwareDatetime

from app import database
from app.config import Settings
from app.schemas import to_utc_string
from app.websocket import ConnectionManager


@dataclass(frozen=True)
class TimeRange:
    """Normalized UTC bounds, in the same string format as stored timestamps."""

    start: Optional[str]
    end: Optional[str]


def get_time_range(
    start: Optional[AwareDatetime] = Query(
        default=None, alias="from", description="Start timestamp (inclusive), ISO 8601"
    ),
    end: Optional[AwareDatetime] = Query(
        default=None, alias="to", description="End timestamp (exclusive), ISO 8601"
    ),
) -> TimeRange:
    if start is not None and end is not None and start >= end:
        raise HTTPException(
            422, detail="'from' must be earlier than 'to'"
        )
    return TimeRange(
        start=to_utc_string(start) if start else None,
        end=to_utc_string(end) if end else None,
    )


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_manager(request: Request) -> ConnectionManager:
    return request.app.state.manager


def get_db(request: Request) -> Iterator[sqlite3.Connection]:
    conn = database.connect(request.app.state.settings.db_path)
    try:
        yield conn
    finally:
        conn.close()


def is_valid_ingest_key(settings: Settings, provided: Optional[str]) -> bool:
    expected = settings.ingest_api_key
    if not expected:
        return True
    return provided is not None and secrets.compare_digest(provided, expected)


def require_ingest_key(
    request: Request, x_api_key: Optional[str] = Header(default=None)
) -> None:
    if not is_valid_ingest_key(request.app.state.settings, x_api_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing API key")
