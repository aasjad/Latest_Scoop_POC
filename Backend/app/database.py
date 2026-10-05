"""SQLite access. FastAPI is the only component that touches the database."""

import sqlite3
from typing import Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS person_count_events (
    event_id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL,
    track_id INTEGER NOT NULL,
    direction TEXT NOT NULL
        CHECK (direction IN ('ENTRY', 'EXIT')),
    timestamp TEXT NOT NULL
);

-- Supports newest-first listing and time-range filters.
CREATE INDEX IF NOT EXISTS idx_events_timestamp
    ON person_count_events (timestamp);

-- Supports direction filters and count aggregation.
CREATE INDEX IF NOT EXISTS idx_events_direction_timestamp
    ON person_count_events (direction, timestamp);

-- Camera configuration, so it survives a backend restart. Live status (FPS,
-- online/offline, active tracks) is NOT stored: it comes from Vision heartbeats.
-- `source` never contains credentials (they are stripped before storing).
CREATE TABLE IF NOT EXISTS cameras (
    camera_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    resolution TEXT,
    line_json TEXT,                  -- {"p1": {"x","y"}, "p2": {"x","y"}}, normalized 0..1
    entry_direction TEXT CHECK (entry_direction IN ('A_TO_B', 'B_TO_A')),
    detection_confidence REAL,
    capacity INTEGER,
    last_seen TEXT                   -- last heartbeat, UTC ISO 8601
);
"""

CAMERA_COLUMNS = (
    "camera_id, name, location, source, resolution, line_json, "
    "entry_direction, detection_confidence, capacity, last_seen"
)

EVENT_COLUMNS = "event_id, camera_id, track_id, direction, timestamp"


class DuplicateEventError(Exception):
    """Raised when an event_id already exists."""


def connect(db_path: str) -> sqlite3.Connection:
    # check_same_thread=False: FastAPI may open the connection in one worker thread
    # and use it in another within the same request. Each request gets its own connection.
    conn = sqlite3.connect(db_path, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


def init_db(db_path: str) -> None:
    conn = connect(db_path)
    try:
        # WAL lets the dashboard read while the AI Engine is writing.
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def insert_event(conn: sqlite3.Connection, event: dict) -> None:
    try:
        with conn:  # commits on success, rolls back on error
            conn.execute(
                f"INSERT INTO person_count_events ({EVENT_COLUMNS}) "
                "VALUES (:event_id, :camera_id, :track_id, :direction, :timestamp)",
                event,
            )
    except sqlite3.IntegrityError as exc:
        if "UNIQUE" in str(exc) or "PRIMARY KEY" in str(exc):
            raise DuplicateEventError(event["event_id"]) from exc
        raise


def _build_filters(
    direction: Optional[str],
    start: Optional[str],
    end: Optional[str],
    camera_id: Optional[str] = None,
    track_id: Optional[int] = None,
) -> tuple[str, dict]:
    clauses, params = [], {}
    if camera_id is not None:
        clauses.append("camera_id = :camera_id")
        params["camera_id"] = camera_id
    if track_id is not None:
        clauses.append("track_id = :track_id")
        params["track_id"] = track_id
    if direction is not None:
        clauses.append("direction = :direction")
        params["direction"] = direction
    if start is not None:
        clauses.append("timestamp >= :start")
        params["start"] = start
    if end is not None:
        clauses.append("timestamp < :end")
        params["end"] = end
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return where, params


def list_events(
    conn: sqlite3.Connection,
    *,
    limit: int,
    offset: int,
    direction: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    camera_id: Optional[str] = None,
    track_id: Optional[int] = None,
) -> tuple[list[dict], int]:
    where, params = _build_filters(direction, start, end, camera_id, track_id)
    total = conn.execute(
        f"SELECT COUNT(*) FROM person_count_events {where}", params
    ).fetchone()[0]
    # rowid breaks ties between events in the same second, keeping insertion order.
    rows = conn.execute(
        f"SELECT {EVENT_COLUMNS} FROM person_count_events {where} "
        "ORDER BY timestamp DESC, rowid DESC LIMIT :limit OFFSET :offset",
        {**params, "limit": limit, "offset": offset},
    ).fetchall()
    return [dict(row) for row in rows], total


def get_counts(
    conn: sqlite3.Connection,
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    camera_id: Optional[str] = None,
) -> dict:
    where, params = _build_filters(None, start, end, camera_id)
    row = conn.execute(
        "SELECT "
        "  COALESCE(SUM(direction = 'ENTRY'), 0) AS total_entries, "
        "  COALESCE(SUM(direction = 'EXIT'), 0) AS total_exits "
        f"FROM person_count_events {where}",
        params,
    ).fetchone()
    entries, exits = row["total_entries"], row["total_exits"]
    return {
        "total_entries": entries,
        "total_exits": exits,
        "current_occupancy": entries - exits,
    }


def ping(conn: sqlite3.Connection) -> None:
    conn.execute("SELECT 1").fetchone()


def upsert_camera(conn: sqlite3.Connection, camera: dict) -> None:
    with conn:
        conn.execute(
            f"INSERT INTO cameras ({CAMERA_COLUMNS}) VALUES (:camera_id, :name, :location, :source, "
            ":resolution, :line_json, :entry_direction, :detection_confidence, :capacity, :last_seen) "
            "ON CONFLICT(camera_id) DO UPDATE SET name=excluded.name, location=excluded.location, "
            "source=excluded.source, resolution=excluded.resolution, line_json=excluded.line_json, "
            "entry_direction=excluded.entry_direction, detection_confidence=excluded.detection_confidence, "
            "capacity=excluded.capacity, last_seen=excluded.last_seen",
            camera,
        )


def list_cameras(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(f"SELECT {CAMERA_COLUMNS} FROM cameras ORDER BY camera_id").fetchall()
    return [dict(row) for row in rows]
