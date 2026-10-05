import { create } from 'zustand';
import { api } from '@/api';
import type { ComponentState, HealthResponse, SocketState, SystemComponent } from '@/types';

interface ConnectionState {
  socket: SocketState;
  health: HealthResponse | null;
  healthError: string | null;
  lastMessageAt: number | null;
  lastHealthAt: number | null;
  setSocket(s: SocketState): void;
  touch(): void;
  loadHealth(): Promise<void>;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  socket: 'closed',
  health: null,
  healthError: null,
  lastMessageAt: null,
  lastHealthAt: null,
  setSocket: (socket) => set({ socket }),
  touch() {
    const now = Date.now();
    const last = get().lastMessageAt;
    if (!last || now - last > 1000) set({ lastMessageAt: now }); // throttled: messages arrive ~24/s
  },
  async loadHealth() {
    try {
      const health = await api.getHealth();
      set({ health, healthError: null, lastHealthAt: Date.now() });
    } catch (e) {
      set({ health: null, healthError: (e as Error).message, lastHealthAt: Date.now() });
    }
  },
}));

export const SYSTEM_COMPONENTS: Array<{ key: SystemComponent; label: string; description: string }> = [
  { key: 'camera', label: 'Camera', description: 'Video stream from the selected camera' },
  { key: 'ai_engine', label: 'AI Engine', description: 'Person detection model' },
  { key: 'tracker', label: 'Tracker', description: 'Identity tracking & line crossing' },
  { key: 'database', label: 'Database', description: 'Event storage' },
  { key: 'websocket', label: 'Live connection', description: 'Real-time updates to this dashboard' },
];

/** Derives every component's state from health + socket + camera status. */
export function deriveComponentStates(
  health: HealthResponse | null,
  healthError: string | null,
  socket: SocketState,
  cameraStatus: 'online' | 'degraded' | 'offline' | null,
): Record<SystemComponent, ComponentState> {
  const backendDown = !!healthError;
  const fromHealth = (k: SystemComponent): ComponentState => {
    if (backendDown) return 'offline';
    const v = health?.components?.[k];
    if (v) return v;
    if (!health) return 'unknown';
    return health.status === 'healthy' ? 'online' : health.status === 'degraded' ? 'degraded' : 'offline';
  };
  const engine = fromHealth('ai_engine');
  return {
    camera: cameraStatus ?? fromHealth('camera'),
    // A running engine with no video is degraded; an engine the backend reports offline stays offline.
    ai_engine: cameraStatus === 'offline' && engine === 'online' ? 'degraded' : engine,
    tracker: fromHealth('tracker'),
    database: fromHealth('database'),
    websocket: socket === 'open' ? 'online' : socket === 'closed' ? 'offline' : 'degraded',
  };
}
