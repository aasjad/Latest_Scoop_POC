import type { CountingLine, Direction, EntryDirection, Point } from '@/types';

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Signed side of a point relative to the line p1→p2.
 * < 0 → side A, > 0 → side B (screen space, y grows downwards).
 * Aspect is applied so the sign is independent of frame proportions.
 */
export function sideOf(line: CountingLine, p: Point, aspect = 16 / 9) {
  const { p1, p2 } = line;
  return ((p2.x - p1.x) * aspect) * (p.y - p1.y) - (p2.y - p1.y) * ((p.x - p1.x) * aspect);
}

/** Parameter of the projection of p onto the segment (0 = p1, 1 = p2). */
export function projectionT(line: CountingLine, p: Point, aspect = 16 / 9) {
  const { p1, p2 } = line;
  const dx = (p2.x - p1.x) * aspect;
  const dy = p2.y - p1.y;
  const len2 = dx * dx + dy * dy || 1;
  return ((p.x - p1.x) * aspect * dx + (p.y - p1.y) * dy) / len2;
}

/** Length in units of frame height. */
export function lineLength(line: CountingLine, aspect = 16 / 9) {
  return Math.hypot((line.p2.x - line.p1.x) * aspect, line.p2.y - line.p1.y);
}

export function midpoint(line: CountingLine): Point {
  return { x: (line.p1.x + line.p2.x) / 2, y: (line.p1.y + line.p2.y) / 2 };
}

/** Unit normal pointing from side A into side B, in pixel space. */
export function normalAtoB(line: CountingLine, w: number, h: number) {
  const dx = (line.p2.x - line.p1.x) * w;
  const dy = (line.p2.y - line.p1.y) * h;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/** How a crossing that starts on side A (or B) is counted under the given entry direction. */
export function crossingDirection(fromSideA: boolean, entry: EntryDirection): Direction {
  const isIn = fromSideA ? entry === 'A_TO_B' : entry === 'B_TO_A';
  return isIn ? 'ENTRY' : 'EXIT';
}

export function translateLine(line: CountingLine, dx: number, dy: number): CountingLine {
  const minX = Math.min(line.p1.x, line.p2.x);
  const maxX = Math.max(line.p1.x, line.p2.x);
  const minY = Math.min(line.p1.y, line.p2.y);
  const maxY = Math.max(line.p1.y, line.p2.y);
  const cdx = Math.min(Math.max(dx, -minX), 1 - maxX);
  const cdy = Math.min(Math.max(dy, -minY), 1 - maxY);
  return {
    p1: { x: line.p1.x + cdx, y: line.p1.y + cdy },
    p2: { x: line.p2.x + cdx, y: line.p2.y + cdy },
  };
}

export const linesEqual = (a: CountingLine, b: CountingLine) =>
  a.p1.x === b.p1.x && a.p1.y === b.p1.y && a.p2.x === b.p2.x && a.p2.y === b.p2.y;
