import { create } from 'zustand';
import { api } from '@/api';
import { LIVE } from '@/config/constants';
import type { PersonCountEvent } from '@/types';

interface EventState {
  recent: PersonCountEvent[];
  loading: boolean;
  error: string | null;
  /** Monotonic counter + last ingested event so charts can react without re-fetching. */
  lastLive: PersonCountEvent | null;
  load(cameraId: string | null): Promise<void>;
  /** Returns false if the event was already known (dedupe by event_id). */
  ingest(event: PersonCountEvent): boolean;
}

let requestSeq = 0;

const mergeNewestFirst = (a: PersonCountEvent[], b: PersonCountEvent[]) => {
  const seen = new Set<string>();
  return [...a, ...b]
    .filter((e) => (seen.has(e.event_id) ? false : (seen.add(e.event_id), true)))
    .sort((x, y) => y.timestamp.localeCompare(x.timestamp))
    .slice(0, LIVE.recentEventsMax);
};

export const useEventStore = create<EventState>((set, get) => ({
  recent: [],
  loading: true,
  error: null,
  lastLive: null,

  async load(cameraId) {
    const seq = ++requestSeq;
    set({ loading: get().recent.length === 0, error: null });
    try {
      const page = await api.getEvents({ limit: 20, offset: 0, camera_id: cameraId ?? undefined });
      // Keep any live events that arrived while the request was in flight.
      if (seq === requestSeq) set({ recent: mergeNewestFirst(get().recent, page.items), loading: false });
    } catch (e) {
      if (seq === requestSeq) set({ loading: false, error: (e as Error).message });
    }
  },

  ingest(event) {
    if (get().recent.some((e) => e.event_id === event.event_id)) return false;
    set({ recent: mergeNewestFirst([event], get().recent), lastLive: event });
    return true;
  },
}));

/** Clears data when switching camera. */
export const resetEventStore = () => useEventStore.setState({ recent: [], loading: true, error: null, lastLive: null });
