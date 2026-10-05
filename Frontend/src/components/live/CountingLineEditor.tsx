import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { FRAME } from '@/config/constants';
import { clamp01, normalAtoB, translateLine } from '@/lib/geometry';
import type { CountingLine, Direction, EntryDirection, Point } from '@/types';
import type { LineEditMode } from '@/store/configStore';

const { w: W, h: H } = FRAME;
const IN = '#22c55e';
const OUT = '#f43f5e';
const LINE = '#3b82f6';
const DRAFT = '#facc15';
const NUDGE = 0.004;

interface Props {
  line: CountingLine | null;
  entryDirection: EntryDirection;
  mode: LineEditMode;
  drawStart: Point | null;
  flash: Direction | null;
  onPlacePoint(p: Point): void;
  onChange(line: CountingLine): void;
}

type Drag = { kind: 'p1' | 'p2' | 'body'; origin: Point; line0: CountingLine } | null;

const px = (p: Point) => ({ x: p.x * W, y: p.y * H });

function Arrow({ at, dir, color, label }: { at: { x: number; y: number }; dir: { x: number; y: number }; color: string; label: string }) {
  const len = 54;
  const tail = { x: at.x - dir.x * len, y: at.y - dir.y * len };
  const tip = { x: at.x + dir.x * len, y: at.y + dir.y * len };
  const perp = { x: -dir.y, y: dir.x };
  const s = 26;
  const head = `${tip.x},${tip.y} ${tip.x - dir.x * s + perp.x * s * 0.75},${tip.y - dir.y * s + perp.y * s * 0.75} ${tip.x - dir.x * s - perp.x * s * 0.75},${tip.y - dir.y * s - perp.y * s * 0.75}`;
  const labelAt = { x: at.x - dir.x * (len + 34), y: at.y - dir.y * (len + 34) };
  return (
    <g style={{ filter: 'drop-shadow(0 2px 6px rgb(0 0 0 / .45))' }}>
      <line x1={tail.x} y1={tail.y} x2={tip.x - dir.x * s * 0.6} y2={tip.y - dir.y * s * 0.6} stroke={color} strokeWidth={14} strokeLinecap="round" />
      <polygon points={head} fill={color} strokeLinejoin="round" stroke={color} strokeWidth={4} />
      <g transform={`translate(${labelAt.x}, ${labelAt.y})`}>
        <rect x={-36} y={-19} width={72} height={38} rx={8} fill={color} />
        <text textAnchor="middle" y={9} fill="#fff" fontSize={25} fontWeight={800} letterSpacing={1}>
          {label}
        </text>
      </g>
    </g>
  );
}

function SideBadge({ at, label }: { at: { x: number; y: number }; label: string }) {
  return (
    <g transform={`translate(${at.x}, ${at.y})`}>
      <circle r={20} fill="rgb(15 23 42 / .78)" stroke="#fff" strokeOpacity={0.6} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <text textAnchor="middle" y={8} fill="#fff" fontSize={22} fontWeight={700}>
        {label}
      </text>
    </g>
  );
}

/**
 * Counting line with IN/OUT arrows. In edit mode the endpoints and the line body are
 * draggable (pointer + arrow keys); in draw mode two clicks create a new line.
 */
export function CountingLineEditor({ line, entryDirection, mode, drawStart, flash, onPlacePoint, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);

  const toNorm = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };

  const startDrag = (kind: 'p1' | 'p2' | 'body') => (e: ReactPointerEvent) => {
    if (mode !== 'edit' || !line) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    drag.current = { kind, origin: toNorm(e), line0: line };
    setDragging(true);
  };

  const onMove = (e: ReactPointerEvent) => {
    const p = toNorm(e);
    if (mode === 'draw') setCursor(p);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'body') onChange(translateLine(d.line0, p.x - d.origin.x, p.y - d.origin.y));
    else onChange({ ...d.line0, [d.kind]: p });
  };

  const endDrag = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    svgRef.current?.releasePointerCapture(e.pointerId);
    drag.current = null;
    setDragging(false);
  };

  const onKeyNudge = (kind: 'p1' | 'p2' | 'body') => (e: ReactKeyboardEvent) => {
    if (!line) return;
    const step = e.shiftKey ? NUDGE * 5 : NUDGE;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    if (kind === 'body') onChange(translateLine(line, delta[0], delta[1]));
    else onChange({ ...line, [kind]: { x: clamp01(line[kind].x + delta[0]), y: clamp01(line[kind].y + delta[1]) } });
  };

  const editing = mode === 'edit';
  const drawing = mode === 'draw';
  const showLine = line && !drawing;

  let decorations = null;
  if (showLine) {
    const a = px(line.p1);
    const b = px(line.p2);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = normalAtoB(line, W, H);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const inDir = entryDirection === 'A_TO_B' ? n : { x: -n.x, y: -n.y };
    const outDir = { x: -inDir.x, y: -inDir.y };
    const off = Math.min(len * 0.2, 220);
    const sideAt = { x: mid.x + u.x * Math.min(len * 0.42, 420), y: mid.y + u.y * Math.min(len * 0.42, 420) };
    decorations = (
      <>
        <Arrow at={{ x: mid.x - u.x * off, y: mid.y - u.y * off }} dir={inDir} color={IN} label="IN" />
        <Arrow at={{ x: mid.x + u.x * off, y: mid.y + u.y * off }} dir={outDir} color={OUT} label="OUT" />
        {(editing || dragging) && (
          <>
            <SideBadge at={{ x: sideAt.x - n.x * 62, y: sideAt.y - n.y * 62 }} label="A" />
            <SideBadge at={{ x: sideAt.x + n.x * 62, y: sideAt.y + n.y * 62 }} label="B" />
          </>
        )}
      </>
    );
  }

  const stroke = editing ? DRAFT : flash === 'ENTRY' ? IN : flash === 'EXIT' ? OUT : LINE;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="absolute inset-0 size-full touch-none select-none"
      style={{ pointerEvents: editing || drawing ? 'auto' : 'none', cursor: drawing ? 'crosshair' : dragging ? 'grabbing' : undefined }}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => drawing && setCursor(null)}
      onClick={(e) => drawing && onPlacePoint(toNorm(e))}
      role={drawing ? 'application' : undefined}
      aria-label={drawing ? 'Click two points on the video to draw the counting line' : undefined}
    >
      {editing && <rect width={W} height={H} fill="rgb(2 6 23 / .18)" pointerEvents="none" />}

      {showLine && (
        <g>
          <line x1={line.p1.x * W} y1={line.p1.y * H} x2={line.p2.x * W} y2={line.p2.y * H} stroke="#fff" strokeOpacity={0.35} strokeWidth={10} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <line
            x1={line.p1.x * W}
            y1={line.p1.y * H}
            x2={line.p2.x * W}
            y2={line.p2.y * H}
            stroke={stroke}
            strokeWidth={flash ? 6 : 4.5}
            strokeLinecap="round"
            strokeDasharray={editing ? '14 8' : undefined}
            vectorEffect="non-scaling-stroke"
            style={{ transition: 'stroke 200ms ease, stroke-width 200ms ease', filter: flash ? `drop-shadow(0 0 8px ${stroke})` : undefined }}
          />
          {editing && (
            <line
              x1={line.p1.x * W}
              y1={line.p1.y * H}
              x2={line.p2.x * W}
              y2={line.p2.y * H}
              stroke="transparent"
              strokeWidth={28}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: dragging ? 'grabbing' : 'move', outline: 'none' }}
              onPointerDown={startDrag('body')}
              tabIndex={0}
              aria-label="Counting line — drag or use arrow keys to move"
              onKeyDown={onKeyNudge('body')}
            />
          )}
          {decorations}
          {(['p1', 'p2'] as const).map((k) => (
            <g key={k}>
              <circle cx={line[k].x * W} cy={line[k].y * H} r={editing ? 15 : 12} fill={k === 'p1' ? '#ef4444' : LINE} stroke="#fff" strokeWidth={3} vectorEffect="non-scaling-stroke" />
              {editing && (
                <circle
                  cx={line[k].x * W}
                  cy={line[k].y * H}
                  r={36}
                  fill="transparent"
                  style={{ cursor: dragging ? 'grabbing' : 'grab', outline: 'none' }}
                  onPointerDown={startDrag(k)}
                  tabIndex={0}
                  aria-label={`Line endpoint ${k === 'p1' ? 1 : 2} — drag or use arrow keys`}
                  onKeyDown={onKeyNudge(k)}
                  className="focus-visible:stroke-white"
                  stroke="transparent"
                  strokeWidth={2}
                />
              )}
            </g>
          ))}
        </g>
      )}

      {drawing && (
        <g pointerEvents="none">
          <rect width={W} height={H} fill="rgb(2 6 23 / .28)" />
          {drawStart && cursor && (
            <line x1={drawStart.x * W} y1={drawStart.y * H} x2={cursor.x * W} y2={cursor.y * H} stroke={DRAFT} strokeWidth={4} strokeDasharray="12 8" vectorEffect="non-scaling-stroke" />
          )}
          {drawStart && <circle cx={drawStart.x * W} cy={drawStart.y * H} r={14} fill="#ef4444" stroke="#fff" strokeWidth={3} vectorEffect="non-scaling-stroke" />}
          {cursor && (
            <g stroke="#fff" strokeOpacity={0.8} strokeWidth={1.5} vectorEffect="non-scaling-stroke">
              <line x1={cursor.x * W - 22} y1={cursor.y * H} x2={cursor.x * W + 22} y2={cursor.y * H} vectorEffect="non-scaling-stroke" />
              <line x1={cursor.x * W} y1={cursor.y * H - 22} x2={cursor.x * W} y2={cursor.y * H + 22} vectorEffect="non-scaling-stroke" />
            </g>
          )}
        </g>
      )}
    </svg>
  );
}
