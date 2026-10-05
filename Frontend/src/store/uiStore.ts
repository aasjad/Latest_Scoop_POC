import { create } from 'zustand';
import { LIVE } from '@/config/constants';
import type { Direction, PersonCountEvent, Point } from '@/types';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

export interface CrossingFlash {
  id: string;
  direction: Direction;
  trackId: number;
  at: number;
  point: Point | null;
}

export type Panel = 'occupancy' | 'system' | 'shortcuts' | null;

const SIDEBAR_KEY = 'footfall-sidebar-collapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
};

interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  drawerEvent: PersonCountEvent | null;
  panel: Panel;
  toasts: Toast[];
  notifications: PersonCountEvent[];
  flashes: CrossingFlash[];
  focusTrack: { id: number; until: number } | null;
  highlightAllUntil: number;
  toggleSidebar(): void;
  setMobileNav(open: boolean): void;
  openEvent(e: PersonCountEvent | null): void;
  openPanel(p: Panel): void;
  toast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: number): void;
  notify(e: PersonCountEvent, point: Point | null): void;
  focusOnTrack(id: number | null): void;
  highlightAllTracks(): void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: readCollapsed(),
  mobileNavOpen: false,
  drawerEvent: null,
  panel: null,
  toasts: [],
  notifications: [],
  flashes: [],
  focusTrack: null,
  highlightAllUntil: 0,

  toggleSidebar() {
    const next = !get().sidebarCollapsed;
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
    set({ sidebarCollapsed: next });
  },
  setMobileNav: (mobileNavOpen) => set({ mobileNavOpen }),
  openEvent: (drawerEvent) => set({ drawerEvent, panel: null }),
  openPanel: (panel) => set({ panel, drawerEvent: null }),

  toast(t) {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismissToast(id), t.kind === 'error' ? 6000 : 3200);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  notify(e, point) {
    const flash: CrossingFlash = { id: e.event_id, direction: e.direction, trackId: e.track_id, at: Date.now(), point };
    set({ notifications: [e, ...get().notifications].slice(0, 3), flashes: [...get().flashes, flash].slice(-6) });
    setTimeout(() => set({ notifications: get().notifications.filter((n) => n.event_id !== e.event_id) }), LIVE.notificationTtlMs);
    setTimeout(() => set({ flashes: get().flashes.filter((f) => f.id !== e.event_id) }), LIVE.crossingFlashMs);
  },

  focusOnTrack(id) {
    set({ focusTrack: id == null ? null : { id, until: Date.now() + LIVE.trackFocusMs } });
  },
  highlightAllTracks: () => set({ highlightAllUntil: Date.now() + LIVE.highlightAllMs }),
}));
