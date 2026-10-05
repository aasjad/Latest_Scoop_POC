import { LoaderCircle, VideoOff } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useCameraStore } from '@/store/cameraStore';
import type { Camera } from '@/types';

// Mock-only synthetic video; tree-shaken from live builds.
const LiveSyntheticFeed = import.meta.env.VITE_USE_MOCK === 'true' ? lazy(() => import('@/mocks/SyntheticFeed').then((m) => ({ default: m.LiveSyntheticFeed }))) : null;

const VIDEO_FILE = /\.(mp4|webm|ogv|mov)(\?|#|$)/i;
const RETRY_MS = 3000;

function Placeholder({ title, detail, busy }: { title: string; detail: string; busy?: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_at_center,#1b2638_0%,#0a0f1a_75%)] text-center">
      <div>
        {busy ? <LoaderCircle className="mx-auto mb-3 size-7 animate-spin text-ink-500" /> : <VideoOff className="mx-auto mb-3 size-8 text-ink-500" />}
        <p className="text-sm font-medium text-ink-300">{title}</p>
        <p className="mt-1 text-xs text-ink-500">{detail}</p>
      </div>
    </div>
  );
}

/**
 * The processed camera stream. With a backend, `camera.stream_url` is the backend's MJPEG relay
 * of the frames Vision shows in its own window (boxes, IDs, counting line); an <img> renders it
 * natively. `live` is false while the camera is offline: nothing is requested then, and the
 * stream is re-opened when it comes back. Video files (.mp4/.webm) play looped in a <video>.
 */
export function VideoSurface({ camera, live = true }: { camera: Camera; live?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const epoch = useCameraStore((s) => s.videoEpoch);

  // A fresh connection whenever the camera (re)appears or the backend link was re-established.
  useEffect(() => {
    setFailed(false);
    setAttempt((a) => a + 1);
  }, [live, camera.stream_url, epoch]);

  // Live but not streaming yet (Vision still starting its video link): try again shortly.
  useEffect(() => {
    if (!live || !failed) return;
    const id = setTimeout(() => {
      setFailed(false);
      setAttempt((a) => a + 1);
    }, RETRY_MS);
    return () => clearTimeout(id);
  }, [live, failed]);

  if (camera.stream_url && VIDEO_FILE.test(camera.stream_url)) {
    if (failed) return <Placeholder title="Video stream interrupted" detail="Detection and counting continue in the background." />;
    return (
      <video
        key={camera.stream_url}
        src={camera.stream_url}
        autoPlay
        muted
        loop
        playsInline
        aria-label={`Live view of ${camera.name}`}
        onError={() => setFailed(true)}
        className="absolute inset-0 size-full object-cover"
      />
    );
  }
  if (LiveSyntheticFeed && !camera.stream_url) {
    return (
      <Suspense fallback={<div className="absolute inset-0 bg-ink-950" />}>
        <LiveSyntheticFeed cameraId={camera.camera_id} />
      </Suspense>
    );
  }
  if (!camera.stream_url) return <Placeholder title="Video stream not configured" detail="Detection and counting continue in the background." />;
  if (!live) return <Placeholder title="Stream unavailable" detail="The camera is offline - no frames from Vision." />;
  if (failed) return <Placeholder busy title="Connecting to live video…" detail="Waiting for Vision to send frames to the backend." />;

  const sep = camera.stream_url.includes('?') ? '&' : '?';
  return (
    <img
      key={attempt}
      src={`${camera.stream_url}${sep}attempt=${attempt}`}
      alt={`Live view of ${camera.name}`}
      onError={() => setFailed(true)}
      className="absolute inset-0 size-full object-cover"
    />
  );
}
