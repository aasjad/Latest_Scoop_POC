import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFootfallSeries } from '@/hooks/useFootfallSeries';
import { fromDateInput, toDateInput } from '@/lib/format';
import { useCameraStore } from '@/store/cameraStore';
import type { ChartRange } from '@/types';
import { Segmented } from '../common/Segmented';
import { ErrorState, Skeleton } from '../common/States';
import { CHART_COLORS, ChartTooltip } from './ChartTooltip';

const RANGES = [
  { value: 'live', label: 'Live' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: 'custom', label: 'Custom' },
] as const satisfies ReadonlyArray<{ value: ChartRange; label: string }>;

const SUBTITLE: Record<ChartRange, string> = {
  live: 'Last 30 minutes · per minute',
  today: 'Today · per hour',
  '7d': 'Last 7 days · per day',
  custom: 'Custom range',
};

const EARLY_HOURS = 6;

export function FootfallChart() {
  const cameraId = useCameraStore((s) => s.selectedId);
  const [range, setRange] = useState<ChartRange>('today');
  const today = toDateInput(new Date());
  const [customFrom, setCustomFrom] = useState(() => toDateInput(new Date(Date.now() - 3 * 86_400_000)));
  const [customTo, setCustomTo] = useState(today);
  const custom = useMemo(() => ({ from: fromDateInput(customFrom), to: fromDateInput(customTo) }), [customFrom, customTo]);
  const { buckets, loading, error, reload } = useFootfallSeries(range, cameraId, range === 'custom' ? custom : undefined);

  // Hide empty pre-opening hours on hourly views to keep bars readable.
  const data = useMemo(() => {
    if (buckets.length !== 24) return buckets;
    const first = buckets.findIndex((b) => b.in + b.out > 0);
    return buckets.slice(first < 0 ? EARLY_HOURS : Math.min(first, EARLY_HOURS));
  }, [buckets]);

  const totals = buckets.reduce((acc, b) => ({ in: acc.in + b.in, out: acc.out + b.out }), { in: 0, out: 0 });

  return (
    <section className="card flex flex-col p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="card-title">Footfall Trend</h2>
          <p className="mt-0.5 text-xs text-slate-500">{SUBTITLE[range]}</p>
        </div>
        <Segmented ariaLabel="Chart range" value={range} onChange={setRange} options={RANGES} />
      </header>

      {range === 'custom' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-slate-500">
            From
            <input type="date" className="input h-8 w-auto text-xs" value={customFrom} max={customTo} onChange={(e) => e.target.value && setCustomFrom(e.target.value)} />
          </label>
          <label className="flex items-center gap-1.5 text-slate-500">
            To
            <input type="date" className="input h-8 w-auto text-xs" value={customTo} min={customFrom} max={today} onChange={(e) => e.target.value && setCustomTo(e.target.value)} />
          </label>
        </div>
      )}

      <div className="mt-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-slate-600">
          <span className="size-2 rounded-full bg-in-500" /> In <b className="tabular font-semibold text-slate-900">{totals.in.toLocaleString()}</b>
        </span>
        <span className="flex items-center gap-1.5 text-slate-600">
          <span className="size-2 rounded-full bg-out-500" /> Out <b className="tabular font-semibold text-slate-900">{totals.out.toLocaleString()}</b>
        </span>
        {range === 'live' && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-out-600">
            <span className="size-1.5 animate-pulse rounded-full bg-out-500" /> Updating live
          </span>
        )}
      </div>

      <div className="mt-2 h-[210px] min-w-0">
        {error ? (
          <ErrorState message={error} onRetry={reload} compact />
        ) : loading && totals.in + totals.out === 0 ? (
          <Skeleton className="size-full" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={2} barCategoryGap={range === 'live' ? '18%' : '24%'} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: CHART_COLORS.axis }} minTickGap={14} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={44} />
              <Tooltip cursor={{ fill: 'rgb(148 163 184 / .12)' }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} />} />
              <Bar dataKey="in" name="In" fill={CHART_COLORS.in} radius={[3, 3, 0, 0]} maxBarSize={18} animationDuration={350} />
              <Bar dataKey="out" name="Out" fill={CHART_COLORS.out} radius={[3, 3, 0, 0]} maxBarSize={18} animationDuration={350} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
