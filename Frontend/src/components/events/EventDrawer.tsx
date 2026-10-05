import { CirclePlay, ListFilter } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtConfidence, fmtDate, fmtTime } from '@/lib/format';
import { useCameraStore } from '@/store/cameraStore';
import { useConfigStore } from '@/store/configStore';
import { useUiStore } from '@/store/uiStore';
import { DirectionBadge } from '../common/DirectionBadge';
import { Drawer } from '../common/Drawer';
import { EventSnapshot } from './EventSnapshot';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{children}</dd>
    </div>
  );
}

export function EventDrawer() {
  const event = useUiStore((s) => s.drawerEvent);
  const openEvent = useUiStore((s) => s.openEvent);
  const camera = useCameraStore((s) => s.cameras.find((c) => c.camera_id === event?.camera_id));
  const entry = useConfigStore((s) => (s.saved?.camera_id === event?.camera_id ? s.saved?.entry_direction : undefined));
  const navigate = useNavigate();
  const close = () => openEvent(null);

  if (!event) return null;
  const isIn = event.direction === 'ENTRY';
  // Which side the person came from, according to the camera's current line configuration.
  const sides = entry ? ((entry === 'A_TO_B') === isIn ? 'Side A → Side B' : 'Side B → Side A') : '—';

  return (
    <Drawer
      open
      onClose={close}
      title="Event Details"
      subtitle={<span className="font-mono text-xs">{event.event_id}</span>}
      footer={
        <div className="flex gap-2">
          <button
            className="btn-primary flex-1"
            onClick={() => {
              close();
              navigate(`/playback?camera=${encodeURIComponent(event.camera_id)}&t=${encodeURIComponent(event.timestamp)}&event=${encodeURIComponent(event.event_id)}`);
            }}
          >
            <CirclePlay className="size-4" /> View in Playback
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              close();
              navigate(`/events?track_id=${event.track_id}&camera=${encodeURIComponent(event.camera_id)}`);
            }}
            title="All events for this track"
          >
            <ListFilter className="size-4" /> Track
          </button>
        </div>
      }
    >
      <div className="relative overflow-hidden rounded-xl ring-1 ring-line">
        <EventSnapshot event={event} className="aspect-video w-full" />
        <span className="absolute top-3 left-3">
          <DirectionBadge direction={event.direction} size="md" />
        </span>
      </div>

      <div className={`mt-4 rounded-xl px-4 py-3 ${isIn ? 'bg-in-50 text-in-800' : 'bg-out-50 text-out-800'}`}>
        <p className="text-[11px] font-bold tracking-[0.1em]">{isIn ? 'PERSON ENTERED' : 'PERSON EXITED'}</p>
        <p className="mt-0.5 text-sm">
          Track <span className="font-mono font-semibold">#{event.track_id}</span> crossed the counting line at <span className="tabular font-semibold">{fmtTime(event.timestamp)}</span>
        </p>
      </div>

      <dl className="mt-4 divide-y divide-line">
        <Row label="Event">
          <DirectionBadge direction={event.direction} />
        </Row>
        <Row label="Track ID">
          <span className="font-mono">#{event.track_id}</span>
        </Row>
        <Row label="Time">
          <span className="tabular">{fmtTime(event.timestamp)}</span>
        </Row>
        <Row label="Date">{fmtDate(event.timestamp)}</Row>
        <Row label="Confidence">{fmtConfidence(event.confidence)}</Row>
        <Row label="Camera">
          {camera?.name ?? 'Camera'} <span className="ml-1 font-mono text-xs text-slate-500">{event.camera_id}</span>
        </Row>
        <Row label="Direction">{sides}</Row>
      </dl>
    </Drawer>
  );
}
