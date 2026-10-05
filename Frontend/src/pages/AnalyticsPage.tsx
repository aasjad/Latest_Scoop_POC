import { useMemo, useState, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/api';
import { CHART_COLORS, ChartTooltip } from '@/components/charts/ChartTooltip';
import { PageHeader } from '@/components/common/PageHeader';
import { Segmented } from '@/components/common/Segmented';
import { ErrorState, Skeleton } from '@/components/common/States';
import { StatusPill } from '@/components/common/StatusIndicator';
import { SERIES_FETCH_LIMIT } from '@/config/constants';
import { useAsync } from '@/hooks/useMisc';
import { addToBuckets, buildWindow, DAY, hourlyProfile, occupancyTrend, peakHourGrid } from '@/lib/aggregate';
import { cn } from '@/lib/cn';
import { fmtDay, startOfDay } from '@/lib/format';
import { useCameraStore } from '@/store/cameraStore';

type Days = '7' | '14' | '30';
const DAY_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
] as const satisfies ReadonlyArray<{ value: Days; label: string }>;

const axis = { tickLine: false, axisLine: false, tick: { fontSize: 11, fill: CHART_COLORS.axis } } as const;

function ChartCard({ title, subtitle, children, className }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('card p-4', className)}>
      <h2 className="card-title">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card px-4 py-3.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const cameras = useCameraStore((s) => s.cameras);
  const statuses = useCameraStore((s) => s.statuses);
  const selected = useCameraStore((s) => s.selectedId);
  const [days, setDays] = useState<Days>('7');
  const [camera, setCamera] = useState<string>(selected ?? 'all');

  const { from, to } = useMemo(() => {
    const now = new Date();
    return { from: startOfDay(new Date(now.getTime() - (Number(days) - 1) * DAY)), to: now };
  }, [days]);

  // One fetch for all cameras; charts filter client-side so camera stats stay comparable.
  const q = useAsync((signal) => api.getEvents({ from: from.toISOString(), to: to.toISOString(), limit: SERIES_FETCH_LIMIT }, signal), [from, to]);
  const all = q.data?.items ?? [];
  const events = useMemo(() => (camera === 'all' ? all : all.filter((e) => e.camera_id === camera)), [all, camera]);

  const daily = useMemo(() => addToBuckets(buildWindow('custom', to, { from, to }).buckets, events), [events, from, to]);
  const hourly = useMemo(() => hourlyProfile(events, Number(days)), [events, days]);
  const dayList = useMemo(() => daily.slice(-7).map((b) => new Date(b.start)), [daily]);
  const grid = useMemo(() => peakHourGrid(events, dayList), [events, dayList]);
  const today = useMemo(() => {
    const todayEvents = events.filter((e) => Date.parse(e.timestamp) >= startOfDay(new Date()).getTime());
    return occupancyTrend(addToBuckets(buildWindow('today').buckets, todayEvents)).filter((b, i) => i >= 6 && b.start <= Date.now());
  }, [events]);

  const totals = daily.reduce((a, b) => ({ in: a.in + b.in, out: a.out + b.out }), { in: 0, out: 0 });
  const peakHour = hourly.reduce((best, h) => (h.in > best.in ? h : best), hourly[0]);
  const busiest = daily.reduce((best, d) => (d.in > best.in ? d : best), daily[0]);
  const gridMax = Math.max(1, ...grid.flatMap((r) => r.hours));
  const cameraStats = cameras.map((c) => {
    const list = all.filter((e) => e.camera_id === c.camera_id);
    const entries = list.filter((e) => e.direction === 'ENTRY').length;
    return { camera: c, entries, exits: list.length - entries };
  });
  const allEntries = cameraStats.reduce((s, c) => s + c.entries, 0) || 1;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Trends, peaks and per-camera performance."
        actions={
          <>
            <select className="input h-9 w-[190px]" value={camera} onChange={(e) => setCamera(e.target.value)} aria-label="Camera">
              <option value="all">All cameras</option>
              {cameras.map((c) => (
                <option key={c.camera_id} value={c.camera_id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Segmented ariaLabel="Date range" size="md" value={days} onChange={setDays} options={DAY_OPTIONS} />
          </>
        }
      />

      {q.error ? (
        <div className="card">
          <ErrorState message={q.error} onRetry={q.reload} />
        </div>
      ) : (
        <div className="space-y-4 lg:space-y-5">
          {q.data && q.data.total > q.data.items.length && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800 ring-1 ring-amber-200">
              Showing the latest {q.data.items.length.toLocaleString()} of {q.data.total.toLocaleString()} events — an aggregate endpoint is needed for exact long-range totals.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {q.loading ? (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />)
            ) : (
              <>
                <Stat label="Total entries" value={totals.in.toLocaleString()} hint={`${Math.round(totals.in / Number(days)).toLocaleString()} per day on average`} />
                <Stat label="Total exits" value={totals.out.toLocaleString()} hint={`${Math.round(totals.out / Number(days)).toLocaleString()} per day on average`} />
                <Stat label="Peak hour" value={peakHour?.in ? peakHour.label : '—'} hint={peakHour?.in ? `${peakHour.in} entries on average` : undefined} />
                <Stat label="Busiest day" value={busiest?.in ? fmtDay(busiest.start) : '—'} hint={busiest?.in ? `${busiest.in.toLocaleString()} entries` : undefined} />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
            <ChartCard title="Daily In / Out" subtitle="Entries and exits per day">
              <div className="h-60">
                {q.loading ? (
                  <Skeleton className="size-full" />
                ) : (
                  <ResponsiveContainer>
                    <BarChart data={daily} barGap={2} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
                      <XAxis dataKey="label" {...axis} minTickGap={12} />
                      <YAxis allowDecimals={false} {...axis} />
                      <Tooltip cursor={{ fill: 'rgb(148 163 184 / .12)' }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} />} />
                      <Bar dataKey="in" name="In" fill={CHART_COLORS.in} radius={[3, 3, 0, 0]} maxBarSize={22} />
                      <Bar dataKey="out" name="Out" fill={CHART_COLORS.out} radius={[3, 3, 0, 0]} maxBarSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </ChartCard>
            <ChartCard title="Hourly footfall" subtitle="Average per hour of day">
              <div className="h-60">
                {q.loading ? (
                  <Skeleton className="size-full" />
                ) : (
                  <ResponsiveContainer>
                    <LineChart data={hourly.slice(6)} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
                      <XAxis dataKey="label" {...axis} minTickGap={10} />
                      <YAxis {...axis} />
                      <Tooltip content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} />} />
                      <Line type="monotone" dataKey="in" name="In" stroke={CHART_COLORS.in} strokeWidth={2.2} dot={false} />
                      <Line type="monotone" dataKey="out" name="Out" stroke={CHART_COLORS.out} strokeWidth={2.2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-5">
            <ChartCard title="Peak hours" subtitle="Entries by day and hour (last 7 days)" className="lg:col-span-3">
              {q.loading ? (
                <Skeleton className="h-56" />
              ) : (
                <div className="scroll-thin overflow-x-auto">
                  <div className="min-w-[560px]">
                    <div className="grid grid-cols-[72px_repeat(17,1fr)] gap-1 text-[10.5px] text-slate-400">
                      <span />
                      {Array.from({ length: 17 }, (_, i) => (
                        <span key={i} className="text-center">
                          {String(i + 6).padStart(2, '0')}
                        </span>
                      ))}
                    </div>
                    {grid.map((row) => (
                      <div key={row.day.getTime()} className="mt-1 grid grid-cols-[72px_repeat(17,1fr)] gap-1">
                        <span className="self-center text-[11.5px] text-slate-500">{fmtDay(row.day).split(',')[0]}</span>
                        {row.hours.slice(6, 23).map((v, h) => (
                          <span
                            key={h}
                            title={`${fmtDay(row.day)} ${String(h + 6).padStart(2, '0')}:00 — ${v} entries`}
                            className="h-6 rounded"
                            style={{ background: v ? `color-mix(in oklab, var(--color-brand-500) ${12 + (v / gridMax) * 88}%, white)` : 'var(--color-slate-100)' }}
                          />
                        ))}
                      </div>
                    ))}
                    <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-slate-500">
                      Fewer
                      <span className="h-2 w-24 rounded-full bg-gradient-to-r from-brand-100 to-brand-500" />
                      More
                    </div>
                  </div>
                </div>
              )}
            </ChartCard>
            <ChartCard title="Occupancy trend" subtitle="People inside today, by hour" className="lg:col-span-2">
              <div className="h-56">
                {q.loading ? (
                  <Skeleton className="size-full" />
                ) : (
                  <ResponsiveContainer>
                    <AreaChart data={today} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="anOcc" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0" stopColor={CHART_COLORS.occ} stopOpacity={0.28} />
                          <stop offset="1" stopColor={CHART_COLORS.occ} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
                      <XAxis dataKey="label" {...axis} minTickGap={14} />
                      <YAxis allowDecimals={false} {...axis} />
                      <Tooltip content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} />} />
                      <Area type="monotone" dataKey="occupancy" name="Inside" stroke={CHART_COLORS.occ} strokeWidth={2} fill="url(#anOcc)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </ChartCard>
          </div>

          <section className="card overflow-hidden">
            <div className="p-4">
              <h2 className="card-title">Camera statistics</h2>
              <p className="mt-0.5 text-xs text-slate-500">Selected period, all cameras</p>
            </div>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-y border-line text-left text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">
                    <th className="px-4 py-2.5">Camera</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Entries</th>
                    <th className="px-4 py-2.5 text-right">Exits</th>
                    <th className="w-1/4 px-4 py-2.5">Share of entries</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {cameraStats.map(({ camera: c, entries, exits }) => (
                    <tr key={c.camera_id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{c.name}</p>
                        <p className="font-mono text-[11px] text-slate-500">{c.camera_id}</p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill state={statuses[c.camera_id]?.status ?? 'unknown'} size="sm" />
                      </td>
                      <td className="tabular px-4 py-3 text-right font-medium">{q.loading ? '…' : entries.toLocaleString()}</td>
                      <td className="tabular px-4 py-3 text-right font-medium">{q.loading ? '…' : exits.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(entries / allEntries) * 100}%` }} />
                          </div>
                          <span className="tabular w-10 text-right text-xs text-slate-500">{Math.round((entries / allEntries) * 100)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
