import { ChevronRight, CircleCheck, CircleX, RefreshCw, TriangleAlert } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/cn';
import { fmtRelative } from '@/lib/format';
import { useSelectedStatus } from '@/store/cameraStore';
import { deriveComponentStates, SYSTEM_COMPONENTS, useConnectionStore } from '@/store/connectionStore';
import { useUiStore } from '@/store/uiStore';
import type { ComponentState } from '@/types';
import { Drawer } from '../common/Drawer';
import { StatusDot, stateTone } from '../common/StatusIndicator';

function useComponentStates() {
  const status = useSelectedStatus();
  const conn = useConnectionStore(useShallow((s) => ({ health: s.health, healthError: s.healthError, socket: s.socket, lastHealthAt: s.lastHealthAt, lastMessageAt: s.lastMessageAt })));
  const states = deriveComponentStates(conn.health, conn.healthError, conn.socket, status?.status ?? null);
  return { states, ...conn };
}

const overallOf = (states: Record<string, ComponentState>) => {
  const v = Object.values(states);
  return v.includes('offline') ? 'offline' : v.includes('degraded') ? 'degraded' : v.includes('unknown') ? 'unknown' : 'online';
};

/** Compact status strip for the Live page. */
export function SystemHealth() {
  const { states } = useComponentStates();
  const openPanel = useUiStore((s) => s.openPanel);
  const overall = overallOf(states);
  return (
    <button onClick={() => openPanel('system')} className="card group w-full px-4 py-3 text-left transition-colors hover:border-line-strong">
      <div className="flex items-center justify-between">
        <h2 className="card-title">System Status</h2>
        <span className={cn('flex items-center gap-1 text-xs font-medium', stateTone(overall).text)}>
          {overall === 'online' ? 'All operational' : overall === 'degraded' ? 'Attention needed' : overall === 'offline' ? 'Issue detected' : 'Checking…'}
          <ChevronRight className="size-3.5 text-slate-400 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
      <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
        {SYSTEM_COMPONENTS.map((c) => (
          <li key={c.key} className="flex items-center gap-1.5 text-[12px] text-slate-600">
            <StatusDot state={states[c.key]} pulse={false} />
            <span className="truncate">{c.label}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}

const ICONS: Record<ComponentState, typeof CircleCheck> = { online: CircleCheck, degraded: TriangleAlert, offline: CircleX, unknown: RefreshCw };

export function SystemDiagnosticsDrawer() {
  const open = useUiStore((s) => s.panel === 'system');
  const openPanel = useUiStore((s) => s.openPanel);
  const { states, healthError, lastHealthAt, lastMessageAt } = useComponentStates();
  const loadHealth = useConnectionStore((s) => s.loadHealth);
  const overall = overallOf(states);

  return (
    <Drawer open={open} onClose={() => openPanel(null)} title="System Status" subtitle={lastHealthAt ? `Last checked ${fmtRelative(new Date(lastHealthAt).toISOString())}` : 'Checking…'}>
      <div className={cn('mb-5 flex items-center gap-3 rounded-xl px-4 py-3.5 ring-1', stateTone(overall).bg)}>
        <StatusDot state={overall} />
        <p className={cn('text-sm font-semibold', stateTone(overall).text)}>
          {overall === 'online' ? 'All systems operational' : overall === 'degraded' ? 'Some components need attention' : overall === 'offline' ? 'One or more components are down' : 'Checking components…'}
        </p>
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {SYSTEM_COMPONENTS.map((c) => {
          const st = states[c.key];
          const Icon = ICONS[st];
          return (
            <li key={c.key} className="flex items-center gap-3 px-4 py-3">
              <Icon className={cn('size-5 shrink-0', stateTone(st).text)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{c.label}</p>
                <p className="text-xs text-slate-500">{c.description}</p>
              </div>
              <span className={cn('text-xs font-medium', stateTone(st).text)}>{stateTone(st).label}</span>
            </li>
          );
        })}
      </ul>
      {healthError && <p className="mt-4 rounded-lg bg-out-50 px-3 py-2 text-[13px] text-out-700">Backend health check failed: {healthError}</p>}
      <dl className="mt-5 space-y-2 text-[13px]">
        <div className="flex justify-between">
          <dt className="text-slate-500">Last live message</dt>
          <dd className="text-slate-800">{lastMessageAt ? fmtRelative(new Date(lastMessageAt).toISOString()) : '—'}</dd>
        </div>
      </dl>
      <button onClick={() => void loadHealth()} className="btn-secondary mt-5 w-full">
        <RefreshCw className="size-4" /> Run check again
      </button>
    </Drawer>
  );
}
