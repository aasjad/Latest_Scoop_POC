import { ArrowDown, ArrowUp, ChevronDown, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { THRESHOLDS } from '@/config/constants';
import { cn } from '@/lib/cn';
import { fmtDuration, fmtRelative } from '@/lib/format';
import { useSelectedStatus } from '@/store/cameraStore';
import type { CameraStatus } from '@/types';
import { Skeleton } from '../common/States';
import { StatusPill } from '../common/StatusIndicator';

interface Metric {
  label: string;
  value: string;
  bad?: 'up' | 'down';
}

function metrics(s: CameraStatus): Metric[] {
  const offline = s.status === 'offline';
  return [
    { label: 'Resolution', value: s.resolution },
    { label: 'Camera FPS', value: offline ? '—' : s.camera_fps.toFixed(1), bad: !offline && s.camera_fps < THRESHOLDS.degradedFps ? 'down' : undefined },
    { label: 'Inference FPS', value: offline ? '—' : s.inference_fps.toFixed(1), bad: !offline && s.inference_fps < THRESHOLDS.degradedFps / 2 ? 'down' : undefined },
    { label: 'Latency', value: offline ? '—' : `${s.latency_ms} ms`, bad: !offline && s.latency_ms > THRESHOLDS.degradedLatencyMs ? 'up' : undefined },
    { label: 'Frame drop', value: offline ? '—' : `${s.frame_drop_pct.toFixed(1)}%`, bad: !offline && s.frame_drop_pct > THRESHOLDS.degradedFrameDropPct ? 'up' : undefined },
    { label: 'Model', value: s.model },
    { label: 'Uptime', value: offline ? '—' : fmtDuration(s.uptime_s) },
  ];
}

function MetricValue({ m }: { m: Metric }) {
  return (
    <span className={cn('tabular inline-flex items-center gap-1 font-medium', m.bad ? 'text-amber-600' : 'text-slate-900')}>
      {m.value}
      {m.bad === 'down' && <ArrowDown className="size-3.5" />}
      {m.bad === 'up' && <ArrowUp className="size-3.5" />}
    </span>
  );
}

export function CameraHealth() {
  const status = useSelectedStatus();
  const [expanded, setExpanded] = useState(false);

  if (!status) {
    return (
      <div className="card p-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-3 h-4 w-full" />
      </div>
    );
  }

  const list = metrics(status);
  const issues = list.filter((m) => m.bad);
  const summary = list.filter((m) => ['Camera FPS', 'Latency', 'Uptime'].includes(m.label));
  const label = status.status === 'online' ? 'Online' : status.status === 'degraded' ? 'Degraded' : 'Offline';

  return (
    <section className={cn('card overflow-hidden transition-colors', status.status === 'degraded' && 'border-amber-300 ring-2 ring-amber-100', status.status === 'offline' && 'border-out-100')}>
      <button onClick={() => setExpanded((e) => !e)} className="flex w-full items-center justify-between gap-3 px-4 pt-3.5 pb-3 text-left" aria-expanded={expanded}>
        <div>
          <h2 className="card-title">Camera Health</h2>
          <p className="mt-0.5 text-xs text-slate-500">Updated {fmtRelative(status.updated_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill state={status.status} label={label} size="sm" />
          <ChevronDown className={cn('size-4 text-slate-400 transition-transform duration-200', expanded && 'rotate-180')} />
        </div>
      </button>

      {status.status === 'degraded' && (
        <div className="mx-4 mb-3 flex gap-2.5 rounded-xl bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-800 ring-1 ring-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Camera performance degraded</p>
            <p className="mt-0.5 text-amber-700">{issues.map((m) => `${m.label} ${m.value}`).join(' · ')}. Counts may be less accurate.</p>
          </div>
        </div>
      )}
      {status.status === 'offline' && (
        <div className="mx-4 mb-3 rounded-xl bg-out-50 px-3 py-2.5 text-[12.5px] text-out-700 ring-1 ring-out-100">No video signal. Check the camera’s power and network connection.</div>
      )}

      {!expanded ? (
        <div className="grid grid-cols-3 divide-x divide-line border-t border-line">
          {summary.map((m) => (
            <div key={m.label} className="px-3 py-2.5 text-center">
              <p className="text-[11px] text-slate-500">{m.label}</p>
              <p className="mt-0.5 text-sm">
                <MetricValue m={m} />
              </p>
            </div>
          ))}
        </div>
      ) : (
        <dl className="animate-fade-in divide-y divide-line border-t border-line px-4">
          {list.map((m) => (
            <div key={m.label} className="flex items-center justify-between py-2 text-[13px]">
              <dt className="text-slate-500">{m.label}</dt>
              <dd>
                <MetricValue m={m} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
