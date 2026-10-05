import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LIVE } from '@/config/constants';
import { fmtConfidence, fmtTime } from '@/lib/format';
import { useCameraStore } from '@/store/cameraStore';
import { useEventStore } from '@/store/eventStore';
import { useUiStore } from '@/store/uiStore';
import { DirectionBadge } from '../common/DirectionBadge';
import { EmptyState, ErrorState, Skeleton } from '../common/States';
import { EventSnapshot } from './EventSnapshot';

export function RecentEvents() {
  const { recent, loading, error } = useEventStore();
  const load = useEventStore((s) => s.load);
  const cameraId = useCameraStore((s) => s.selectedId);
  const openEvent = useUiStore((s) => s.openEvent);
  const items = recent.slice(0, LIVE.recentCards);

  return (
    <section className="card p-4">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="card-title">Recent Events</h2>
          <p className="mt-0.5 text-xs text-slate-500">Snapshots captured at the moment of crossing</p>
        </div>
        <Link to="/events" className="btn-secondary py-1.5 text-xs">
          View all <ArrowRight className="size-3.5" />
        </Link>
      </header>
      {loading ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[178px] w-[184px] shrink-0 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load(cameraId)} compact />
      ) : items.length === 0 ? (
        <EmptyState title="No events recorded yet" description="When someone crosses the counting line, a snapshot appears here." />
      ) : (
        <ol className="scroll-thin -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
          {items.map((e) => (
            <li key={e.event_id} className="w-[184px] shrink-0 animate-slide-in snap-start">
              <button
                onClick={() => openEvent(e)}
                className="group w-full overflow-hidden rounded-xl border border-line bg-white text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-raised"
              >
                <div className="relative">
                  <EventSnapshot event={e} className="aspect-[16/10] w-full" />
                  <span className="absolute bottom-2 left-2">
                    <DirectionBadge direction={e.direction} />
                  </span>
                </div>
                <div className="px-3 py-2.5">
                  <p className="flex items-baseline justify-between">
                    <span className="font-mono text-[13px] font-semibold text-slate-900">ID #{e.track_id}</span>
                    <span className="tabular text-[12px] text-slate-600">{fmtTime(e.timestamp)}</span>
                  </p>
                  <p className="mt-1 text-[11.5px] text-slate-500">Confidence {fmtConfidence(e.confidence)}</p>
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
