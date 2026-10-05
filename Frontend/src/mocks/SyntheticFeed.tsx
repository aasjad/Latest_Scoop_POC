/**
 * MOCK ONLY — renders the simulated corridor "video". Lazy-loaded by VideoSurface,
 * so it is excluded from production builds (VITE_USE_MOCK=false).
 */
import { useMemo } from 'react';
import { FRAME } from '@/config/constants';
import { useCameraStore } from '@/store/cameraStore';
import type { CountingLine, PersonCountEvent, Track } from '@/types';
import { appearanceFor, BACK, corridorBackground, figureSvg, floorHalfWidth, personHeight } from './scene';
import { getPeople } from './simulator';

function FiguresLayer({ markup }: { markup: string }) {
  return <svg viewBox={`0 0 ${FRAME.w} ${FRAME.h}`} preserveAspectRatio="none" className="absolute inset-0 size-full" dangerouslySetInnerHTML={{ __html: markup }} />;
}

/** Live feed driven by the simulator (re-renders on every TRACKS_UPDATE). */
export function LiveSyntheticFeed({ cameraId }: { cameraId: string }) {
  useCameraStore((s) => s.tracks); // subscribe to frame ticks
  const people = [...getPeople(cameraId)].sort((a, b) => a.fy - b.fy);
  const markup = people
    .map((p) => {
      const x = 800 + (p.lane + Math.sin(p.wobble + p.fy / 140) * 0.03) * floorHalfWidth(p.fy);
      return figureSvg(x, p.fy, appearanceFor(`trk-${p.track_id}`), p.phase, p.dirY === -1);
    })
    .join('');
  return (
    <div className="absolute inset-0 bg-cover" style={{ backgroundImage: `url("${corridorBackground()}")` }}>
      <FiguresLayer markup={markup} />
    </div>
  );
}

export interface ReplayPerson {
  track_id: number;
  /** foot position in px */
  x: number;
  y: number;
  phase: number;
  facingAway: boolean;
}

const WALK_S = 7;

/**
 * Deterministically reconstructs walkers for recorded events: each event's person
 * crosses the counting line exactly at the event timestamp.
 */
export function replayPeople(events: PersonCountEvent[], line: CountingLine, entryAtoB: boolean, t: number): ReplayPerson[] {
  const out: ReplayPerson[] = [];
  const midY = ((line.p1.y + line.p2.y) / 2) * FRAME.h;
  for (const e of events) {
    const dt = (t - Date.parse(e.timestamp)) / 1000;
    if (Math.abs(dt) > WALK_S / 2) continue;
    const towardCamera = (e.direction === 'ENTRY') === entryAtoB;
    const progress = dt / WALK_S; // -0.5 … 0.5, crossing at 0
    const span = FRAME.h - BACK.floor;
    const y = midY + (towardCamera ? 1 : -1) * progress * span * 1.25;
    if (y < BACK.floor || y > FRAME.h + 180) continue;
    const lane = (((e.track_id * 37) % 100) / 100 - 0.5) * 1.1;
    const tAlong = 0.5 + lane * 0.35;
    const lineX = (line.p1.x + (line.p2.x - line.p1.x) * tAlong) * FRAME.w;
    // Walk along a ray from the vanishing point so the figure scales naturally with depth.
    const x = 800 + (lineX - 800) * (floorHalfWidth(y) / floorHalfWidth(midY));
    out.push({ track_id: e.track_id, x, y, phase: dt * 7.5, facingAway: !towardCamera });
  }
  return out.sort((a, b) => a.y - b.y);
}

/** Bounding boxes for replayed walkers, in the same shape the live tracker sends. */
export function replayTracks(people: ReplayPerson[], events: PersonCountEvent[], t: number): Track[] {
  return people.map((p) => {
    const h = personHeight(p.y) * 1.04;
    const w = h * 0.4;
    const e = events.find((ev) => ev.track_id === p.track_id);
    const crossed = e ? t >= Date.parse(e.timestamp) : false;
    const isIn = e?.direction === 'ENTRY';
    return {
      track_id: p.track_id,
      bbox: [(p.x - w / 2) / FRAME.w, (p.y - h) / FRAME.h, w / FRAME.w, (h + 8) / FRAME.h],
      confidence: e?.confidence ?? 0.9,
      status: crossed ? (isIn ? 'entered' : 'exited') : isIn ? 'entering' : 'exiting',
      trail: [],
    };
  });
}

export function ReplaySyntheticFeed({ people }: { people: ReplayPerson[] }) {
  const markup = useMemo(() => people.map((p) => figureSvg(p.x, p.y, appearanceFor(`trk-${p.track_id}`), p.phase, p.facingAway)).join(''), [people]);
  return (
    <div className="absolute inset-0 bg-cover" style={{ backgroundImage: `url("${corridorBackground()}")` }}>
      <FiguresLayer markup={markup} />
    </div>
  );
}
