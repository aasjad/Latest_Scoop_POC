import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api';
import { SERIES_FETCH_LIMIT } from '@/config/constants';
import { addToBuckets, buildWindow, MIN } from '@/lib/aggregate';
import { useEventStore } from '@/store/eventStore';
import type { ChartRange, SeriesBucket } from '@/types';
import { useNow } from './useMisc';

/**
 * IN/OUT buckets for a range. Loads history via GET /events (aggregated client-side —
 * the contract has no aggregate endpoint) and then folds in live events as they arrive.
 */
export function useFootfallSeries(range: ChartRange, cameraId: string | null, custom?: { from: Date; to: Date }) {
  const minute = Math.floor(useNow(range === 'live' ? 15_000 : 60_000) / MIN);
  const customKey = custom ? `${custom.from.getTime()}-${custom.to.getTime()}` : '';
  // Rebuild the live window every minute; other ranges only when inputs change.
  const windowKey = range === 'live' ? minute : range === 'today' ? new Date(minute * MIN).toDateString() : customKey;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const win = useMemo(() => buildWindow(range, new Date(), custom), [range, windowKey, customKey]);

  const [buckets, setBuckets] = useState<SeriesBucket[]>(win.buckets);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [nonce, setNonce] = useState(0);
  const counted = useRef(new Set<string>());

  useEffect(() => {
    if (!cameraId) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api
      .getEvents({ camera_id: cameraId, from: win.from.toISOString(), to: win.to.toISOString(), limit: SERIES_FETCH_LIMIT }, ctrl.signal)
      .then((page) => {
        if (ctrl.signal.aborted) return;
        counted.current = new Set(page.items.map((e) => e.event_id));
        setBuckets(addToBuckets(win.buckets, page.items));
        setTruncated(page.total > page.items.length);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (ctrl.signal.aborted || e.name === 'AbortError') return;
        setError(e.message);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [win, cameraId, nonce]);

  const lastLive = useEventStore((s) => s.lastLive);
  useEffect(() => {
    if (!lastLive || loading || counted.current.has(lastLive.event_id) || lastLive.camera_id !== cameraId) return;
    counted.current.add(lastLive.event_id);
    setBuckets((prev) => addToBuckets(prev, [lastLive]));
  }, [lastLive, loading, cameraId]);

  return { buckets, loading, error, truncated, reload: () => setNonce((n) => n + 1), from: win.from, to: win.to };
}
