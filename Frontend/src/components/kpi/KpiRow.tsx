import { LogIn, LogOut, RefreshCw, ScanSearch, UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNow } from '@/hooks/useMisc';
import { fmtRelative, startOfDay } from '@/lib/format';
import { useAnalyticsStore } from '@/store/analyticsStore';
import { useCameraStore, useSelectedStatus } from '@/store/cameraStore';
import { useConfigStore } from '@/store/configStore';
import { useEventStore } from '@/store/eventStore';
import { useUiStore } from '@/store/uiStore';
import { KpiCard } from './KpiCard';

export function OccupancyBar({ inside, capacity, dark }: { inside: number; capacity: number; dark?: boolean }) {
  const pct = Math.min(100, Math.round((Math.max(0, inside) / capacity) * 100));
  const tone = pct >= 90 ? 'bg-out-400' : pct >= 75 ? 'bg-amber-400' : dark ? 'bg-white' : 'bg-brand-500';
  return (
    <div className="mt-1.5" aria-label={`Occupancy ${pct}% of ${capacity}`}>
      <div className={dark ? 'h-1.5 overflow-hidden rounded-full bg-white/20' : 'h-2 overflow-hidden rounded-full bg-slate-100'}>
        <div className={`h-full rounded-full transition-[width] duration-500 ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function KpiRow() {
  const navigate = useNavigate();
  const counts = useAnalyticsStore((s) => s.counts);
  const error = useAnalyticsStore((s) => s.error);
  const reload = useAnalyticsStore((s) => s.load);
  const cameraId = useCameraStore((s) => s.selectedId);
  const status = useSelectedStatus();
  const offline = status?.status === 'offline';
  // Vision is the source of truth: the tracker's live ID count from its heartbeat.
  const trackCount = status && !offline ? status.active_tracks : 0;
  const capacity = useConfigStore((s) => s.saved?.capacity ?? null);
  const recent = useEventStore((s) => s.recent);
  const openPanel = useUiStore((s) => s.openPanel);
  const highlightAll = useUiStore((s) => s.highlightAllTracks);
  const now = useNow(5000);

  const lastIn = recent.find((e) => e.direction === 'ENTRY');
  const lastOut = recent.find((e) => e.direction === 'EXIT');
  const todayFrom = startOfDay(new Date()).toISOString();
  const inside = counts?.current_occupancy ?? null;

  if (error && !counts) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-out-100 bg-out-50 px-4 py-3 text-sm text-out-700">
        Couldn’t load counts: {error}
        <button onClick={() => void reload(cameraId)} className="btn-secondary py-1 text-xs">
          <RefreshCw className="size-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <KpiCard
        tone="in"
        label="Persons In"
        icon={LogIn}
        value={counts?.total_entries ?? null}
        actionLabel="View entries"
        onClick={() => navigate(`/events?direction=ENTRY&from=${encodeURIComponent(todayFrom)}&camera=${cameraId ?? 'all'}`)}
        footer={lastIn ? `Last entry ${fmtRelative(lastIn.timestamp, now)}` : 'Today'}
      />
      <KpiCard
        tone="out"
        label="Persons Out"
        icon={LogOut}
        value={counts?.total_exits ?? null}
        actionLabel="View exits"
        onClick={() => navigate(`/events?direction=EXIT&from=${encodeURIComponent(todayFrom)}&camera=${cameraId ?? 'all'}`)}
        footer={lastOut ? `Last exit ${fmtRelative(lastOut.timestamp, now)}` : 'Today'}
      />
      <KpiCard
        tone="occ"
        label="Currently Inside"
        icon={UsersRound}
        value={inside == null ? null : Math.max(0, inside)}
        actionLabel="Details"
        onClick={() => openPanel('occupancy')}
        footer={capacity ? `${Math.min(100, Math.round((Math.max(0, inside ?? 0) / capacity) * 100))}% of ${capacity} capacity` : 'Live occupancy'}
      >
        {capacity && inside != null ? <OccupancyBar inside={inside} capacity={capacity} dark /> : null}
      </KpiCard>
      <KpiCard
        tone="trk"
        label="Active Tracks"
        icon={ScanSearch}
        value={offline ? 0 : trackCount}
        actionLabel="Highlight"
        onClick={highlightAll}
        footer={offline ? 'Camera offline' : 'Detected right now'}
      />
    </div>
  );
}
