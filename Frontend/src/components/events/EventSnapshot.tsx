import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { PersonCountEvent } from '@/types';

/** Crossing snapshot, or a neutral placeholder if the backend provides none. */
export function EventSnapshot({ event, className }: { event: PersonCountEvent; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!event.snapshot_url || failed) {
    return (
      <div className={cn('grid place-items-center bg-slate-100 text-slate-400', className)}>
        <div className="text-center">
          <ImageOff className="mx-auto size-5" />
          <p className="mt-1 text-[11px]">No snapshot</p>
        </div>
      </div>
    );
  }
  return <img src={event.snapshot_url} alt={`Track ${event.track_id} crossing the line`} loading="lazy" onError={() => setFailed(true)} className={cn('object-cover', className)} />;
}
