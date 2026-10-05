import { ChevronLeft, ChevronRight, Download, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import { PageHeader } from '@/components/common/PageHeader';
import { Segmented } from '@/components/common/Segmented';
import { EmptyState, ErrorState } from '@/components/common/States';
import { EventTable } from '@/components/events/EventTable';
import { EVENTS_PAGE_SIZES } from '@/config/constants';
import { useAsync } from '@/hooks/useMisc';
import { endOfDay, fromDateInput, startOfDay, toDateInput } from '@/lib/format';
import { useCameraStore } from '@/store/cameraStore';
import { useEventStore } from '@/store/eventStore';
import { useUiStore } from '@/store/uiStore';
import type { Direction, PersonCountEvent } from '@/types';

type DirFilter = 'ALL' | Direction;
const DIR_OPTIONS = [
  { value: 'ALL', label: 'All' },
  { value: 'ENTRY', label: 'In' },
  { value: 'EXIT', label: 'Out' },
] as const satisfies ReadonlyArray<{ value: DirFilter; label: string }>;

function toCsv(rows: PersonCountEvent[]) {
  const head = 'event_id,timestamp,camera_id,track_id,direction,confidence';
  return [head, ...rows.map((e) => [e.event_id, e.timestamp, e.camera_id, e.track_id, e.direction, e.confidence ?? ''].join(','))].join('\n');
}

export default function EventsPage() {
  const [params, setParams] = useSearchParams();
  const cameras = useCameraStore((s) => s.cameras);
  const selectedCamera = useCameraStore((s) => s.selectedId);
  const openEvent = useUiStore((s) => s.openEvent);

  const direction = (params.get('direction') as Direction | null) ?? undefined;
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const camera = params.get('camera') ?? selectedCamera ?? 'all';
  const trackParam = params.get('track_id');
  const trackId = trackParam && /^\d+$/.test(trackParam) ? Number(trackParam) : undefined;
  const size = Number(params.get('size')) || 20;
  const page = Math.max(1, Number(params.get('page')) || 1);

  const update = (patch: Record<string, string | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === undefined || v === '' ? next.delete(k) : next.set(k, v));
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  // Debounced track-id search box.
  const [trackInput, setTrackInput] = useState(trackParam ?? '');
  useEffect(() => setTrackInput(trackParam ?? ''), [trackParam]);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onTrackInput = (v: string) => {
    const clean = v.replace(/[^\d]/g, '');
    setTrackInput(clean);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => update({ track_id: clean || undefined }), 350);
  };

  const query = useMemo(
    () => ({ limit: size, offset: (page - 1) * size, direction, from, to, camera_id: camera === 'all' ? undefined : camera, track_id: trackId }),
    [size, page, direction, from, to, camera, trackId],
  );
  const { data, loading, error, reload } = useAsync((signal) => api.getEvents(query, signal), [query]);

  // Count live events that match the current filters since the page loaded.
  const lastLive = useEventStore((s) => s.lastLive);
  const [newCount, setNewCount] = useState(0);
  useEffect(() => setNewCount(0), [data]);
  useEffect(() => {
    if (!lastLive || !data) return;
    if (query.camera_id && lastLive.camera_id !== query.camera_id) return;
    if (direction && lastLive.direction !== direction) return;
    if (to && lastLive.timestamp > to) return;
    if (trackId != null && lastLive.track_id !== trackId) return;
    setNewCount((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastLive]);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const hasFilters = !!(direction || from || to || trackId != null || params.get('camera'));
  const today = toDateInput(new Date());

  const exportCsv = async () => {
    const all = await api.getEvents({ ...query, limit: 5000, offset: 0 });
    const blob = new Blob([toCsv(all.items)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `footfall-events-${today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHeader
        title="Events"
        description="Every entry and exit recorded by the AI engine."
        actions={
          <button onClick={() => void exportCsv()} className="btn-secondary" disabled={!total}>
            <Download className="size-4" /> Export CSV
          </button>
        }
      />

      <section className="card">
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div>
            <span className="label">Date from</span>
            <input
              type="date"
              className="input w-[150px]"
              max={today}
              value={from ? toDateInput(new Date(from)) : ''}
              onChange={(e) => update({ from: e.target.value ? startOfDay(fromDateInput(e.target.value)).toISOString() : undefined })}
            />
          </div>
          <div>
            <span className="label">Date to</span>
            <input
              type="date"
              className="input w-[150px]"
              max={today}
              value={to ? toDateInput(new Date(to)) : ''}
              onChange={(e) => update({ to: e.target.value ? endOfDay(fromDateInput(e.target.value)).toISOString() : undefined })}
            />
          </div>
          <div>
            <label className="label" htmlFor="ev-camera">
              Camera
            </label>
            <select id="ev-camera" className="input w-[180px]" value={camera} onChange={(e) => update({ camera: e.target.value })}>
              <option value="all">All cameras</option>
              {cameras.map((c) => (
                <option key={c.camera_id} value={c.camera_id}>
                  {c.name} ({c.camera_id})
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">Event</span>
            <Segmented ariaLabel="Event type" size="md" value={direction ?? 'ALL'} onChange={(v) => update({ direction: v === 'ALL' ? undefined : v })} options={DIR_OPTIONS} />
          </div>
          <div>
            <label className="label" htmlFor="ev-track">
              Track ID
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
              <input id="ev-track" inputMode="numeric" placeholder="e.g. 21" className="input w-[130px] pl-8" value={trackInput} onChange={(e) => onTrackInput(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => update({ from: startOfDay(new Date()).toISOString(), to: undefined })}>
              Today
            </button>
            {hasFilters && (
              <button className="btn-ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                <X className="size-4" /> Clear
              </button>
            )}
          </div>
        </div>

        {newCount > 0 && page === 1 && (
          <div className="flex justify-center border-b border-line bg-brand-50/60 py-2">
            <button onClick={reload} className="flex items-center gap-1.5 rounded-full bg-brand-500 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-brand-600">
              <RefreshCw className="size-3.5" /> {newCount} new {newCount === 1 ? 'event' : 'events'} — show
            </button>
          </div>
        )}

        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !loading && data?.items.length === 0 ? (
          <EmptyState
            title="No events match these filters"
            description="Try widening the date range or clearing filters."
            action={
              hasFilters ? (
                <button className="btn-secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <EventTable events={data?.items ?? []} cameras={cameras} loading={loading} rows={size} onOpen={openEvent} />
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-slate-600">
          <p className="tabular">
            {total ? (
              <>
                Showing <b className="font-semibold text-slate-900">{(page - 1) * size + 1}</b>–<b className="font-semibold text-slate-900">{Math.min(page * size, total)}</b> of{' '}
                <b className="font-semibold text-slate-900">{total.toLocaleString()}</b>
              </>
            ) : loading ? (
              'Loading…'
            ) : (
              '0 events'
            )}
          </p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Rows
              <select className="input h-8 w-[70px] text-xs" value={size} onChange={(e) => update({ size: e.target.value })}>
                {EVENTS_PAGE_SIZES.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-1">
              <button className="btn-secondary px-2 py-1.5" disabled={page <= 1 || loading} onClick={() => update({ page: String(page - 1) }, false)} aria-label="Previous page">
                <ChevronLeft className="size-4" />
              </button>
              <span className="tabular px-2 text-xs">
                Page {page} / {pages}
              </span>
              <button className="btn-secondary px-2 py-1.5" disabled={page >= pages || loading} onClick={() => update({ page: String(page + 1) }, false)} aria-label="Next page">
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </footer>
      </section>
    </>
  );
}
