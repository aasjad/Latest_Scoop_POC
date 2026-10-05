interface Item {
  name?: string | number;
  value?: unknown;
  color?: string;
  dataKey?: string | number | ((obj: unknown) => unknown);
}

/** Shared tooltip for all Recharts charts. */
export function ChartTooltip({ active, payload, label, title }: { active?: boolean; payload?: ReadonlyArray<Item>; label?: string | number; title?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-ink-900 px-3 py-2 text-xs text-white shadow-raised">
      <p className="mb-1 font-medium text-ink-300">{title ?? label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-ink-300">{p.name}</span>
          <span className="tabular ml-auto pl-3 font-semibold">{String(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

export const CHART_COLORS = { in: '#10b981', out: '#f43f5e', occ: '#2f6bff', grid: '#e9edf3', axis: '#94a3b8' } as const;
