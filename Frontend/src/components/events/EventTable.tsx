import { ChevronRight } from 'lucide-react';
import { fmtConfidence, fmtDate, fmtTime } from '@/lib/format';
import type { Camera, PersonCountEvent } from '@/types';
import { DirectionBadge } from '../common/DirectionBadge';
import { Skeleton } from '../common/States';
import { EventSnapshot } from './EventSnapshot';

interface Props {
  events: PersonCountEvent[];
  cameras: Camera[];
  loading: boolean;
  rows: number;
  onOpen(e: PersonCountEvent): void;
}

const COLS = ['', 'Timestamp', 'Camera', 'Track ID', 'Event', 'Confidence', ''];

export function EventTable({ events, cameras, loading, rows, onOpen }: Props) {
  const nameOf = (id: string) => cameras.find((c) => c.camera_id === id)?.name ?? id;
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">
            {COLS.map((c, i) => (
              <th key={i} scope="col" className="px-4 py-3 font-semibold first:w-[92px] last:w-10">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {loading
            ? Array.from({ length: Math.min(rows, 10) }, (_, i) => (
                <tr key={i}>
                  {COLS.map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className={j === 0 ? 'h-10 w-16' : 'h-4 w-20'} />
                    </td>
                  ))}
                </tr>
              ))
            : events.map((e) => (
                <tr
                  key={e.event_id}
                  onClick={() => onOpen(e)}
                  onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && (k.preventDefault(), onOpen(e))}
                  tabIndex={0}
                  className="group cursor-pointer transition-colors hover:bg-slate-50 focus-visible:bg-brand-50"
                  aria-label={`${e.direction === 'ENTRY' ? 'Entry' : 'Exit'} by track ${e.track_id} at ${fmtTime(e.timestamp)}`}
                >
                  <td className="px-4 py-2">
                    <EventSnapshot event={e} className="h-10 w-16 rounded-md ring-1 ring-line" />
                  </td>
                  <td className="px-4 py-2">
                    <p className="tabular font-medium text-slate-900">{fmtTime(e.timestamp)}</p>
                    <p className="text-xs text-slate-500">{fmtDate(e.timestamp)}</p>
                  </td>
                  <td className="px-4 py-2">
                    <p className="text-slate-800">{nameOf(e.camera_id)}</p>
                    <p className="font-mono text-[11px] text-slate-500">{e.camera_id}</p>
                  </td>
                  <td className="px-4 py-2 font-mono font-medium text-slate-800">#{e.track_id}</td>
                  <td className="px-4 py-2">
                    <DirectionBadge direction={e.direction} />
                  </td>
                  <td className="tabular px-4 py-2 text-slate-700">{fmtConfidence(e.confidence)}</td>
                  <td className="px-4 py-2 text-slate-300 group-hover:text-slate-500">
                    <ChevronRight className="size-4" />
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
