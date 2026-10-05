"""Runtime configuration, read from environment variables."""

import os
from dataclasses import dataclass, field
from pathlib import Path

# The folder holding Backend/, vision/, Frontend/, DB/ and db.py.
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    # Path to the SQLite database file.
    db_path: str = field(default_factory=lambda: os.getenv("SCOOP_DB_PATH", "latest_scoop.db"))

    # Incidents live in their own SQLite file, managed by the project's db.py.
    incidents_db_path: str = field(
        default_factory=lambda: os.getenv("INCIDENTS_DB_PATH", str(PROJECT_ROOT / "DB" / "incidents.db"))
    )

    # Folder the Vision server saves incident snapshots into. Only files inside
    # it are ever served by GET /api/v1/incidents/{id}/image.
    incident_images_dir: str = field(
        default_factory=lambda: os.getenv(
            "INCIDENT_IMAGES_DIR", str(PROJECT_ROOT / "incidents" / "images")
        )
    )

    # Origins allowed to call the API from a browser (the Vite dev server, port 5173).
    cors_origins: list[str] = field(
        default_factory=lambda: _split_csv(
            os.getenv("SCOOP_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
        )
    )

    # Optional shared secret for POST /api/v1/events. When empty, ingestion is open
    # (matches contract v1.0). When set, the AI Engine must send it as `X-API-Key`.
    ingest_api_key: str = field(default_factory=lambda: os.getenv("SCOOP_INGEST_API_KEY", ""))

    # Largest JPEG frame accepted from the AI Engine on the video ingest socket.
    max_frame_bytes: int = field(
        default_factory=lambda: int(os.getenv("SCOOP_MAX_FRAME_BYTES", str(2 * 1024 * 1024)))
    )

    # Pagination bounds for GET /api/v1/events and /api/v1/incidents. The
    # dashboard charts pull a whole range of events in one request (up to
    # 50000, see SERIES_FETCH_LIMIT in the frontend), so the cap matches that.
    default_page_size: int = 50
    max_page_size: int = field(default_factory=lambda: int(os.getenv("SCOOP_MAX_PAGE_SIZE", "50000")))

    # A camera is offline once its Vision heartbeat is older than this.
    camera_timeout_seconds: float = field(
        default_factory=lambda: float(os.getenv("SCOOP_CAMERA_TIMEOUT_SECONDS", "10"))
    )
