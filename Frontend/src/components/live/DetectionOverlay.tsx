import { memo } from 'react';
import { FRAME } from '@/config/constants';
import { cn } from '@/lib/cn';
import type { Track, TrackStatus } from '@/types';

export const TRACK_COLOR: Record<TrackStatus, string> = {
  entering: '#22c55e',
  entered: '#22c55e',
  exiting: '#f43f5e',
  exited: '#f43f5e',
  tracking: '#38bdf8',
};

export const TRACK_STATUS_LABEL: Record<TrackStatus, string> = {
  entering: 'Entering',
  entered: 'Entered',
  exiting: 'Exiting',
  exited: 'Exited',
  tracking: 'In view',
};

interface DetectionOverlayProps {
  tracks: Track[];
  hoveredId: number | null;
  focusedId: number | null;
  highlightAll: boolean;
  interactive: boolean;
  onHover(id: number | null): void;
  onSelect(id: number): void;
}

const { w: W, h: H } = FRAME;

function Corners({ x, y, w, h, color, len }: { x: number; y: number; w: number; h: number; color: string; len: number }) {
  const l = Math.min(len, w / 3, h / 4);
  const d = `M${x},${y + l}V${y}H${x + l} M${x + w - l},${y}H${x + w}V${y + l} M${x + w},${y + h - l}V${y + h}H${x + w - l} M${x + l},${y + h}H${x}V${y + h - l}`;
  return <path d={d} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
}

/** Bounding boxes, IDs, foot points and trails. Coordinates are normalised → FRAME space. */
export const DetectionOverlay = memo(function DetectionOverlay({ tracks, hoveredId, focusedId, highlightAll, interactive, onHover, onSelect }: DetectionOverlayProps) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn('absolute inset-0 size-full', !interactive && 'pointer-events-none')} aria-hidden>
      {tracks.map((t) => {
        const [nx, ny, nw, nh] = t.bbox;
        const x = nx * W;
        const y = ny * H;
        const w = nw * W;
        const h = nh * H;
        const color = TRACK_COLOR[t.status];
        const counted = t.status === 'entered' || t.status === 'exited';
        const hovered = hoveredId === t.track_id;
        const focused = focusedId === t.track_id;
        const dimmed = focusedId != null && !focused;
        const emphasised = hovered || focused || highlightAll;
        const footX = x + w / 2;
        const footY = y + h;
        const labelW = 88;
        return (
          <g
            key={t.track_id}
            opacity={dimmed ? 0.3 : counted && !emphasised ? 0.6 : 1}
            className="transition-opacity duration-200"
            onPointerEnter={() => onHover(t.track_id)}
            onPointerLeave={() => onHover(null)}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(t.track_id);
            }}
            style={{ cursor: interactive ? 'pointer' : undefined }}
          >
            {focused && t.trail.length > 1 && (
              <polyline
                points={t.trail.map((p) => `${p.x * W},${p.y * H}`).join(' ')}
                fill="none"
                stroke={color}
                strokeWidth={3}
                strokeDasharray="2 6"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={4}
              fill={emphasised ? color : 'transparent'}
              fillOpacity={emphasised ? 0.12 : 0}
              stroke={color}
              strokeOpacity={emphasised ? 0.95 : 0.55}
              strokeWidth={emphasised ? 2 : 1.25}
              vectorEffect="non-scaling-stroke"
              pointerEvents="all"
              className={highlightAll ? 'animate-pulse' : undefined}
            />
            <Corners x={x} y={y} w={w} h={h} color={color} len={22} />
            <g transform={`translate(${x}, ${Math.max(0, y - 30)})`}>
              <rect width={labelW} height={28} rx={5} fill={color} />
              <text x={10} y={20} fill="#fff" fontSize={19} fontWeight={700} fontFamily="JetBrains Mono, monospace">
                ID {t.track_id}
              </text>
            </g>
            <circle cx={footX} cy={footY} r={focused || hovered ? 8 : 6} fill={color} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </svg>
  );
});
