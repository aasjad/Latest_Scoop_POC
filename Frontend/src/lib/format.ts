import type { Direction } from '@/types';

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const shortTimeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export const fmtTime = (iso: string | number | Date) => timeFmt.format(new Date(iso));
export const fmtShortTime = (iso: string | number | Date) => shortTimeFmt.format(new Date(iso));
export const fmtDate = (iso: string | number | Date) => dateFmt.format(new Date(iso));
export const fmtDay = (iso: string | number | Date) => dayFmt.format(new Date(iso));
export const fmtDateTime = (iso: string | number | Date) => `${fmtDate(iso)}, ${fmtTime(iso)}`;

export const fmtConfidence = (c?: number) => (c == null ? '—' : `${Math.round(c * 100)}%`);
export const fmtNumber = (n: number) => n.toLocaleString();

export const directionLabel = (d: Direction) => (d === 'ENTRY' ? 'IN' : 'OUT');
export const directionVerb = (d: Direction) => (d === 'ENTRY' ? 'Entered' : 'Exited');

export function fmtDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function fmtRelative(iso: string, now = Date.now()) {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return fmtShortTime(iso);
}

/** yyyy-mm-dd in local time, for <input type="date"> */
export function toDateInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateInput(value: string) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfDay(d: Date) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function endOfDay(d: Date) {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}
