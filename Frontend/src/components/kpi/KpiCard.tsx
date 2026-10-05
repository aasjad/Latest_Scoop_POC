import { ChevronRight, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAnimatedNumber } from '@/hooks/useMisc';
import { cn } from '@/lib/cn';

export type KpiTone = 'in' | 'out' | 'occ' | 'trk';

const TONES: Record<KpiTone, string> = {
  in: 'from-in-600 to-in-800 shadow-[0_12px_28px_-16px_var(--color-in-700)]',
  out: 'from-out-600 to-out-800 shadow-[0_12px_28px_-16px_var(--color-out-700)]',
  occ: 'from-occ-500 to-occ-800 shadow-[0_12px_28px_-16px_var(--color-occ-700)]',
  trk: 'from-trk-500 to-trk-800 shadow-[0_12px_28px_-16px_var(--color-trk-700)]',
};

interface KpiCardProps {
  tone: KpiTone;
  label: string;
  value: number | null;
  icon: LucideIcon;
  footer: ReactNode;
  onClick(): void;
  actionLabel: string;
  children?: ReactNode;
}

export function KpiCard({ tone, label, value, icon: Icon, footer, onClick, actionLabel, children }: KpiCardProps) {
  const shown = useAnimatedNumber(value ?? 0);
  const prev = useRef(value);
  const [popKey, setPopKey] = useState(0);
  useEffect(() => {
    if (value != null && prev.current != null && value !== prev.current) setPopKey((k) => k + 1);
    prev.current = value;
  }, [value]);

  return (
    <button
      onClick={onClick}
      aria-label={`${label}: ${value ?? 'loading'}. ${actionLabel}`}
      className={cn(
        'group relative flex min-h-[132px] flex-col overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-left text-white transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-offset-4',
        TONES[tone],
      )}
    >
      <span className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-white/[0.07]" />
      <div className="flex items-center justify-between">
        <span className="grid size-9 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20">
          <Icon className="size-[18px]" strokeWidth={2.2} />
        </span>
        <span className="flex items-center gap-0.5 text-[11px] font-medium text-white/0 transition-colors group-hover:text-white/80">
          {actionLabel} <ChevronRight className="size-3.5" />
        </span>
      </div>
      <p className="mt-3 text-[13px] font-medium text-white/80">{label}</p>
      {value == null ? (
        <span className="mt-1 h-9 w-16 animate-pulse rounded-md bg-white/20" />
      ) : (
        <p key={popKey} className={cn('tabular origin-left text-[34px] leading-[1.1] font-semibold tracking-tight', popKey > 0 && 'animate-pop')}>
          {shown.toLocaleString()}
        </p>
      )}
      {children}
      <div className="mt-auto pt-1.5 text-[12px] text-white/75">{footer}</div>
    </button>
  );
}
