import type { ChartRange, PersonCountEvent, SeriesBucket } from '@/types';
import { fmtDay, fmtShortTime, startOfDay } from './format';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export interface SeriesWindow {
  from: Date;
  to: Date;
  buckets: SeriesBucket[];
}

function fixedBuckets(from: number, to: number, step: number, label: (t: number) => string): SeriesBucket[] {
  const out: SeriesBucket[] = [];
  for (let t = from; t < to; t += step) out.push({ key: String(t), label: label(t), start: t, end: t + step, in: 0, out: 0 });
  return out;
}

/** One bucket per calendar day (DST-safe). */
function dayBuckets(from: Date, lastDay: Date): SeriesBucket[] {
  const out: SeriesBucket[] = [];
  const cursor = startOfDay(from);
  while (cursor.getTime() <= lastDay.getTime()) {
    const s = cursor.getTime();
    cursor.setDate(cursor.getDate() + 1);
    out.push({ key: String(s), label: fmtDay(s), start: s, end: cursor.getTime(), in: 0, out: 0 });
  }
  return out;
}

function hourBucketsForDay(day: Date): SeriesBucket[] {
  const s = startOfDay(day).getTime();
  const next = startOfDay(day);
  next.setDate(next.getDate() + 1);
  return fixedBuckets(s, next.getTime(), HOUR, fmtShortTime);
}

/** Empty buckets for a chart range. */
export function buildWindow(range: ChartRange, now = new Date(), custom?: { from: Date; to: Date }): SeriesWindow {
  let buckets: SeriesBucket[];
  if (range === 'live') {
    const end = Math.ceil((now.getTime() + 1) / MIN) * MIN;
    buckets = fixedBuckets(end - 30 * MIN, end, MIN, fmtShortTime);
  } else if (range === 'today') {
    buckets = hourBucketsForDay(now);
  } else {
    const from = range === '7d' ? new Date(startOfDay(now).getTime() - 6 * DAY + 2 * HOUR) : custom?.from ?? now;
    const to = range === '7d' ? now : custom?.to ?? now;
    const fromDay = startOfDay(from);
    const toDay = startOfDay(to);
    buckets = fromDay.getTime() === toDay.getTime() ? hourBucketsForDay(fromDay) : dayBuckets(fromDay, toDay);
  }
  return { from: new Date(buckets[0].start), to: new Date(buckets[buckets.length - 1].end), buckets };
}

function bucketIndex(buckets: SeriesBucket[], t: number) {
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t < buckets[mid].start) hi = mid - 1;
    else if (t >= buckets[mid].end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** Returns new buckets with the events counted in. */
export function addToBuckets(buckets: SeriesBucket[], events: PersonCountEvent[]) {
  const next = buckets.map((b) => ({ ...b }));
  for (const e of events) {
    const idx = bucketIndex(next, new Date(e.timestamp).getTime());
    if (idx < 0) continue;
    if (e.direction === 'ENTRY') next[idx].in += 1;
    else next[idx].out += 1;
  }
  return next;
}

/** Running occupancy (in − out), floored at zero. */
export function occupancyTrend(buckets: SeriesBucket[]) {
  let running = 0;
  return buckets.map((b) => {
    running = Math.max(0, running + b.in - b.out);
    return { label: b.label, start: b.start, occupancy: running };
  });
}

/** rows = days (oldest first), cols = hour of day, value = entries. */
export function peakHourGrid(events: PersonCountEvent[], days: Date[]) {
  const grid = days.map((d) => ({ day: d, hours: new Array<number>(24).fill(0) }));
  const index = new Map(days.map((d, i) => [startOfDay(d).getTime(), i]));
  for (const e of events) {
    if (e.direction !== 'ENTRY') continue;
    const t = new Date(e.timestamp);
    const row = index.get(startOfDay(t).getTime());
    if (row != null) grid[row].hours[t.getHours()] += 1;
  }
  return grid;
}

/** Average entries/exits per hour of day across `dayCount` days. */
export function hourlyProfile(events: PersonCountEvent[], dayCount: number) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${String(h).padStart(2, '0')}:00`, in: 0, out: 0 }));
  for (const e of events) {
    const h = new Date(e.timestamp).getHours();
    if (e.direction === 'ENTRY') hours[h].in += 1;
    else hours[h].out += 1;
  }
  const div = Math.max(1, dayCount);
  return hours.map((h) => ({ ...h, in: +(h.in / div).toFixed(1), out: +(h.out / div).toFixed(1) }));
}
