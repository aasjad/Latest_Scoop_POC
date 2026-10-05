import { cn } from '@/lib/cn';
import type { ComponentState } from '@/types';

const TONE: Record<ComponentState, { dot: string; text: string; bg: string; label: string }> = {
  online: { dot: 'bg-in-500 text-in-500', text: 'text-in-700', bg: 'bg-in-50 ring-in-100', label: 'Online' },
  degraded: { dot: 'bg-amber-500 text-amber-500', text: 'text-amber-700', bg: 'bg-amber-50 ring-amber-100', label: 'Degraded' },
  offline: { dot: 'bg-out-500 text-out-500', text: 'text-out-700', bg: 'bg-out-50 ring-out-100', label: 'Offline' },
  unknown: { dot: 'bg-slate-400 text-slate-400', text: 'text-slate-600', bg: 'bg-slate-100 ring-slate-200', label: 'Unknown' },
};

export const stateTone = (s: ComponentState) => TONE[s];

export function StatusDot({ state, pulse = true, className }: { state: ComponentState; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2 shrink-0 rounded-full', TONE[state].dot, className)} aria-hidden>
      {pulse && state !== 'unknown' && <span className="absolute inset-0 animate-pulse-ring rounded-full" />}
    </span>
  );
}

interface StatusPillProps {
  state: ComponentState;
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
}

/** Coloured pill: ● Camera Online */
export function StatusPill({ state, label, className, size = 'md' }: StatusPillProps) {
  const t = TONE[state];
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-2 rounded-full font-medium ring-1 transition-colors duration-300',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-[13px]',
        t.bg,
        t.text,
        className,
      )}
    >
      <StatusDot state={state} />
      {label ?? t.label}
    </span>
  );
}
