import { PanelLeftClose, PanelLeftOpen, ScanFace, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/cn';
import { fmtDuration } from '@/lib/format';
import { useSelectedStatus } from '@/store/cameraStore';
import { deriveComponentStates, useConnectionStore } from '@/store/connectionStore';
import { useUiStore } from '@/store/uiStore';
import { StatusDot } from '../common/StatusIndicator';
import { NAV_ITEMS } from './nav';

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn('flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.06]', collapsed ? 'justify-center px-0' : 'px-5')}>
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-[0_6px_18px_-6px_var(--color-brand-500)]">
        <ScanFace className="size-5 text-white" strokeWidth={2.2} />
      </div>
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <p className="text-[15px] font-semibold tracking-tight text-white">Footfall AI</p>
          <p className="truncate text-[11.5px] text-ink-400">People Counting Analytics</p>
        </div>
      )}
    </div>
  );
}

function SystemCard({ collapsed }: { collapsed: boolean }) {
  const status = useSelectedStatus();
  const { health, healthError, socket } = useConnectionStore(useShallow((s) => ({ health: s.health, healthError: s.healthError, socket: s.socket })));
  const openPanel = useUiStore((s) => s.openPanel);
  const states = deriveComponentStates(health, healthError, socket, status?.status ?? null);
  const values = Object.values(states);
  const overall = values.includes('offline') ? 'offline' : values.includes('degraded') ? 'degraded' : values.includes('unknown') ? 'unknown' : 'online';
  const label = overall === 'online' ? 'All systems running' : overall === 'degraded' ? 'Needs attention' : overall === 'offline' ? 'System issue' : 'Checking…';

  if (collapsed) {
    return (
      <button onClick={() => openPanel('system')} className="mx-auto grid size-10 place-items-center rounded-lg hover:bg-white/5" aria-label={`System status: ${label}`} title={label}>
        <StatusDot state={overall} />
      </button>
    );
  }
  return (
    <button onClick={() => openPanel('system')} className="w-full rounded-xl bg-white/[0.04] p-3.5 text-left ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.07]">
      <div className="flex items-center gap-2">
        <StatusDot state={overall} />
        <span className={cn('text-[13px] font-medium', overall === 'online' ? 'text-in-400' : overall === 'degraded' ? 'text-amber-400' : 'text-out-400')}>{label}</span>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
        <dt className="text-ink-400">Model</dt>
        <dd className="text-right text-ink-300">{status?.model ?? '—'}</dd>
        <dt className="text-ink-400">Inference</dt>
        <dd className="tabular text-right text-ink-300">{status && status.status !== 'offline' ? `${status.inference_fps.toFixed(1)} FPS` : '—'}</dd>
        <dt className="text-ink-400">Uptime</dt>
        <dd className="tabular text-right text-ink-300">{status && status.uptime_s ? fmtDuration(status.uptime_s) : '—'}</dd>
      </dl>
    </button>
  );
}

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            cn(
              'group relative flex h-11 items-center gap-3 rounded-xl text-[14px] font-medium transition-all duration-200',
              collapsed ? 'justify-center px-0' : 'px-3.5',
              isActive
                ? 'bg-brand-500 text-white shadow-[0_8px_20px_-10px_var(--color-brand-500)]'
                : 'text-ink-300 hover:bg-white/[0.05] hover:text-white',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={cn('size-[19px] shrink-0', isActive ? 'text-white' : 'text-ink-400 group-hover:text-white')} />
              {!collapsed && <span className="truncate">{label}</span>}
              {to === '/live' && (
                <span className={cn('size-1.5 rounded-full bg-out-500', collapsed ? 'absolute top-2.5 right-3' : 'ml-auto')} aria-label="live" />
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function Sidebar({ forceCollapsed }: { forceCollapsed: boolean }) {
  const userCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const collapsed = forceCollapsed || userCollapsed;

  return (
    <aside
      className={cn(
        'relative hidden shrink-0 flex-col bg-ink-900 transition-[width] duration-300 ease-out md:flex',
        collapsed ? 'w-[76px]' : 'w-[248px]',
      )}
    >
      <Brand collapsed={collapsed} />
      <div className={cn('flex-1 overflow-y-auto py-5', collapsed ? 'px-3' : 'px-4')}>
        {!collapsed && <p className="mb-2 px-3.5 text-[10.5px] font-semibold tracking-[0.12em] text-ink-500 uppercase">Monitor</p>}
        <NavList collapsed={collapsed} />
      </div>
      <div className={cn('space-y-3 pb-4', collapsed ? 'px-3' : 'px-4')}>
        <SystemCard collapsed={collapsed} />
        {!forceCollapsed && (
          <button
            onClick={toggle}
            className={cn('flex h-9 w-full items-center gap-2 rounded-lg text-[13px] text-ink-400 hover:bg-white/5 hover:text-white', collapsed ? 'justify-center' : 'px-3')}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
            {!collapsed && 'Collapse'}
          </button>
        )}
      </div>
    </aside>
  );
}

/** Slide-over navigation for phones. */
export function MobileNav() {
  const open = useUiStore((s) => s.mobileNavOpen);
  const setOpen = useUiStore((s) => s.setMobileNav);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 animate-fade-in bg-ink-950/50" onClick={() => setOpen(false)} />
      <aside className="absolute inset-y-0 left-0 flex w-[270px] animate-fade-in flex-col bg-ink-900">
        <div className="flex items-center justify-between pr-3">
          <Brand collapsed={false} />
          <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-ink-300 hover:bg-white/5" aria-label="Close navigation">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 px-4 py-5">
          <NavList collapsed={false} onNavigate={() => setOpen(false)} />
        </div>
        <div className="px-4 pb-4">
          <SystemCard collapsed={false} />
        </div>
      </aside>
    </div>
  );
}
