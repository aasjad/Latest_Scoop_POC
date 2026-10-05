import { create } from 'zustand';
import { api } from '@/api';
import type { Camera, CameraStatus, Track } from '@/types';

const SELECTED_KEY = 'footfall-selected-camera';

const readSelected = () => {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
};

interface CameraState {
  cameras: Camera[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  statuses: Record<string, CameraStatus>;
  tracks: Track[];
  /** Bumped when the live video must be reconnected (e.g. the backend restarted). */
  videoEpoch: number;
  bumpVideo(): void;
  load(): Promise<void>;
  select(id: string): void;
  upsertCamera(camera: Camera): void;
  setStatus(status: CameraStatus): void;
  setTracks(cameraId: string, tracks: Track[]): void;
}

export const useCameraStore = create<CameraState>((set, get) => ({
  cameras: [],
  loading: true,
  error: null,
  selectedId: readSelected(),
  statuses: {},
  tracks: [],
  videoEpoch: 0,
  bumpVideo: () => set({ videoEpoch: get().videoEpoch + 1 }),

  async load() {
    set({ loading: true, error: null });
    try {
      const cameras = await api.getCameras();
      const current = get().selectedId;
      const selectedId = cameras.some((c) => c.camera_id === current) ? current : cameras[0]?.camera_id ?? null;
      set({ cameras, selectedId, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  select(id) {
    if (id === get().selectedId) return;
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      /* ignore */
    }
    set({ selectedId: id, tracks: [] });
  },

  upsertCamera(camera) {
    const cameras = get().cameras.some((c) => c.camera_id === camera.camera_id)
      ? get().cameras.map((c) => (c.camera_id === camera.camera_id ? camera : c))
      : [...get().cameras, camera];
    set({ cameras });
  },

  setStatus(status) {
    set({ statuses: { ...get().statuses, [status.camera_id]: status } });
  },

  setTracks(cameraId, tracks) {
    if (cameraId === get().selectedId) set({ tracks });
  },
}));

export const useSelectedCamera = () =>
  useCameraStore((s) => s.cameras.find((c) => c.camera_id === s.selectedId) ?? null);

export const useSelectedStatus = () => useCameraStore((s) => (s.selectedId ? s.statuses[s.selectedId] ?? null : null));
