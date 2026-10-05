import { create } from 'zustand';
import { api } from '@/api';
import type { CountSummary, Direction } from '@/types';

interface AnalyticsState {
  counts: CountSummary | null;
  loading: boolean;
  error: string | null;
  /** Last direction that changed the counts, used for micro-animations. */
  lastChange: { direction: Direction; at: number } | null;
  load(cameraId: string | null): Promise<void>;
  applyEvent(direction: Direction): void;
}

let requestSeq = 0;

export const useAnalyticsStore = create<AnalyticsState>((set, get) => ({
  counts: null,
  loading: true,
  error: null,
  lastChange: null,

  async load(cameraId) {
    const seq = ++requestSeq;
    set({ loading: get().counts === null, error: null });
    try {
      const counts = await api.getCounts(cameraId ?? undefined);
      if (seq === requestSeq) set({ counts, loading: false });
    } catch (e) {
      if (seq === requestSeq) set({ loading: false, error: (e as Error).message });
    }
  },

  /** Optimistic increment from a live event; reconciled on the next load(). */
  applyEvent(direction) {
    const c = get().counts;
    if (!c) return;
    const total_entries = c.total_entries + (direction === 'ENTRY' ? 1 : 0);
    const total_exits = c.total_exits + (direction === 'EXIT' ? 1 : 0);
    set({ counts: { total_entries, total_exits, current_occupancy: total_entries - total_exits }, lastChange: { direction, at: Date.now() } });
  },
}));
