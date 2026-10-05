import { ArrowLeft, Pause, Play, Rewind, FastForward, SkipBack, SkipForward, VideoOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import { DirectionBadge } from '@/components/common/DirectionBadge';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/common/States';
import { EventSnapshot } from '@/components/events/EventSnapshot';
import { CountingLineEditor } from '@/components/live/CountingLineEditor';
import { DetectionOverlay } from '@/components/live/DetectionOverlay';
import { Timeline } from '@/components/playback/Timeline';
import { useAsync } from '@/hooks/useMisc';
import { cn } from '@/lib/cn';
import { fmtConfidence, fmtDate, fmtTime } from '@/lib/format';
import { useCameraStore } from '@/store/cameraStore';
import { useUiStore } from '@/store/uiStore';
import type { CameraConfig, PersonCountEvent, RecordingSource } from '@/types';

type ReplayModule = typeof import('@/mocks/SyntheticFeed');

const HALF_WINDOW = 5 * 60_000;
const PRE_ROLL = 3000;
const SPEEDS = [0.5, 1, 2, 4] as const;

function useReplayModule() {
  const [mod, setMod] = useState<ReplayModule | null>(null);
  useEffect(() => {
    if (import.meta.env.VITE_USE_MOCK === 'true') void import('@/mocks/SyntheticFeed').then(setMod);
  }, []);
  return mod;
}

function PlayerSurface({ source, events, config, current, playing, speed, onVideoTime }: {
  source: RecordingSource | null;
  events: PersonCountEvent[];
  config: CameraConfig | null;
  current: number;
  playing: boolean;
  speed: number;
  onVideoTime(t: number): void;
}) {
  const mod = useReplayModule();
  const videoRef = useRef<HTMLVideoElement>(null);
  const startsAt = source?.kind === 'video' ? Date.parse(source.starts_at) : 0;

  // Keep an actual recording in sync with the timeline.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
    if (playing) void v.play().catch(() => undefined);
    else v.pause();
  }, [playing, speed]);
  useEffect(() => {
    const v = videoRef.current;
    if (v && !playing) v.currentTime = Math.max(0, (current - startsAt) / 1000);
  }, [current, playing, startsAt]);

  const recent = events.find((e) => {
    const d = current - Date.parse(e.timestamp);
    return d >= 0 && d < 1200;
  });

  if (!source) return <Skeleton className="absolute inset-0 rounded-none bg-ink-800" />;

  let surface: React.ReactNode;
  let tracks = null;
  if (source.kind === 'video') {
    surface = (
      <video ref={videoRef} src={source.url} muted playsInline onTimeUpdate={(e) => playing && onVideoTime(startsAt + e.currentTarget.currentTime * 1000)} className="absolute inset-0 size-full object-cover" />
    );
  } else if (source.kind === 'synthetic' && mod && config) {
    const people = mod.replayPeople(events, config.line, config.entry_direction === 'A_TO_B', current);
    surface = <mod.ReplaySyntheticFeed people={people} />;
    tracks = mod.replayTracks(people, events, current);
  } else if (source.kind === 'unavailable') {
    surface = (
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <VideoOff className="mx-auto mb-2 size-7 text-ink-500" />
          <p className="text-sm text-ink-300">No recording stored for this period</p>
          <p className="mt-1 text-xs text-ink-500">Event markers below are still available.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {surface}
      {tracks && <DetectionOverlay tracks={tracks} hoveredId={null} focusedId={null} highlightAll={false} interactive={false} onHover={() => undefined} onSelect={() => undefined} />}
      {config && source.kind !== 'unavailable' && (
        <CountingLineEditor line={config.line} entryDirection={config.entry_direction} mode="view" drawStart={null} flash={recent?.direction ?? null} onPlacePoint={() => undefined} onChange={() => undefined} />
      )}
      {recent && (
        <div className={cn('absolute top-3 right-3 animate-slide-in rounded-lg px-3 py-1.5 text-xs font-bold tracking-wide text-white', recent.direction === 'ENTRY' ? 'bg-in-600' : 'bg-out-600')}>
          {recent.direction === 'ENTRY' ? 'PERSON ENTERED' : 'PERSON EXITED'} · #{recent.track_id}
        </div>
      )}
    </>
  );
}

export default function PlaybackPage() {
  const [params, setParams] = useSearchParams();
  const selectedCamera = useCameraStore((s) => s.selectedId);
  const cameras = useCameraStore((s) => s.cameras);
  const openEvent = useUiStore((s) => s.openEvent);
  const cameraId = params.get('camera') ?? selectedCamera;
  const eventParam = params.get('event');
  const tParam = params.get('t');
  const camera = cameras.find((c) => c.camera_id === cameraId);

  // Window is fixed per URL (re-computed only when the requested time changes).
  const { from, to, start } = useMemo(() => {
    const now = Date.now();
    const center = tParam ? Date.parse(tParam) : now - 3 * 60_000;
    return { from: center - HALF_WINDOW, to: Math.min(now, center + HALF_WINDOW), start: tParam ? center - PRE_ROLL : center - HALF_WINDOW };
  }, [tParam]);

  const eventsQ = useAsync(
    (signal) => (cameraId ? api.getEvents({ camera_id: cameraId, from: new Date(from).toISOString(), to: new Date(to).toISOString(), limit: 500 }, signal) : Promise.resolve(null)),
    [cameraId, from, to],
  );
  const configQ = useAsync((signal) => (cameraId ? api.getConfig(cameraId, signal) : Promise.resolve(null)), [cameraId]);
  const sourceQ = useAsync(
    (signal) => (cameraId ? api.getRecording(cameraId, new Date(from).toISOString(), new Date(to).toISOString(), signal) : Promise.resolve(null)),
    [cameraId, from, to],
  );

  const events = useMemo(() => [...(eventsQ.data?.items ?? [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp)), [eventsQ.data]);
  const [current, setCurrent] = useState(start);
  const [playing, setPlaying] = useState(!!tParam);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [selectedId, setSelectedId] = useState<string | null>(eventParam);
  useEffect(() => {
    setCurrent(start);
    setPlaying(!!tParam);
    setSelectedId(eventParam);
  }, [start, tParam, eventParam]);

  // Synthetic / timeline clock (a real <video> reports its own time).
  const isVideo = sourceQ.data?.kind === 'video';
  useEffect(() => {
    if (!playing || isVideo) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      setCurrent((c) => {
        const next = c + dt * speed;
        if (next >= to) {
          setPlaying(false);
          return to;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, to, isVideo]);

  const seek = useCallback((t: number) => setCurrent(Math.min(to, Math.max(from, t))), [from, to]);
  const jumpTo = useCallback(
    (e: PersonCountEvent) => {
      setSelectedId(e.event_id);
      seek(Date.parse(e.timestamp) - PRE_ROLL);
      setPlaying(true);
      const next = new URLSearchParams(params);
      next.set('event', e.event_id);
      setParams(next, { replace: true });
    },
    [seek, params, setParams],
  );
  const prevEvent = [...events].reverse().find((e) => Date.parse(e.timestamp) < current - 500);
  const nextEvent = events.find((e) => Date.parse(e.timestamp) > current + PRE_ROLL + 500);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selected = events.find((e) => e.event_id === selectedId) ?? null;
  const error = eventsQ.error ?? configQ.error ?? sourceQ.error;

  return (
    <>
      <PageHeader
        title="Playback"
        description={`${camera?.name ?? 'Camera'} · ${fmtDate(from)} · ${fmtTime(from)} – ${fmtTime(to)}`}
        actions={
          <Link to="/live" className="btn-secondary">
            <ArrowLeft className="size-4" /> Back to Live
          </Link>
        }
      />
      {error ? (
        <div className="card">
          <ErrorState message={error} onRetry={() => (eventsQ.reload(), configQ.reload(), sourceQ.reload())} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
          <section className="self-start overflow-hidden rounded-2xl bg-ink-950 shadow-card lg:col-span-8">
            <div className="relative aspect-video bg-black">
              <PlayerSurface source={sourceQ.data} events={events} config={configQ.data} current={current} playing={playing} speed={speed} onVideoTime={setCurrent} />
              <span className="pointer-events-none absolute top-3 left-3 rounded-lg bg-ink-950/75 px-2.5 py-1 text-[12.5px] font-medium text-white backdrop-blur">
                {camera?.name} · <span className="font-mono text-ink-400">REPLAY</span>
              </span>
              <span className="tabular pointer-events-none absolute right-3 bottom-2.5 rounded bg-ink-950/60 px-2 py-0.5 font-mono text-[12px] text-white">{fmtTime(current)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1 border-t border-white/[0.06] px-3 py-2 text-white">
              <button className="grid size-9 place-items-center rounded-lg hover:bg-white/10 disabled:opacity-30" onClick={() => prevEvent && jumpTo(prevEvent)} disabled={!prevEvent} aria-label="Previous event" title="Previous event">
                <SkipBack className="size-4" />
              </button>
              <button className="grid size-9 place-items-center rounded-lg hover:bg-white/10" onClick={() => seek(current - 10_000)} aria-label="Back 10 seconds" title="Back 10 s">
                <Rewind className="size-4" />
              </button>
              <button className="grid size-10 place-items-center rounded-full bg-white text-ink-950 hover:bg-ink-300" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="ml-0.5 size-4" fill="currentColor" />}
              </button>
              <button className="grid size-9 place-items-center rounded-lg hover:bg-white/10" onClick={() => seek(current + 10_000)} aria-label="Forward 10 seconds" title="Forward 10 s">
                <FastForward className="size-4" />
              </button>
              <button className="grid size-9 place-items-center rounded-lg hover:bg-white/10 disabled:opacity-30" onClick={() => nextEvent && jumpTo(nextEvent)} disabled={!nextEvent} aria-label="Next event" title="Next event">
                <SkipForward className="size-4" />
              </button>
              <span className="tabular ml-2 font-mono text-[13px] text-ink-300">
                {fmtTime(current)} <span className="text-ink-500">/ {fmtTime(to)}</span>
              </span>
              <div className="ml-auto flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5" role="radiogroup" aria-label="Playback speed">
                {SPEEDS.map((s) => (
                  <button key={s} role="radio" aria-checked={speed === s} onClick={() => setSpeed(s)} className={cn('rounded-md px-2 py-1 text-[12px] font-medium', speed === s ? 'bg-white/15 text-white' : 'text-ink-400 hover:text-white')}>
                    {s}×
                  </button>
                ))}
              </div>
            </div>
            <Timeline from={from} to={to} current={current} events={events} selectedId={selectedId} onSeek={seek} onSelectEvent={jumpTo} />
          </section>

          <aside className="flex flex-col gap-4 lg:col-span-4">
            <section className="card p-4">
              <h2 className="card-title">Selected event</h2>
              {selected ? (
                <div className="mt-3">
                  <button onClick={() => openEvent(selected)} className="block w-full overflow-hidden rounded-xl ring-1 ring-line">
                    <EventSnapshot event={selected} className="aspect-video w-full" />
                  </button>
                  <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
                    <dt className="text-slate-500">Event</dt>
                    <dd className="text-right">
                      <DirectionBadge direction={selected.direction} />
                    </dd>
                    <dt className="text-slate-500">Track ID</dt>
                    <dd className="text-right font-mono font-medium">#{selected.track_id}</dd>
                    <dt className="text-slate-500">Time</dt>
                    <dd className="tabular text-right font-medium">{fmtTime(selected.timestamp)}</dd>
                    <dt className="text-slate-500">Confidence</dt>
                    <dd className="text-right font-medium">{fmtConfidence(selected.confidence)}</dd>
                  </dl>
                  <button onClick={() => jumpTo(selected)} className="btn-secondary mt-4 w-full">
                    <Play className="size-4" /> Replay this crossing
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Pick a marker on the timeline or an event from the list to inspect it.</p>
              )}
            </section>
            <section className="card flex min-h-0 flex-1 flex-col p-4">
              <h2 className="card-title">
                Events in this window <span className="ml-1 text-sm font-normal text-slate-400">{events.length}</span>
              </h2>
              <div className="scroll-thin mt-2 max-h-[340px] flex-1 overflow-y-auto">
                {eventsQ.loading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }, (_, i) => (
                      <Skeleton key={i} className="h-9" />
                    ))}
                  </div>
                ) : events.length === 0 ? (
                  <EmptyState title="No crossings in this window" />
                ) : (
                  <ol className="space-y-0.5">
                    {events.map((e) => (
                      <li key={e.event_id}>
                        <button
                          onClick={() => jumpTo(e)}
                          className={cn('flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-slate-50', e.event_id === selectedId && 'bg-brand-50 ring-1 ring-brand-100')}
                        >
                          <DirectionBadge direction={e.direction} size="xs" />
                          <span className="font-mono font-medium text-slate-800">#{e.track_id}</span>
                          <span className="tabular ml-auto text-slate-600">{fmtTime(e.timestamp)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
