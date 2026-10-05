import { useRef } from 'react';
import { cn } from '@/lib/cn';
import { fmtShortTime, fmtTime } from '@/lib/format';
import type { PersonCountEvent } from '@/types';

interface Props {
  from: number;
  to: number;
  current: number;
  events: PersonCountEvent[];
  selectedId: string | null;
  onSeek(t: number): void;
  onSelectEvent(e: PersonCountEvent): void;
}

const MIN = 60_000;

export function Timeline({ from, to, current, events, selectedId, onSeek, onSelectEvent }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const span = Math.max(1, to - from);
  const pct = (t: number) => `${((t - from) / span) * 100}%`;
  const timeAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return from + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span;
  };

  const ticks: number[] = [];
  for (let t = Math.ceil(from / MIN) * MIN; t <= to; t += MIN) ticks.push(t);
  const selected = events.find((e) => e.event_id === selectedId);
  // Keep the marker label inside the bar near either edge.
  const labelAlign = (t: number) => {
    const f = (t - from) / span;
    return f > 0.85 ? '-translate-x-full' : f < 0.15 ? '' : '-translate-x-1/2';
  };

  return (
    <div className="px-4 pt-3 pb-9 select-none">
      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label="Playback position"
        aria-valuemin={from}
        aria-valuemax={to}
        aria-valuenow={current}
        aria-valuetext={fmtTime(current)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onSeek(Math.max(from, current - 5000));
          else if (e.key === 'ArrowRight') onSeek(Math.min(to, current + 5000));
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onSeek(timeAt(e.clientX));
        }}
        onPointerMove={(e) => dragging.current && onSeek(timeAt(e.clientX))}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        className="relative h-10 cursor-pointer touch-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/10" />
        <div className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-brand-500/60" style={{ width: pct(current) }} />
        {ticks.map((t) => (
          <div key={t} className="absolute top-full -translate-x-1/2" style={{ left: pct(t) }}>
            <div className="mx-auto h-1.5 w-px bg-white/20" />
            <span className="tabular mt-0.5 block text-[10.5px] text-ink-500">{fmtShortTime(t)}</span>
          </div>
        ))}
        {events.map((e) => {
          const t = Date.parse(e.timestamp);
          const isSel = e.event_id === selectedId;
          return (
            <button
              key={e.event_id}
              onPointerDown={(ev) => ev.stopPropagation()}
              onClick={() => onSelectEvent(e)}
              title={`${e.direction === 'ENTRY' ? 'IN' : 'OUT'} · #${e.track_id} · ${fmtTime(t)}`}
              aria-label={`Jump to ${e.direction === 'ENTRY' ? 'entry' : 'exit'} of track ${e.track_id} at ${fmtTime(t)}`}
              className={cn(
                'absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ink-950 transition-transform hover:scale-125',
                e.direction === 'ENTRY' ? 'bg-in-500' : 'bg-out-500',
                isSel ? 'size-4 ring-white' : 'size-2.5',
              )}
              style={{ left: pct(t) }}
            />
          );
        })}
        <div className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_8px_rgb(255_255_255/0.6)]" style={{ left: pct(current) }}>
          <div className="absolute -top-1 left-1/2 size-3 -translate-x-1/2 rounded-full bg-white" />
        </div>
        {selected && (
          <div
            className={cn('pointer-events-none absolute top-[calc(100%+18px)] z-10 text-center whitespace-nowrap', labelAlign(Date.parse(selected.timestamp)))}
            style={{ left: pct(Date.parse(selected.timestamp)) }}
          >
            <span className={cn('rounded px-1.5 py-0.5 text-[10.5px] font-semibold text-white', selected.direction === 'ENTRY' ? 'bg-in-600' : 'bg-out-600')}>
              Event #{selected.track_id} · {fmtTime(selected.timestamp)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
