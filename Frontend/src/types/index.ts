/**
 * Domain types. The first block mirrors Latest Scoop API Contract v1.0 exactly;
 * everything marked "assumed" is not in the contract yet and must be confirmed
 * with the backend team (see README → Backend assumptions).
 */

// ── Contract v1.0 ───────────────────────────────────────────────────────────
export type Direction = 'ENTRY' | 'EXIT';

export interface PersonCountEvent {
  event_id: string;
  camera_id: string;
  track_id: number;
  direction: Direction;
  /** ISO 8601, UTC */
  timestamp: string;
  /** assumed — detector confidence 0..1, optional */
  confidence?: number;
  /** assumed — URL of the crossing snapshot, optional */
  snapshot_url?: string;
}

export interface EventsQuery {
  limit?: number;
  offset?: number;
  direction?: Direction;
  from?: string;
  to?: string;
  /** assumed filters */
  camera_id?: string;
  track_id?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface CountSummary {
  total_entries: number;
  total_exits: number;
  current_occupancy: number;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** assumed — per-component breakdown */
  components?: Partial<Record<SystemComponent, ComponentState>>;
}

export interface WsEventMessage {
  type: 'PERSON_COUNT_EVENT';
  data: PersonCountEvent;
}

// ── Assumed extensions ──────────────────────────────────────────────────────
export type ComponentState = 'online' | 'degraded' | 'offline' | 'unknown';
export type SystemComponent = 'ai_engine' | 'camera' | 'tracker' | 'database' | 'websocket';

/** Normalised point, 0..1 in both axes relative to the video frame. */
export interface Point {
  x: number;
  y: number;
}

export interface CountingLine {
  p1: Point;
  p2: Point;
}

/**
 * Side A is the far side of the vector p1→p2 (left-hand side in screen space, y down).
 * `A_TO_B` means a crossing from side A to side B is counted as IN.
 */
export type EntryDirection = 'A_TO_B' | 'B_TO_A';

export interface CameraConfig {
  camera_id: string;
  line: CountingLine;
  entry_direction: EntryDirection;
  detection_confidence: number;
  inference_fps: number;
  /** null = no capacity configured, occupancy % is not shown */
  capacity: number | null;
}

export type CameraStatusKind = 'online' | 'degraded' | 'offline';

export interface Camera {
  camera_id: string;
  name: string;
  location: string;
  source: string;
  resolution: string;
  stream_url?: string;
}

export interface CameraStatus {
  camera_id: string;
  status: CameraStatusKind;
  resolution: string;
  camera_fps: number;
  inference_fps: number;
  latency_ms: number;
  frame_drop_pct: number;
  model: string;
  uptime_s: number;
  /** People the tracker is following right now (from Vision); 0 when offline. */
  active_tracks: number;
  updated_at: string;
}

export type TrackStatus = 'entering' | 'exiting' | 'entered' | 'exited' | 'tracking';

export interface Track {
  track_id: number;
  /** [x, y, w, h] normalised */
  bbox: [number, number, number, number];
  confidence: number;
  status: TrackStatus;
  /** recent foot points, oldest first */
  trail: Point[];
}

export interface TracksMessage {
  type: 'TRACKS_UPDATE';
  data: { camera_id: string; tracks: Track[]; frame_ts: string };
}

export interface CameraStatusMessage {
  type: 'CAMERA_STATUS';
  data: CameraStatus;
}

/** The counting line Vision uses changed (Vision started, or a dashboard edit was applied). */
export interface CameraConfigMessage {
  type: 'CAMERA_CONFIG';
  data: CameraConfig;
}

export type WsMessage = WsEventMessage | TracksMessage | CameraStatusMessage | CameraConfigMessage;

export type SocketState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export type RecordingSource =
  | { kind: 'video'; url: string; starts_at: string }
  | { kind: 'synthetic' }
  | { kind: 'unavailable' };

export type ChartRange = 'live' | 'today' | '7d' | 'custom';

export interface SeriesBucket {
  key: string;
  label: string;
  start: number;
  end: number;
  in: number;
  out: number;
}

// ── Incidents (backend /api/v1/incidents) ───────────────────────────────────
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IncidentStatus = 'OPEN' | 'REVIEWED' | 'RESOLVED';

export interface Incident {
  id: number;
  camera_id: string;
  person_id: number | null;
  /** e.g. LINE_CROSSING, ZONE_INTRUSION */
  event_type: string;
  severity: Severity;
  description: string | null;
  /** ISO 8601, UTC */
  timestamp: string;
  /** project-relative path on the server; display only */
  image_path: string | null;
  /** absolute URL of the snapshot, or null when there is none */
  image_url: string | null;
  status: IncidentStatus;
  created_at: string;
}

export interface IncidentsQuery {
  limit?: number;
  offset?: number;
  camera_id?: string;
  severity?: Severity;
  status?: IncidentStatus;
  event_type?: string;
}

export interface IncidentCounts {
  total: number;
  by_severity: Partial<Record<Severity, number>>;
  by_status: Partial<Record<IncidentStatus, number>>;
  by_event_type: Record<string, number>;
}

export interface IncidentUpdate {
  status?: IncidentStatus;
  severity?: Severity;
  description?: string;
}
