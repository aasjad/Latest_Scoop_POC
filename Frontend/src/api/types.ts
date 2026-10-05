import type {
  Camera,
  CameraConfig,
  CameraStatus,
  CountSummary,
  EventsQuery,
  HealthResponse,
  Incident,
  IncidentCounts,
  IncidentsQuery,
  IncidentUpdate,
  Paginated,
  PersonCountEvent,
  RecordingSource,
  SocketState,
  WsMessage,
} from '@/types';

/** Everything the UI needs from the backend. Implemented by the HTTP client and by the mock. */
export interface BackendApi {
  // contract v1.0
  getEvents(query: EventsQuery, signal?: AbortSignal): Promise<Paginated<PersonCountEvent>>;
  getCounts(cameraId?: string, signal?: AbortSignal): Promise<CountSummary>;
  getHealth(signal?: AbortSignal): Promise<HealthResponse>;
  // assumed extensions
  getCameras(signal?: AbortSignal): Promise<Camera[]>;
  updateCamera(camera: Camera): Promise<Camera>;
  getCameraStatus(cameraId: string, signal?: AbortSignal): Promise<CameraStatus | null>;
  getConfig(cameraId: string, signal?: AbortSignal): Promise<CameraConfig>;
  saveConfig(config: CameraConfig): Promise<CameraConfig>;
  resetCounts(cameraId?: string): Promise<void>;
  getRecording(cameraId: string, from: string, to: string, signal?: AbortSignal): Promise<RecordingSource>;
  // incidents
  getIncidents(query: IncidentsQuery, signal?: AbortSignal): Promise<Paginated<Incident>>;
  getIncident(id: number, signal?: AbortSignal): Promise<Incident>;
  getIncidentCounts(cameraId?: string, signal?: AbortSignal): Promise<IncidentCounts>;
  updateIncident(id: number, changes: IncidentUpdate): Promise<Incident>;
  deleteIncident(id: number): Promise<void>;
}

export type Unsubscribe = () => void;

export interface LiveSocket {
  connect(): void;
  close(): void;
  readonly state: SocketState;
  onMessage(handler: (msg: WsMessage) => void): Unsubscribe;
  onStateChange(handler: (state: SocketState) => void): Unsubscribe;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
