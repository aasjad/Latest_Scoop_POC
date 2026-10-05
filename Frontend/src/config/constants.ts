import type { CameraConfig, CountingLine } from '@/types';

export const ENV = {
  useMock: import.meta.env.VITE_USE_MOCK === 'true',
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000',
  wsUrl: (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:8000/ws/events',
} as const;

/** All backend paths in one place — change here if the backend renames anything. */
export const ENDPOINTS = {
  events: '/api/v1/events',
  counts: '/api/v1/counts',
  health: '/api/v1/health',
  // assumed (not in contract v1.0)
  cameras: '/api/v1/cameras',
  camera: (id: string) => `/api/v1/cameras/${encodeURIComponent(id)}`,
  cameraStatus: (id: string) => `/api/v1/cameras/${encodeURIComponent(id)}/status`,
  config: (id: string) => `/api/v1/cameras/${encodeURIComponent(id)}/config`,
  recording: (id: string) => `/api/v1/cameras/${encodeURIComponent(id)}/recording`,
  resetCounts: '/api/v1/counts/reset',
  // incidents
  incidents: '/api/v1/incidents',
  incident: (id: number) => `/api/v1/incidents/${id}`,
  incidentCount: '/api/v1/incidents/count',
} as const;

export const DEFAULT_LINE: CountingLine = { p1: { x: 0.06, y: 0.64 }, p2: { x: 0.94, y: 0.64 } };

export const DEFAULT_CONFIG: Omit<CameraConfig, 'camera_id'> = {
  line: DEFAULT_LINE,
  // Camera faces into the building: walking away from it (near side B → far side A) is IN.
  entry_direction: 'B_TO_A',
  detection_confidence: 0.5,
  inference_fps: 15,
  capacity: null,
};

export const LIVE = {
  recentEventsMax: 60,
  activityItems: 7,
  recentCards: 10,
  notificationTtlMs: 4200,
  crossingFlashMs: 1400,
  trackFocusMs: 6000,
  highlightAllMs: 3500,
  reconnectBaseMs: 1000,
  reconnectMaxMs: 15000,
} as const;

export const THRESHOLDS = {
  minLineLength: 0.05,
  degradedFps: 20,
  degradedLatencyMs: 150,
  degradedFrameDropPct: 5,
} as const;

export const EVENTS_PAGE_SIZES = [10, 20, 50] as const;
/** Upper bound when pulling raw events for client-side chart aggregation. */
export const SERIES_FETCH_LIMIT = 50000;

/** Video overlay coordinate space (16:9). */
export const FRAME = { w: 1600, h: 900 } as const;
