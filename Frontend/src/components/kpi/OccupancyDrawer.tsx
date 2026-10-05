import { Settings2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFootfallSeries } from '@/hooks/useFootfallSeries';
import { occupancyTrend } from '@/lib/aggregate';
import { fmtShortTime } from '@/lib/format';
import { useAnalyticsStore } from '@/store/analyticsStore';
import { useCameraStore } from '@/store/cameraStore';
import { useConfigStore } from '@/store/configStore';
import { useUiStore } from '@/store/uiStore';
import { CHART_COLORS, ChartTooltip } from '../charts/ChartTooltip';
import { Drawer } from '../common/Drawer';
import { Skeleton } from '../common/States';
import { OccupancyBar } from './KpiRow';

function OccupancyContent() {
  const counts = useAnalyticsStore((s) => s.counts);
  const cameraId = useCameraStore((s) => s.selectedId);
  const capacity = useConfigStore((s) => s.saved?.capacity ?? null);
  const { buckets, loading } = useFootfallSeries('today', cameraId);
  const trend = useMemo(() => {
    const now = Date.now();
    return occupancyTrend(buckets).filter((b, i) => i >= 6 && b.start <= now); // from 06:00
  }, [buckets]);
  const peak = trend.reduce((best, b) => (b.occupancy > best.occupancy ? b : best), { occupancy: 0, start: 0, label: '' });
  const inside = Math.max(0, counts?.current_occupancy ?? 0);

  return (
    <>
      <div className="rounded-2xl bg-gradient-to-br from-occ-500 to-occ-800 p-5 text-white">
        <p className="text-sm text-white/80">Currently inside</p>
        <p className="tabular mt-1 text-5xl font-semibold tracking-tight">{counts ? inside : '—'}</p>
        {capacity ? (
          <>
            <OccupancyBar inside={inside} capacity={capacity} dark />
            <p className="mt-2 text-xs text-white/80">
              {Math.round((inside / capacity) * 100)}% of configured capacity ({capacity})
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs text-white/75">Live occupancy</p>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'Entries', value: counts?.total_entries, cls: 'text-in-600' },
          { label: 'Exits', value: counts?.total_exits, cls: 'text-out-600' },
          { label: 'Peak today', value: peak.occupancy || undefined, cls: 'text-slate-900' },
        ].map((m) => (
          <div key={m.label} className="rounded-xl border border-line px-2 py-3">
            <dt className="text-[11px] text-slate-500">{m.label}</dt>
            <dd className={`tabular mt-0.5 text-lg font-semibold ${m.cls}`}>{m.value ?? '—'}</dd>
          </div>
        ))}
      </dl>
      {peak.start > 0 && <p className="mt-2 text-xs text-slate-500">Peak of {peak.occupancy} reached around {fmtShortTime(peak.start)}.</p>}

      <h3 className="mt-6 mb-2 text-sm font-semibold text-slate-800">Occupancy today</h3>
      <div className="h-44">
        {loading ? (
          <Skeleton className="size-full" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 6, right: 4, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="occFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={CHART_COLORS.occ} stopOpacity={0.28} />
                  <stop offset="1" stopColor={CHART_COLORS.occ} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: CHART_COLORS.axis }} minTickGap={16} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: CHART_COLORS.axis }} />
              <Tooltip content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} />} />
              <Area type="monotone" dataKey="occupancy" name="Inside" stroke={CHART_COLORS.occ} strokeWidth={2} fill="url(#occFill)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-6 rounded-xl bg-slate-50 p-3.5 text-[12.5px] text-slate-600 ring-1 ring-line">
        <p>
          <b className="font-semibold text-slate-800">How it’s calculated:</b> Currently inside = Persons In − Persons Out since the start of the day. It assumes the space was empty at opening.
        </p>
        {!capacity && (
          <Link to="/settings#occupancy" className="mt-2 inline-flex items-center gap-1.5 font-medium text-brand-600 hover:text-brand-700">
            <Settings2 className="size-3.5" /> Set a capacity to see utilisation
          </Link>
        )}
      </div>
    </>
  );
}

export function OccupancyDrawer() {
  const open = useUiStore((s) => s.panel === 'occupancy');
  const openPanel = useUiStore((s) => s.openPanel);
  return (
    <Drawer open={open} onClose={() => openPanel(null)} title="Occupancy" subtitle="Live headcount for the selected entrance">
      {open && <OccupancyContent />}
    </Drawer>
  );
}
