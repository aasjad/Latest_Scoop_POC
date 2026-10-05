"""What the backend knows about the cameras.

Two kinds of information, kept apart:

* Configuration (name, source without credentials, resolution, counting line,
  entry direction, detection confidence, capacity) - persisted in the
  `cameras` table, so it survives a backend restart.
* Runtime status (streaming?, FPS, lag, drops, model, tracker, active tracks) -
  in memory only, from the Vision server's heartbeats
  (PUT /api/v1/cameras/{id}/heartbeat). Nothing is guessed: a camera with no
  fresh heartbeat is offline, whatever its configuration says.

The counting line belongs to Vision. The dashboard changes it by queueing a
command that Vision collects (GET /api/v1/cameras/{id}/commands/next), applies
and confirms; only Vision's confirmation updates the stored line.

Lives in a single process, like the WebSocket manager: run uvicorn with one worker.
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

from app import database
from app.schemas import (
    TIMESTAMP_FORMAT,
    Camera,
    CameraConfig,
    CameraStatus,
    CameraStatusKind,
    ComponentState,
    CountingLineConfig,
    HealthComponents,
    VisionCommand,
    VisionCommandResult,
    VisionHeartbeat,
    VisionLineConfig,
)

logger = logging.getLogger(__name__)

# Persist unchanged configuration at most this often (last_seen bookkeeping).
PERSIST_INTERVAL_SECONDS = 60.0


def strip_credentials(url: str) -> str:
    """rtsp://user:pass@host:554/path -> rtsp://host:554/path. Never store or serve credentials."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return ""
    if parts.username is None and parts.password is None:
        return url
    host = parts.hostname or ""
    if parts.port:
        host = f"{host}:{parts.port}"
    return urlunsplit((parts.scheme, host, parts.path, parts.query, parts.fragment))


def _utc(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime(TIMESTAMP_FORMAT)


@dataclass
class CameraRecord:
    """Persisted configuration of one camera."""

    camera_id: str
    name: str
    location: str = ""
    source: str = ""
    resolution: Optional[str] = None
    line: Optional[dict] = None
    entry_direction: Optional[str] = None
    detection_confidence: Optional[float] = None
    capacity: Optional[int] = None
    last_seen: Optional[str] = None

    def to_row(self) -> dict:
        row = self.__dict__.copy()
        row["line_json"] = json.dumps(row.pop("line")) if self.line else None
        return row

    @classmethod
    def from_row(cls, row: dict) -> "CameraRecord":
        row = dict(row)
        line_json = row.pop("line_json")
        return cls(**row, line=json.loads(line_json) if line_json else None)

    def config_key(self) -> tuple:
        return (self.name, self.location, self.source, self.resolution,
                json.dumps(self.line, sort_keys=True), self.entry_direction,
                self.detection_confidence, self.capacity)


@dataclass
class _Runtime:
    heartbeat: VisionHeartbeat
    received_at: float


@dataclass
class _Mailbox:
    """At most one outstanding command per camera; a newer one replaces it."""

    pending: Optional[VisionCommand] = None
    wake: asyncio.Event = field(default_factory=asyncio.Event)
    results: dict[str, asyncio.Future] = field(default_factory=dict)


class CameraRegistry:
    def __init__(self, timeout_seconds: float, db_path: Optional[str] = None) -> None:
        self.timeout_seconds = timeout_seconds
        self.db_path = db_path
        self._records: dict[str, CameraRecord] = {}
        self._runtime: dict[str, _Runtime] = {}
        self._persisted: dict[str, tuple[tuple, float]] = {}
        self._mailboxes: dict[str, _Mailbox] = {}
        # Last status sent to dashboards, so the watchdog only announces changes.
        self.announced: dict[str, CameraStatusKind] = {}

    # --- persistence -----------------------------------------------------

    def load(self) -> None:
        """Read the stored camera configuration (at startup)."""
        if not self.db_path:
            return
        conn = database.connect(self.db_path)
        try:
            for row in database.list_cameras(conn):
                record = CameraRecord.from_row(row)
                self._records[record.camera_id] = record
                self._persisted[record.camera_id] = (record.config_key(), time.time())
        finally:
            conn.close()
        if self._records:
            logger.info("Loaded %d camera(s) from the database: %s", len(self._records), ", ".join(self._records))

    def _persist(self, record: CameraRecord, force: bool = False) -> None:
        if not self.db_path:
            return
        key = record.config_key()
        previous = self._persisted.get(record.camera_id)
        if not force and previous and previous[0] == key and time.time() - previous[1] < PERSIST_INTERVAL_SECONDS:
            return
        conn = database.connect(self.db_path)
        try:
            database.upsert_camera(conn, record.to_row())
        finally:
            conn.close()
        self._persisted[record.camera_id] = (key, time.time())

    # --- heartbeats ------------------------------------------------------

    def record(self, camera_id: str, heartbeat: VisionHeartbeat) -> bool:
        """Store a heartbeat. Returns True when the counting configuration changed."""
        now = time.time()
        self._runtime[camera_id] = _Runtime(heartbeat, now)
        record = self._records.get(camera_id) or CameraRecord(camera_id=camera_id, name=heartbeat.name)
        before = (json.dumps(record.line, sort_keys=True), record.entry_direction, record.detection_confidence)
        record.name = heartbeat.name
        record.location = heartbeat.location
        record.source = strip_credentials(heartbeat.source)
        record.resolution = heartbeat.resolution or record.resolution
        if heartbeat.config is not None:
            # Vision is the authority on the line it is using.
            record.line = heartbeat.config.line.model_dump()
            record.entry_direction = heartbeat.config.entry_direction
            record.detection_confidence = heartbeat.config.detection_confidence
        record.last_seen = _utc(now)
        self._records[camera_id] = record
        self._persist(record)
        return before != (json.dumps(record.line, sort_keys=True), record.entry_direction, record.detection_confidence)

    def set_capacity(self, camera_id: str, capacity: Optional[int]) -> None:
        record = self._records[camera_id]
        record.capacity = capacity
        self._persist(record, force=True)

    def apply_vision_config(self, camera_id: str, config: VisionLineConfig) -> None:
        """Store the configuration Vision confirmed it applied."""
        record = self._records[camera_id]
        record.line = config.line.model_dump()
        record.entry_direction = config.entry_direction
        record.detection_confidence = config.detection_confidence
        self._persist(record, force=True)

    # --- reads -----------------------------------------------------------

    def ids(self) -> list[str]:
        return sorted(self._records)

    def known(self, camera_id: str) -> bool:
        return camera_id in self._records

    def _fresh(self, camera_id: str) -> Optional[VisionHeartbeat]:
        """The latest heartbeat if Vision is alive for this camera, else None."""
        rt = self._runtime.get(camera_id)
        if rt is None or time.time() - rt.received_at > self.timeout_seconds or rt.heartbeat.camera_state == "stopped":
            return None
        return rt.heartbeat

    def status_kind(self, camera_id: str) -> CameraStatusKind:
        hb = self._fresh(camera_id)
        if hb is None:
            return "offline"
        return "online" if hb.camera_state == "streaming" else "degraded"

    def mode(self, camera_id: str) -> Optional[str]:
        hb = self._fresh(camera_id)
        return hb.mode if hb else None

    def camera(self, camera_id: str, stream_url: Optional[str]) -> Camera:
        record = self._records[camera_id]
        return Camera(
            camera_id=camera_id,
            name=record.name,
            location=record.location or "—",
            source=record.source or "—",
            resolution=record.resolution or "—",
            stream_url=stream_url,
        )

    def status(self, camera_id: str) -> CameraStatus:
        record = self._records[camera_id]
        rt = self._runtime.get(camera_id)
        kind = self.status_kind(camera_id)
        if rt is None:
            # Known from the database but no heartbeat since the backend started.
            return CameraStatus(
                camera_id=camera_id, status="offline", resolution=record.resolution or "—",
                camera_fps=0, inference_fps=0, latency_ms=0, frame_drop_pct=0, model="—",
                uptime_s=0, active_tracks=0, updated_at=record.last_seen or _utc(time.time()),
            )
        hb = rt.heartbeat
        live = kind != "offline"
        return CameraStatus(
            camera_id=camera_id,
            status=kind,
            resolution=hb.resolution or record.resolution or "—",
            camera_fps=round(hb.camera_fps, 1) if live else 0,
            inference_fps=round(hb.inference_fps, 1) if live else 0,
            latency_ms=hb.latency_ms if live else 0,
            frame_drop_pct=round(hb.frame_drop_pct, 1) if live else 0,
            model=hb.model or "—",
            uptime_s=hb.uptime_s if live else 0,
            # Nobody is being tracked by a Vision that is not running.
            active_tracks=hb.active_tracks if live else 0,
            updated_at=_utc(rt.received_at),
        )

    def config(self, camera_id: str) -> Optional[CameraConfig]:
        """The counting line Vision uses (or last used), or None if it never reported one."""
        record = self._records[camera_id]
        if not record.line or not record.entry_direction:
            return None
        hb = self._fresh(camera_id)
        return CameraConfig(
            camera_id=camera_id,
            line=CountingLineConfig(**record.line),
            entry_direction=record.entry_direction,
            detection_confidence=record.detection_confidence if record.detection_confidence is not None else 0.0,
            inference_fps=round(hb.inference_fps) if hb else 0,
            capacity=record.capacity,
        )

    def components(self) -> HealthComponents:
        """ai_engine / camera / tracker across all cameras with a fresh heartbeat."""
        fresh = [hb for cid in self._runtime if (hb := self._fresh(cid)) is not None]

        def best(states: list[ComponentState]) -> ComponentState:
            for state in ("online", "degraded"):
                if state in states:
                    return state
            return "offline"

        return HealthComponents(
            database="unknown",  # filled in by the health route
            # Vision is running; "degraded" while no model is loaded (view mode, start-up).
            ai_engine=best(["online" if hb.model else "degraded" for hb in fresh]),
            camera=best(["online" if hb.camera_state == "streaming" else "degraded" for hb in fresh]),
            tracker=best(["online" if hb.tracker_active else "offline" for hb in fresh]),
        )

    # --- commands to Vision ----------------------------------------------

    def _mailbox(self, camera_id: str) -> _Mailbox:
        if camera_id not in self._mailboxes:
            self._mailboxes[camera_id] = _Mailbox()
        return self._mailboxes[camera_id]

    def send(self, camera_id: str, command: VisionCommand) -> asyncio.Future:
        """Queue a command for Vision; the future resolves with Vision's result."""
        box = self._mailbox(camera_id)
        if box.pending is not None:
            # Superseded before Vision picked it up.
            stale = box.results.pop(box.pending.command_id, None)
            if stale and not stale.done():
                stale.set_result(VisionCommandResult(ok=False, error="Replaced by a newer change"))
        future = asyncio.get_running_loop().create_future()
        box.pending = command
        box.results[command.command_id] = future
        box.wake.set()
        return future

    def forget(self, camera_id: str, command_id: str) -> None:
        box = self._mailbox(camera_id)
        box.results.pop(command_id, None)
        if box.pending is not None and box.pending.command_id == command_id:
            box.pending = None

    async def next_command(self, camera_id: str, wait_seconds: float) -> Optional[VisionCommand]:
        """Long-poll for Vision: the pending command, or None after `wait_seconds`."""
        box = self._mailbox(camera_id)
        if box.pending is None:
            box.wake.clear()
            try:
                await asyncio.wait_for(box.wake.wait(), wait_seconds)
            except asyncio.TimeoutError:
                return None
        command, box.pending = box.pending, None
        return command

    def resolve(self, camera_id: str, command_id: str, result: VisionCommandResult) -> bool:
        future = self._mailbox(camera_id).results.pop(command_id, None)
        if future is None or future.done():
            return False
        future.set_result(result)
        return True
