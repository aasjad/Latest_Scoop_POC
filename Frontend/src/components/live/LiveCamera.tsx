import { CameraOff, Crosshair, MousePointerClick, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useNow, useUntil } from '@/hooks/useMisc';
import { cn } from '@/lib/cn';
import { fmtConfidence, fmtTime } from '@/lib/format';
import { sideOf } from '@/lib/geometry';
import { useCameraStore, useSelectedCamera, useSelectedStatus } from '@/store/cameraStore';
import { selectIsDirty, useConfigStore } from '@/store/configStore';
import { useEventStore } from '@/store/eventStore';
import { useUiStore } from '@/store/uiStore';
import type { CountingLine, Track } from '@/types';
import { DirectionBadge } from '../common/DirectionBadge';
import { Skeleton } from '../common/States';
import { CameraToolbar, DirectionLegend } from './CameraToolbar';
import { CountingLineEditor } from './CountingLineEditor';
import { DetectionOverlay, TRACK_COLOR, TRACK_STATUS_LABEL } from './DetectionOverlay';
import { VideoSurface } from './VideoSurface';

/** "640 × 480" -> 4/3. The panel takes the camera's own shape, so the video fills it exactly
 *  and the normalized overlays (counting line, editor) sit where Vision draws them. */
function aspectOf(resolution: string | undefined): number {
  const m = resolution?.match(/(\d+)\s*[×x]\s*(\d+)/);
  const ratio = m ? Number(m[1]) / Number(m[2]) : NaN;
  return Number.isFinite(ratio) && ratio > 0.5 && ratio < 3 ? ratio : 16 / 9;
}

function HoverTooltip({ track }: { track: Track }) {
  const [x, y, w] = track.bbox;
  const right = x + w + 0.01;
  const flip = right > 0.78;
  return (
    <div
      className="pointer-events-none absolute z-20 w-44 animate-fade-in rounded-xl bg-ink-950/90 p-3 text-white shadow-raised ring-1 ring-white/10 backdrop-blur"
      style={{ left: flip ? undefined : `${right * 100}%`, right: flip ? `${(1 - x + 0.01) * 100}%` : undefined, top: `${Math.max(2, y * 100)}%` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-400 uppercase">Track ID</span>
        <span className="size-2 rounded-full" style={{ background: TRACK_COLOR[track.status] }} />
      </div>
      <p className="font-mono text-lg font-semibold">#{track.track_id}</p>
      <dl className="mt-2 grid grid-cols-2 gap-y-1 text-[12px]">
        <dt className="text-ink-400">Status</dt>
        <dd className="text-right font-medium" style={{ color: TRACK_COLOR[track.status] }}>
          {TRACK_STATUS_LABEL[track.status]}
        </dd>
        <dt className="text-ink-400">Confidence</dt>
        <dd className="tabular text-right">{fmtConfidence(track.confidence)}</dd>
        <dt className="text-ink-400">Tracking</dt>
        <dd className="text-right text-in-400">Active</dd>
      </dl>
      <p className="mt-2 flex items-center gap-1 border-t border-white/10 pt-2 text-[11px] text-ink-400">
        <MousePointerClick className="size-3" /> Click to follow
      </p>
    </div>
  );
}

function FocusCard({ trackId, track, line, onClose }: { trackId: number; track: Track | undefined; line: CountingLine | null; onClose(): void }) {
  const event = useEventStore((s) => s.recent.find((e) => e.track_id === trackId));
  let position = 'Left the frame';
  let movement = '—';
  if (track) {
    const [x, y, w, h] = track.bbox;
    const foot = { x: x + w / 2, y: y + h };
    position = line ? `Side ${sideOf(line, foot) < 0 ? 'A' : 'B'} of counting line` : 'In view';
    const first = track.trail[0];
    if (first) movement = foot.y < first.y - 0.01 ? 'Moving away from camera' : foot.y > first.y + 0.01 ? 'Moving toward camera' : 'Standing';
  }
  return (
    <div className="absolute bottom-3 left-3 z-20 w-60 animate-slide-in rounded-xl bg-ink-950/90 p-3.5 text-white shadow-raised ring-1 ring-white/10 backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Crosshair className="size-4 text-brand-400" /> Track <span className="font-mono">#{trackId}</span>
        </p>
        <button onClick={onClose} className="rounded px-1.5 text-[11px] text-ink-400 hover:bg-white/10 hover:text-white">
          Done
        </button>
      </div>
      <dl className="mt-2.5 space-y-1.5 text-[12px]">
        <div className="flex justify-between gap-2">
          <dt className="text-ink-400">Position</dt>
          <dd className="text-right">{position}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-400">Direction</dt>
          <dd className="text-right">{movement}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-ink-400">Event</dt>
          <dd className="text-right">{event ? <span className="inline-flex items-center gap-1.5"><DirectionBadge direction={event.direction} size="xs" /> {fmtTime(event.timestamp)}</span> : track ? 'Not counted yet' : '—'}</dd>
        </div>
      </dl>
    </div>
  );
}

function EventNotifications() {
  const notifications = useUiStore((s) => s.notifications);
  const openEvent = useUiStore((s) => s.openEvent);
  return (
    <div className="absolute top-3 right-3 z-20 hidden w-56 flex-col gap-2 sm:flex" aria-live="polite">
      {notifications.map((e) => {
        const isIn = e.direction === 'ENTRY';
        return (
          <button
            key={e.event_id}
            onClick={() => openEvent(e)}
            className={cn('animate-slide-in rounded-xl border-l-[3px] bg-ink-950/85 px-3 py-2.5 text-left text-white shadow-raised ring-1 ring-white/10 backdrop-blur hover:bg-ink-950', isIn ? 'border-in-500' : 'border-out-500')}
          >
            <p className={cn('text-[11px] font-bold tracking-[0.08em]', isIn ? 'text-in-400' : 'text-out-400')}>{isIn ? 'PERSON ENTERED' : 'PERSON EXITED'}</p>
            <p className="mt-0.5 flex items-baseline justify-between text-[12.5px]">
              <span className="font-mono font-semibold">Track #{e.track_id}</span>
              <span className="tabular text-ink-300">{fmtTime(e.timestamp)}</span>
            </p>
            <p className="text-[11.5px] text-ink-400">Confidence {fmtConfidence(e.confidence)}</p>
          </button>
        );
      })}
    </div>
  );
}

function CrossingPops() {
  const flashes = useUiStore((s) => s.flashes);
  return (
    <>
      {flashes
        .filter((f) => f.point)
        .map((f) => (
          <div
            key={f.id}
            className={cn('pointer-events-none absolute z-10 -translate-x-1/2 animate-float-up rounded-md px-2 py-0.5 text-sm font-bold text-white shadow-lg', f.direction === 'ENTRY' ? 'bg-in-500' : 'bg-out-500')}
            style={{ left: `${f.point!.x * 100}%`, top: `${f.point!.y * 100 - 6}%` }}
          >
            +1 {f.direction === 'ENTRY' ? 'IN' : 'OUT'}
          </div>
        ))}
    </>
  );
}

function EditBanner() {
  const { mode, drawStart, entry } = useConfigStore(useShallow((s) => ({ mode: s.mode, drawStart: s.drawStart, entry: s.draft?.entry_direction ?? s.saved?.entry_direction ?? 'B_TO_A' })));
  const dirty = useConfigStore(selectIsDirty);
  if (mode === 'view') return null;
  return (
    <div className="absolute top-12 left-1/2 z-20 -translate-x-1/2 animate-slide-in">
      <div className="flex flex-col items-center gap-1.5 rounded-xl bg-ink-950/90 px-4 py-2.5 text-center text-white shadow-raised ring-1 ring-amber-300/40 backdrop-blur">
        <p className="flex items-center gap-2 text-[11px] font-bold tracking-[0.12em] text-amber-300">
          <span className="size-1.5 animate-pulse rounded-full bg-amber-300" />
          {mode === 'draw' ? 'DRAWING MODE' : 'EDITING COUNTING LINE'}
          {dirty && mode === 'edit' && <span className="rounded bg-amber-300/15 px-1.5 py-px text-[10px] tracking-normal text-amber-200">Unsaved</span>}
        </p>
        <p className="text-[13px] text-ink-300">
          {mode === 'draw' ? (drawStart ? 'Click the ending point' : 'Click the starting point') : 'Drag the endpoints or the line · arrow keys nudge'}
        </p>
        {mode === 'edit' && <DirectionLegend direction={entry} compact />}
      </div>
    </div>
  );
}

export function LiveCamera() {
  const camera = useSelectedCamera();
  const status = useSelectedStatus();
  const tracks = useCameraStore((s) => s.tracks);
  const { saved, draft, mode, drawStart, loading: configLoading } = useConfigStore(
    useShallow((s) => ({ saved: s.saved, draft: s.draft, mode: s.mode, drawStart: s.drawStart, loading: s.loading })),
  );
  const { placePoint, setDraftLine } = useConfigStore.getState();
  const flashes = useUiStore((s) => s.flashes);
  const focusTrack = useUiStore((s) => s.focusTrack);
  const highlightAllUntil = useUiStore((s) => s.highlightAllUntil);
  const focusOnTrack = useUiStore((s) => s.focusOnTrack);
  const highlightAll = useUntil(highlightAllUntil);
  const focusActive = useUntil(focusTrack?.until ?? 0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const now = useNow(1000);

  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen?.();
  }, []);

  const line = draft?.line ?? saved?.line ?? null;
  const entry = draft?.entry_direction ?? saved?.entry_direction ?? 'B_TO_A';
  const offline = status?.status === 'offline';
  const degraded = status?.status === 'degraded';
  const aspect = aspectOf(camera?.resolution);
  const focusedId = focusActive ? focusTrack?.id ?? null : null;
  const hoveredTrack = mode === 'view' && hovered != null ? tracks.find((t) => t.track_id === hovered) : undefined;
  const lastFlash = flashes[flashes.length - 1];
  const flash = lastFlash && now - lastFlash.at < 1500 ? lastFlash.direction : null;

  return (
    <section
      ref={containerRef}
      className={cn('flex flex-col overflow-hidden bg-ink-950', fullscreen ? 'h-screen w-screen justify-center' : 'rounded-2xl shadow-card ring-1 ring-ink-900/10')}
      aria-label="Live camera"
    >
      <div
        className={cn('relative w-full bg-black', fullscreen && 'mx-auto max-h-[calc(100vh-49px)]')}
        style={{ aspectRatio: aspect, maxWidth: fullscreen ? `calc((100vh - 49px) * ${aspect})` : undefined }}
      >
        {camera ? <VideoSurface camera={camera} live={!offline} /> : <Skeleton className="absolute inset-0 rounded-none bg-ink-800" />}

        {!offline && (
          <DetectionOverlay
            tracks={tracks}
            hoveredId={hovered}
            focusedId={focusedId}
            highlightAll={highlightAll}
            interactive={mode === 'view'}
            onHover={setHovered}
            onSelect={(id) => focusOnTrack(focusedId === id ? null : id)}
          />
        )}
        {!configLoading && !offline && (
          <CountingLineEditor line={line} entryDirection={entry} mode={mode} drawStart={drawStart} flash={flash} onPlacePoint={placePoint} onChange={setDraftLine} />
        )}
        {!offline && <CrossingPops />}

        {/* OSD */}
        <div className="pointer-events-none absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-ink-950/75 px-2.5 py-1 text-[12.5px] font-medium text-white backdrop-blur">
            {camera?.name ?? '—'} <span className="ml-1 font-mono text-ink-400">{camera?.camera_id}</span>
          </span>
          {offline ? (
            <span className="rounded-lg bg-ink-950/75 px-2.5 py-1 text-[12px] font-semibold text-ink-300">NO SIGNAL</span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-lg bg-out-600/90 px-2 py-1 text-[11.5px] font-bold tracking-wide text-white">
              <span className="size-1.5 animate-pulse rounded-full bg-white" /> LIVE
            </span>
          )}
          {degraded && (
            <span className="flex items-center gap-1.5 rounded-lg bg-amber-500/95 px-2 py-1 text-[11.5px] font-semibold text-amber-950">
              <TriangleAlert className="size-3.5" /> Degraded · {status?.camera_fps.toFixed(1)} FPS
            </span>
          )}
        </div>
        {!offline && (
          <span className="pointer-events-none absolute right-3 bottom-2.5 z-10 font-mono text-[11px] text-white/70 [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]">
            {new Date(now).toISOString().slice(0, 19).replace('T', ' ')} UTC
          </span>
        )}
        {highlightAll && !offline && (
          <span className="pointer-events-none absolute bottom-2.5 left-1/2 z-10 -translate-x-1/2 animate-fade-in rounded-full bg-trk-500/90 px-3 py-1 text-[12px] font-medium text-white">
            {tracks.length} active {tracks.length === 1 ? 'track' : 'tracks'} highlighted
          </span>
        )}

        {mode === 'view' && <EventNotifications />}
        <EditBanner />
        {hoveredTrack && <HoverTooltip track={hoveredTrack} />}
        {focusedId != null && mode === 'view' && (
          <FocusCard trackId={focusedId} track={tracks.find((t) => t.track_id === focusedId)} line={line} onClose={() => focusOnTrack(null)} />
        )}

        {offline && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-ink-950/85 text-center backdrop-blur-sm">
            <div className="max-w-xs px-6">
              <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-out-500/15 text-out-400">
                <CameraOff className="size-6" />
              </div>
              <p className="font-semibold text-white">Camera offline</p>
              <p className="mt-1 text-sm text-ink-400">No frames received from {camera?.name ?? 'this camera'}. Counting is paused until the stream is restored.</p>
              <Link to="/cameras" className="mt-4 inline-flex text-sm font-medium text-brand-400 hover:text-brand-100">
                Open camera management →
              </Link>
            </div>
          </div>
        )}
      </div>
      <CameraToolbar fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen} locked={offline} />
    </section>
  );
}
