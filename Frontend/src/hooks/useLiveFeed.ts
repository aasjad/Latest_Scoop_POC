import { useEffect } from 'react';
import { socket } from '@/api';
import { useAnalyticsStore } from '@/store/analyticsStore';
import { useCameraStore } from '@/store/cameraStore';
import { useConfigStore } from '@/store/configStore';
import { useConnectionStore } from '@/store/connectionStore';
import { resetEventStore, useEventStore } from '@/store/eventStore';
import { useUiStore } from '@/store/uiStore';
import { api } from '@/api';
import type { Point, WsMessage } from '@/types';

const HEALTH_POLL_MS = 15_000;

function loadCameraStatus(cameraId: string) {
  api
    .getCameraStatus(cameraId)
    .then((s) => s && useCameraStore.getState().setStatus(s))
    .catch(() => undefined);
}

function loadCameraData(cameraId: string) {
  void useAnalyticsStore.getState().load(cameraId);
  void useEventStore.getState().load(cameraId);
  void useConfigStore.getState().load(cameraId);
  loadCameraStatus(cameraId);
}

/** Periodic check: health, the selected camera's status, and the camera list until there is one. */
function poll() {
  void useConnectionStore.getState().loadHealth();
  const cams = useCameraStore.getState();
  // The list is empty until the Vision server has reported (or the first load failed) — keep asking.
  if (cams.cameras.length === 0 || cams.error) void cams.load();
  else if (cams.selectedId) loadCameraStatus(cams.selectedId);
}

function footOfTrack(trackId: number): Point | null {
  const t = useCameraStore.getState().tracks.find((tr) => tr.track_id === trackId);
  if (!t) return null;
  const [x, y, w, h] = t.bbox;
  return { x: x + w / 2, y: y + h };
}

function handleMessage(msg: WsMessage) {
  useConnectionStore.getState().touch();
  const selected = useCameraStore.getState().selectedId;
  switch (msg.type) {
    case 'PERSON_COUNT_EVENT': {
      const e = msg.data;
      if (e.camera_id !== selected) return;
      if (!useEventStore.getState().ingest(e)) return; // duplicate
      useAnalyticsStore.getState().applyEvent(e.direction);
      useUiStore.getState().notify(e, footOfTrack(e.track_id));
      return;
    }
    case 'CAMERA_CONFIG':
      // What Vision really uses now. Only `saved` changes, so a line being edited is not lost.
      if (msg.data.camera_id === selected) useConfigStore.setState({ saved: msg.data, loading: false, error: null });
      return;
    case 'TRACKS_UPDATE':
      useCameraStore.getState().setTracks(msg.data.camera_id, msg.data.tracks);
      return;
    case 'CAMERA_STATUS': {
      const cams = useCameraStore.getState();
      const id = msg.data.camera_id;
      const previous = cams.statuses[id];
      cams.setStatus(msg.data);
      // AI engine / tracker come from /health; refresh it now rather than at the next poll,
      // so they change together with the camera when Vision starts or stops.
      if (previous?.status !== msg.data.status) void useConnectionStore.getState().loadHealth();
      // A camera we have not listed yet: Vision just started reporting it.
      if (!cams.cameras.some((c) => c.camera_id === id)) {
        void cams.load();
        return;
      }
      // Vision is (back) online for the selected camera: fetch the counting line it is really
      // using (it may be new, and Vision only reports it once its pipeline is ready).
      if (id === selected && msg.data.status === 'online' && previous?.status !== 'online') {
        void useConfigStore.getState().load(id);
      }
      return;
    }
  }
}

/** Wires REST bootstrapping + WebSocket into the stores. Mount once at the app root. */
export function useLiveFeed() {
  const cameraId = useCameraStore((s) => s.selectedId);

  useEffect(() => {
    void useCameraStore.getState().load();
    void useConnectionStore.getState().loadHealth();
    const id = setInterval(poll, HEALTH_POLL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!cameraId) return;
    resetEventStore();
    useAnalyticsStore.setState({ counts: null, loading: true });
    loadCameraData(cameraId);
  }, [cameraId]);

  useEffect(() => {
    let wasOpen = false;
    const offState = socket.onStateChange((s) => {
      useConnectionStore.getState().setSocket(s);
      if (s === 'open') {
        // After a reconnect, events may have been missed — reconcile from REST.
        const id = useCameraStore.getState().selectedId;
        if (wasOpen && id) {
          void useAnalyticsStore.getState().load(id);
          void useEventStore.getState().load(id);
          // The backend restarted or the network dropped: the MJPEG connection is dead too.
          useCameraStore.getState().bumpVideo();
        }
        wasOpen = true;
      }
    });
    const offMsg = socket.onMessage(handleMessage);
    socket.connect();
    return () => {
      offState();
      offMsg();
      socket.close();
    };
  }, []);
}
