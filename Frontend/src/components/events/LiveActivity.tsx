import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LIVE } from '@/config/constants';
import { useNow } from '@/hooks/useMisc';
import { cn } from '@/lib/cn';
import { fmtRelative, fmtTime } from '@/lib/format';
import { useCameraStore } from '@/store/cameraStore';
import { useEventStore } from '@/store/eventStore';
import { useUiStore } from '@/store/uiStore';
import { EmptyState, ErrorState, Skeleton } from '../common/States';

export function LiveActivity() {
  const { recent, loading, error } = useEventStore();
  const load = useEventStore((s) => s.load);
  const cameraId = useCameraStore((s) => s.selectedId);
  const openEvent = useUiStore((s) => s.openEvent);
  const now = useNow(5000);
  const items = recent.slice(0, LIVE.activityItems);

  return (
    <section className="card flex flex-col p-4">
      <header className="flex items-center justify-between">
        <h2 className="card-title flex items-center gap-2">
          Live Activity
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-in-400 opacity-60" />
            <span className="relative size-2 rounded-full bg-in-500" />
          </span>
        </h2>
        <Link to="/events" className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
          All events <ArrowRight className="size-3.5" />
        </Link>
      </header>
      <div className="mt-3 flex-1">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load(cameraId)} compact />
        ) : items.length === 0 ? (
          <EmptyState title="No activity yet" description="Entries and exits will appear here the moment they happen." />
        ) : (
          <ol className="space-y-1">
            {items.map((e) => {
              const isIn = e.direction === 'ENTRY';
              return (
                <li key={e.event_id} className="animate-slide-in">
                  <button onClick={() => openEvent(e)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-slate-50">
                    <span className={cn('size-2 shrink-0 rounded-full', isIn ? 'bg-in-500' : 'bg-out-500')} />
                    <span className="w-12 font-mono font-semibold text-slate-800">#{e.track_id}</span>
                    <span className={cn('w-16 text-[11.5px] font-bold tracking-wide', isIn ? 'text-in-600' : 'text-out-600')}>{isIn ? 'ENTERED' : 'EXITED'}</span>
                    <span className="tabular ml-auto text-slate-700">{fmtTime(e.timestamp)}</span>
                    <span className="hidden w-14 text-right text-[11.5px] text-slate-400 sm:inline">{fmtRelative(e.timestamp, now)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
