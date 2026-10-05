"""Request and response models matching API Contract v1.0."""

from datetime import datetime, timezone
from typing import Literal, Optional

import math
import uuid

from pydantic import AwareDatetime, BaseModel, Field, StrictInt, field_serializer, model_validator

Direction = Literal["ENTRY", "EXIT"]

# Stored and returned timestamps use one fixed format so that text ordering in
# SQLite matches chronological ordering. Sub-second precision is dropped.
TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def to_utc_string(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime(TIMESTAMP_FORMAT)


class EventIn(BaseModel):
    event_id: str = Field(min_length=1, max_length=128)
    camera_id: str = Field(min_length=1, max_length=64)
    track_id: StrictInt = Field(ge=0)
    direction: Direction
    # AwareDatetime rejects timestamps without a timezone; they are converted to UTC.
    timestamp: AwareDatetime

    @field_serializer("timestamp")
    def _serialize_timestamp(self, value: datetime) -> str:
        return to_utc_string(value)


class EventOut(BaseModel):
    event_id: str
    camera_id: str
    track_id: int
    direction: Direction
    timestamp: str


class EventCreatedResponse(BaseModel):
    success: bool = True
    message: str = "Event stored successfully"
    event_id: str


class EventPage(BaseModel):
    items: list[EventOut]
    total: int
    limit: int
    offset: int


class CountsResponse(BaseModel):
    total_entries: int
    total_exits: int
    current_occupancy: int


class HealthResponse(BaseModel):
    status: Literal["healthy", "unhealthy"]
    # Per-component state. database comes from the backend itself; the others
    # from the Vision server's heartbeats (offline when none is fresh).
    components: Optional["HealthComponents"] = None


class VideoCamera(BaseModel):
    camera_id: str
    last_frame_at: Optional[str]


class VideoCamerasResponse(BaseModel):
    cameras: list[VideoCamera]


class PersonCountEventMessage(BaseModel):
    type: Literal["PERSON_COUNT_EVENT"] = "PERSON_COUNT_EVENT"
    data: EventOut


# --- Incidents ---------------------------------------------------------------

Severity = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
IncidentStatus = Literal["OPEN", "REVIEWED", "RESOLVED"]

# Upper-case identifiers such as LINE_CROSSING or ZONE_INTRUSION.
EVENT_TYPE_PATTERN = r"^[A-Z][A-Z0-9_]{0,63}$"


class IncidentIn(BaseModel):
    """Payload the Vision server sends for a new incident."""

    camera_id: str = Field(min_length=1, max_length=64)
    person_id: Optional[StrictInt] = Field(default=None, ge=0)
    event_type: str = Field(pattern=EVENT_TYPE_PATTERN)
    severity: Severity
    description: Optional[str] = Field(default=None, max_length=1000)
    timestamp: AwareDatetime
    # Path of the saved snapshot, relative to the project root
    # (e.g. "incidents/images/incident_CAM_01_20261005T101500Z_17.jpg").
    image_path: Optional[str] = Field(default=None, max_length=512)

    @field_serializer("timestamp")
    def _serialize_timestamp(self, value: datetime) -> str:
        return to_utc_string(value)


class IncidentUpdate(BaseModel):
    """Fields the dashboard may change. Omitted fields are left as they are."""

    status: Optional[IncidentStatus] = None
    severity: Optional[Severity] = None
    description: Optional[str] = Field(default=None, max_length=1000)


class IncidentOut(BaseModel):
    id: int
    camera_id: str
    person_id: Optional[int]
    event_type: str
    severity: str
    description: Optional[str]
    timestamp: str
    image_path: Optional[str]
    # URL the browser loads the snapshot from; null when there is no image.
    image_url: Optional[str]
    status: str
    created_at: str


class IncidentPage(BaseModel):
    items: list[IncidentOut]
    total: int
    limit: int
    offset: int


class IncidentCounts(BaseModel):
    total: int
    by_severity: dict[str, int]
    by_status: dict[str, int]
    by_event_type: dict[str, int]


# --- Cameras (reported by the Vision server) ---------------------------------

ComponentState = Literal["online", "degraded", "offline", "unknown"]
CameraStatusKind = Literal["online", "degraded", "offline"]


class Point(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


# Shortest accepted line, as a fraction of the frame (the dashboard uses 0.05).
MIN_LINE_LENGTH = 0.02


class CountingLineConfig(BaseModel):
    p1: Point
    p2: Point

    @model_validator(mode="after")
    def _long_enough(self):
        if math.dist((self.p1.x, self.p1.y), (self.p2.x, self.p2.y)) < MIN_LINE_LENGTH:
            raise ValueError(f"counting line is too short (minimum {MIN_LINE_LENGTH} of the frame)")
        return self


class VisionLineConfig(BaseModel):
    """The counting line Vision is actually using, normalized to 0..1."""

    line: CountingLineConfig
    entry_direction: Literal["A_TO_B", "B_TO_A"]
    detection_confidence: float = Field(ge=0, le=1)


class VisionHeartbeat(BaseModel):
    """Vision's own state, sent every few seconds while it runs."""

    name: str = Field(min_length=1, max_length=128)
    location: str = Field(default="", max_length=128)
    # Camera URL with the password masked by Vision; never the raw credentials.
    source: str = Field(default="", max_length=512)
    resolution: Optional[str] = Field(default=None, max_length=32)
    mode: Literal["view", "detect", "track", "count"]
    # Detection model actually loaded, or None (view mode / still loading).
    model: Optional[str] = Field(default=None, max_length=128)
    tracker_active: bool
    # connecting: no frame yet · streaming: frames arriving · stalled: frames stopped · stopped: Vision exiting
    camera_state: Literal["connecting", "streaming", "stalled", "stopped"]
    camera_fps: float = Field(ge=0)
    inference_fps: float = Field(ge=0)
    latency_ms: int = Field(ge=0)
    frame_drop_pct: float = Field(ge=0, le=100)
    uptime_s: int = Field(ge=0)
    # People the tracker is following in the current frame (not a running total).
    active_tracks: int = Field(default=0, ge=0)
    config: Optional[VisionLineConfig] = None


class Camera(BaseModel):
    camera_id: str
    name: str
    location: str
    source: str
    resolution: str
    stream_url: Optional[str] = None


class CameraStatus(BaseModel):
    camera_id: str
    status: CameraStatusKind
    resolution: str
    camera_fps: float
    inference_fps: float
    latency_ms: int
    frame_drop_pct: float
    model: str
    uptime_s: int
    # Currently tracked people as last reported by Vision; 0 whenever the camera is offline.
    active_tracks: int
    updated_at: str


class CameraConfig(BaseModel):
    camera_id: str
    line: CountingLineConfig
    entry_direction: Literal["A_TO_B", "B_TO_A"]
    detection_confidence: float
    inference_fps: int
    capacity: Optional[int] = None


class CameraConfigIn(BaseModel):
    """PUT /cameras/{id}/config - what the dashboard may change.

    line / entry_direction / detection_confidence are applied by Vision (and
    only reported as saved once Vision confirms). capacity is a dashboard
    setting stored by the backend. inference_fps is accepted for compatibility
    but ignored: it is measured, not configurable.
    """

    camera_id: Optional[str] = None
    line: CountingLineConfig
    entry_direction: Literal["A_TO_B", "B_TO_A"]
    detection_confidence: float = Field(ge=0.05, le=0.95)
    inference_fps: Optional[float] = None
    capacity: Optional[int] = Field(default=None, ge=1, le=100000)


class VisionCommand(BaseModel):
    """Sent to Vision through GET /cameras/{id}/commands/next."""

    command_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    type: Literal["SET_LINE"] = "SET_LINE"
    config: VisionLineConfig


class VisionCommandResult(BaseModel):
    """Vision's answer: what it actually applied, or why it could not."""

    ok: bool
    error: Optional[str] = Field(default=None, max_length=500)
    config: Optional[VisionLineConfig] = None


class CameraConfigMessage(BaseModel):
    """Pushed when the counting line Vision uses changes (start-up, dashboard edit)."""

    type: Literal["CAMERA_CONFIG"] = "CAMERA_CONFIG"
    data: CameraConfig


class CameraStatusMessage(BaseModel):
    type: Literal["CAMERA_STATUS"] = "CAMERA_STATUS"
    data: CameraStatus


class HealthComponents(BaseModel):
    database: ComponentState
    ai_engine: ComponentState
    camera: ComponentState
    tracker: ComponentState


HealthResponse.model_rebuild()
