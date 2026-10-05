import { ChevronDown, Keyboard, LogOut, Menu, UserRound } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useClickOutside } from '@/hooks/useDom';
import { useNow } from '@/hooks/useMisc';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/cn';
import { fmtDate, fmtTime } from '@/lib/format';
import { useSelectedStatus } from '@/store/cameraStore';
import { deriveComponentStates, useConnectionStore } from '@/store/connectionStore';
import { useUiStore } from '@/store/uiStore';
import { StatusDot, StatusPill } from '../common/StatusIndicator';
import { CameraSelector } from './CameraSelector';

function Clock() {
  const now = useNow(1000);
  return (
    <div className="hidden text-right leading-tight sm:block">
      <p className="tabular font-mono text-[15px] font-semibold text-slate-900">{fmtTime(now)}</p>
      <p className="text-[11.5px] text-slate-500">{fmtDate(now)}</p>
    </div>
  );
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);
  const openPanel = useUiStore((s) => s.openPanel);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-2 rounded-xl py-1 pr-2 pl-1 hover:bg-slate-100">
        <span className="grid size-8 place-items-center rounded-full bg-ink-900 text-[12px] font-semibold text-white">AD</span>
        <span className="hidden text-sm font-medium text-slate-700 lg:inline">Admin</span>
        <ChevronDown className="hidden size-4 text-slate-400 lg:inline" />
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-40 mt-2 w-60 animate-slide-in rounded-xl border border-line bg-white p-1 shadow-raised">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <span className="grid size-9 place-items-center rounded-full bg-slate-100 text-slate-500">
              <UserRound className="size-4" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-medium text-slate-800">Admin</p>
              <p className="text-xs text-slate-500">Administrator</p>
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <button
            role="menuitem"
            onClick={() => {
              openPanel('shortcuts');
              close();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <Keyboard className="size-4 text-slate-400" /> Keyboard shortcuts
          </button>
          <button role="menuitem" disabled className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-400" title="Authentication is not configured">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function TopHeader() {
  const status = useSelectedStatus();
  const { health, healthError, socket } = useConnectionStore(useShallow((s) => ({ health: s.health, healthError: s.healthError, socket: s.socket })));
  const openPanel = useUiStore((s) => s.openPanel);
  const setMobileNav = useUiStore((s) => s.setMobileNav);
  const states = deriveComponentStates(health, healthError, socket, status?.status ?? null);
  const camState = status?.status ?? 'unknown';
  const camLabel = camState === 'online' ? 'Camera Online' : camState === 'degraded' ? 'Camera Degraded' : camState === 'offline' ? 'Camera Offline' : 'Connecting…';

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-white/85 px-4 backdrop-blur-md md:px-6">
      <button onClick={() => setMobileNav(true)} className="btn-ghost -ml-1 p-2 md:hidden" aria-label="Open navigation">
        <Menu className="size-5" />
      </button>
      <CameraSelector />
      <span className="hidden sm:block">
        <StatusPill state={camState} label={camLabel} />
      </span>

      <div className="ml-auto flex items-center gap-1 sm:gap-3">
        <button
          onClick={() => openPanel('system')}
          className="hidden items-center gap-4 rounded-xl px-3 py-1.5 text-[12.5px] text-slate-600 ring-1 ring-line transition-colors hover:bg-slate-50 lg:flex"
          aria-label="Open system status"
        >
          <span className="flex items-center gap-1.5">
            <StatusDot state={states.ai_engine} pulse={false} /> AI Engine
          </span>
          <span className="flex items-center gap-1.5">
            <StatusDot state={states.websocket} pulse={false} />
            {socket === 'open' ? 'Live' : socket === 'closed' ? 'Disconnected' : 'Reconnecting…'}
          </span>
        </button>
        <Clock />
        <div className="mx-1 hidden h-8 w-px bg-line sm:block" />
        <button onClick={() => openPanel('shortcuts')} className={cn('btn-ghost hidden p-2 sm:inline-flex')} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          <Keyboard className="size-[18px]" />
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
