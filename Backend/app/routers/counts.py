"""GET /api/v1/counts."""

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app import database
from app.deps import TimeRange, get_db, get_time_range
from app.schemas import CountsResponse

router = APIRouter(prefix="/api/v1", tags=["counts"])


@router.get("/counts", response_model=CountsResponse)
def get_counts(
    camera_id: Optional[str] = Query(default=None, min_length=1, max_length=64),
    time_range: TimeRange = Depends(get_time_range),
    conn: sqlite3.Connection = Depends(get_db),
) -> CountsResponse:
    # current_occupancy = total_entries - total_exits (contract v1.0, section 7),
    # computed over the requested window. Without from/to, counts are all-time.
    # For daily counts, pass the store's local midnight, e.g.
    #   ?from=2026-10-01T00:00:00+05:30&to=2026-10-02T00:00:00+05:30
    return CountsResponse(**database.get_counts(conn, start=time_range.start, end=time_range.end, camera_id=camera_id))
