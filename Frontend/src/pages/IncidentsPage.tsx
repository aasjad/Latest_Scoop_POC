import { ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/common/States';
import { eventTypeLabel, IncidentImage, SeverityBadge, StatusBadge } from '@/components/incidents/IncidentBadges';
import { IncidentDrawer, SEVERITIES, STATUSES } from '@/components/incidents/IncidentDrawer';
import { EVENTS_PAGE_SIZES } from '@/config/constants';
import { useAsync } from '@/hooks/useMisc';
import { cn } from '@/lib/cn';
import { fmtDate, fmtTime } from '@/lib/format';
import { useCameraStore } from '@/store/cameraStore';
import type { IncidentStatus, Severity } from '@/types';

const COLS = ['', 'ID', 'Timestamp', 'Camera', 'Person', 'Event type', 'Severity', 'Status', ''];

function Stat({ label, value, tone }: { label: string; value: number | undefined; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      {value == null ? <Skeleton className="mt-1.5 h-7 w-12" /> : <p className={cn('tabular mt-0.5 text-2xl font-semibold text-slate-900', tone)}>{value.toLocaleString()}</p>}
    </div>
  );
}

export default function IncidentsPage() {
  const [params, setParams] = useSearchParams();
  const cameras = useCameraStore((s) => s.cameras);

  const severity = (params.get('severity') as Severity | null) ?? undefined;
  const status = (params.get('status') as IncidentStatus | null) ?? undefined;
  const eventType = params.get('event_type') ?? undefined;
  const camera = params.get('camera') ?? 'all';
  const size = Number(params.get('size')) || 20;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const openParam = params.get('open');
  const openId = openParam && /^\d+$/.test(openParam) ? Number(openParam) : null;

  // Functional update: several changes in one tick all apply, none overwrite another.
  const update = useCallback(
    (patch: Record<string, string | undefined>, resetPage = true) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) (v === undefined || v === '' ? next.delete(k) : next.set(k, v));
          if (resetPage) next.delete('page');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const query = useMemo(
    () => ({ limit: size, offset: (page - 1) * size, severity, status, event_type: eventType, camera_id: camera === 'all' ? undefined : camera }),
    [size, page, severity, status, eventType, camera],
  );
  const { data, loading, error, reload } = useAsync((signal) => api.getIncidents(query, signal), [query]);
  const counts = useAsync((signal) => api.getIncidentCounts(camera === 'all' ? undefined : camera, signal), [camera]);

  const refresh = () => {
    reload();
    counts.reload();
  };

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const hasFilters = !!(severity || status || eventType || params.get('camera'));
  const clearFilters = () => update({ severity: undefined, status: undefined, event_type: undefined, camera: undefined });
  const eventTypes = Object.keys(counts.data?.by_event_type ?? {}).sort();
  const nameOf = (id: string) => cameras.find((c) => c.camera_id === id)?.name ?? id;
  const open = (id: number) => update({ open: String(id) }, false);
  // Stable identity: Drawer re-focuses itself whenever onClose changes.
  const closeDrawer = useCallback(() => update({ open: undefined }, false), [update]);

  return (
    <>
      <PageHeader
        title="Incidents"
        description="Incidents reported by the vision system, with their snapshots."
        actions={
          <button onClick={refresh} className="btn-secondary" disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} /> Refresh
          </button>
        }
      />

      {counts.error ? null : (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total" value={counts.data?.total} />
          <Stat label="Open" value={counts.data ? (counts.data.by_status.OPEN ?? 0) : undefined} tone="text-brand-600" />
          <Stat label="Critical" value={counts.data ? (counts.data.by_severity.CRITICAL ?? 0) : undefined} tone="text-out-600" />
          <Stat label="Resolved" value={counts.data ? (counts.data.by_status.RESOLVED ?? 0) : undefined} tone="text-in-600" />
        </div>
      )}

      <section className="card">
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div>
            <label className="label" htmlFor="inc-f-severity">
              Severity
            </label>
            <select id="inc-f-severity" className="input w-[140px]" value={severity ?? ''} onChange={(e) => update({ severity: e.target.value })}>
              <option value="">All</option>
              {SEVERITIES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="inc-f-status">
              Status
            </label>
            <select id="inc-f-status" className="input w-[140px]" value={status ?? ''} onChange={(e) => update({ status: e.target.value })}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="inc-f-camera">
              Camera
            </label>
            <select id="inc-f-camera" className="input w-[180px]" value={camera} onChange={(e) => update({ camera: e.target.value === 'all' ? undefined : e.target.value })}>
              <option value="all">All cameras</option>
              {cameras.map((c) => (
                <option key={c.camera_id} value={c.camera_id}>
                  {c.name} ({c.camera_id})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="inc-f-type">
              Event type
            </label>
            <select id="inc-f-type" className="input w-[180px]" value={eventType ?? ''} onChange={(e) => update({ event_type: e.target.value })}>
              <option value="">All types</option>
              {eventTypes.map((t) => (
                <option key={t} value={t}>
                  {eventTypeLabel(t)}
                </option>
              ))}
              {eventType && !eventTypes.includes(eventType) && <option value={eventType}>{eventTypeLabel(eventType)}</option>}
            </select>
          </div>
          {hasFilters && (
            <button className="btn-ghost" onClick={clearFilters}>
              <X className="size-4" /> Clear
            </button>
          )}
        </div>

        {error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : !loading && data?.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No incidents match these filters' : 'No incidents yet'}
            description={hasFilters ? 'Try clearing filters.' : 'Incidents appear here as soon as the vision system reports them.'}
            action={
              hasFilters ? (
                <button className="btn-secondary" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">
                  {COLS.map((c, i) => (
                    <th key={i} scope="col" className="px-4 py-3 font-semibold first:w-[92px] last:w-10">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {loading
                  ? Array.from({ length: Math.min(size, 10) }, (_, i) => (
                      <tr key={i}>
                        {COLS.map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <Skeleton className={j === 0 ? 'h-10 w-16' : 'h-4 w-16'} />
                          </td>
                        ))}
                      </tr>
                    ))
                  : data?.items.map((inc) => (
                      <tr
                        key={inc.id}
                        onClick={() => open(inc.id)}
                        onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && (k.preventDefault(), open(inc.id))}
                        tabIndex={0}
                        className="group cursor-pointer transition-colors hover:bg-slate-50 focus-visible:bg-brand-50"
                        aria-label={`Incident ${inc.id}: ${inc.event_type}, ${inc.severity}, ${inc.status}`}
                      >
                        <td className="px-4 py-2">
                          <IncidentImage incident={inc} className="h-10 w-16 rounded-md ring-1 ring-line" />
                        </td>
                        <td className="px-4 py-2 font-mono font-medium text-slate-800">#{inc.id}</td>
                        <td className="px-4 py-2">
                          <p className="tabular font-medium text-slate-900">{fmtTime(inc.timestamp)}</p>
                          <p className="text-xs text-slate-500">{fmtDate(inc.timestamp)}</p>
                        </td>
                        <td className="px-4 py-2">
                          <p className="text-slate-800">{nameOf(inc.camera_id)}</p>
                          <p className="font-mono text-[11px] text-slate-500">{inc.camera_id}</p>
                        </td>
                        <td className="px-4 py-2 font-mono text-slate-800">{inc.person_id == null ? '—' : `#${inc.person_id}`}</td>
                        <td className="px-4 py-2 text-slate-800">{eventTypeLabel(inc.event_type)}</td>
                        <td className="px-4 py-2">
                          <SeverityBadge severity={inc.severity} />
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={inc.status} />
                        </td>
                        <td className="px-4 py-2 text-slate-300 group-hover:text-slate-500">
                          <ChevronRight className="size-4" />
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
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
              '0 incidents'
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

      {openId != null && <IncidentDrawer incidentId={openId} onClose={closeDrawer} onChanged={refresh} />}
    </>
  );
}
