import { Check, ChevronDown, Video } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useClickOutside } from '@/hooks/useDom';
import { cn } from '@/lib/cn';
import { useCameraStore } from '@/store/cameraStore';
import { Skeleton } from '../common/States';
import { StatusDot } from '../common/StatusIndicator';

export function CameraSelector() {
  const { cameras, selectedId, statuses, loading, select } = useCameraStore(
    useShallow((s) => ({ cameras: s.cameras, selectedId: s.selectedId, statuses: s.statuses, loading: s.loading, select: s.select })),
  );
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);
  const current = cameras.find((c) => c.camera_id === selectedId);

  if (loading && !current) return <Skeleton className="h-10 w-44" />;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-slate-100"
      >
        <div className="grid size-8 place-items-center rounded-lg bg-slate-100 text-slate-600 ring-1 ring-line">
          <Video className="size-4" />
        </div>
        <div className="leading-tight">
          <p className="text-[15px] font-semibold text-slate-900">{current?.name ?? 'No camera'}</p>
          <p className="font-mono text-[11px] text-slate-500">{current?.camera_id ?? '—'}</p>
        </div>
        <ChevronDown className={cn('ml-1 size-4 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul role="listbox" aria-label="Select camera" className="absolute top-full left-0 z-40 mt-2 w-72 animate-slide-in overflow-hidden rounded-xl border border-line bg-white p-1 shadow-raised">
          {cameras.map((c) => {
            const st = statuses[c.camera_id]?.status ?? 'online';
            return (
              <li key={c.camera_id}>
                <button
                  role="option"
                  aria-selected={c.camera_id === selectedId}
                  onClick={() => {
                    select(c.camera_id);
                    close();
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50"
                >
                  <StatusDot state={st} pulse={false} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{c.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      <span className="font-mono">{c.camera_id}</span> · {c.location}
                    </p>
                  </div>
                  {c.camera_id === selectedId && <Check className="size-4 text-brand-500" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
