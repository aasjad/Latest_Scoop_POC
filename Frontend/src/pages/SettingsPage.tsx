import { ArrowRightLeft, Cctv, FlaskConical, LoaderCircle, PencilLine, RotateCcw, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/api';
import { PageHeader } from '@/components/common/PageHeader';
import { Skeleton } from '@/components/common/States';
import { DirectionLegend } from '@/components/live/CameraToolbar';
import { CountingLineEditor } from '@/components/live/CountingLineEditor';
import { ENV } from '@/config/constants';
import { CURRENT_USER } from '@/config/user';
import { cn } from '@/lib/cn';
import { useAnalyticsStore } from '@/store/analyticsStore';
import { useSelectedCamera } from '@/store/cameraStore';
import { useConfigStore } from '@/store/configStore';
import { useEventStore } from '@/store/eventStore';
import { useUiStore } from '@/store/uiStore';
import type { CameraConfig, EntryDirection } from '@/types';

type Form = Pick<CameraConfig, 'detection_confidence' | 'inference_fps' | 'capacity' | 'entry_direction'>;

function Section({ id, icon, title, description, children }: { id: string; icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-24 p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="card-title">{title}</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

function DemoTools({ cameraId }: { cameraId: string }) {
  const [tools, setTools] = useState<typeof import('@/mocks/devtools').devtools | null>(null);
  useEffect(() => {
    void import('@/mocks/devtools').then((m) => setTools(m.devtools));
  }, []);
  const toast = useUiStore((s) => s.toast);
  if (!tools) return null;
  return (
    <Section id="demo" icon={<FlaskConical className="size-[18px]" />} title="Demo tools" description="Mock mode only — exercise live states without a backend.">
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" onClick={() => (tools.degradeCamera(cameraId), toast({ kind: 'info', title: 'Camera degraded for 20 s' }))}>
          Simulate degraded camera
        </button>
        <button className="btn-secondary" onClick={() => tools.dropConnection()}>
          Drop live connection
        </button>
        <button className="btn-secondary" onClick={() => tools.visitorBurst(cameraId)}>
          Send a group of visitors
        </button>
      </div>
    </Section>
  );
}

export default function SettingsPage() {
  const camera = useSelectedCamera();
  const { saved, loading, saving, save } = useConfigStore();
  const toast = useUiStore((s) => s.toast);
  const navigate = useNavigate();
  const { hash } = useLocation();
  const canEdit = CURRENT_USER.role === 'admin';
  const [form, setForm] = useState<Form | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (saved) setForm({ detection_confidence: saved.detection_confidence, inference_fps: saved.inference_fps, capacity: saved.capacity, entry_direction: saved.entry_direction });
  }, [saved]);
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [hash, form === null]);

  const dirty = !!form && !!saved && (form.detection_confidence !== saved.detection_confidence || form.capacity !== saved.capacity || form.entry_direction !== saved.entry_direction);
  const capacityInvalid = form?.capacity != null && (!Number.isInteger(form.capacity) || form.capacity < 1);

  const onSave = async () => {
    if (!form || capacityInvalid) return;
    try {
      await save(form);
      toast({ kind: 'success', title: 'Settings saved', description: camera?.name });
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save settings', description: (e as Error).message });
    }
  };

  const onReset = async () => {
    if (!camera) return;
    setResetting(true);
    try {
      await api.resetCounts(camera.camera_id);
      await Promise.all([useAnalyticsStore.getState().load(camera.camera_id), useEventStore.getState().load(camera.camera_id)]);
      toast({ kind: 'success', title: 'Counters reset', description: 'Persons In, Out and Inside start from zero.' });
    } catch (e) {
      toast({ kind: 'error', title: 'Reset failed', description: (e as Error).message });
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  };

  const editLine = () => {
    navigate('/live');
    useConfigStore.getState().startEdit();
  };

  if (loading || !form || !saved) {
    return (
      <>
        <PageHeader title="Settings" />
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  const setDir = (d: EntryDirection) => setForm({ ...form, entry_direction: d });

  return (
    <>
      <PageHeader title="Settings" description={`Configuration for ${camera?.name ?? 'the selected camera'} (${camera?.camera_id ?? '—'}). Switch camera from the header.`} />
      {!canEdit && <p className="mb-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">You have read-only access. Ask an administrator to change settings.</p>}

      <fieldset disabled={!canEdit} className="max-w-4xl space-y-4 pb-24">
        <Section id="line" icon={<ArrowRightLeft className="size-[18px]" />} title="Counting line & entry direction" description="Where people are counted and which way counts as entering.">
          <div className="grid gap-5 md:grid-cols-[minmax(0,320px)_1fr]">
            <div className="relative aspect-video overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_center,#24354f_0%,#0d1729_80%)] ring-1 ring-line">
              <div className="absolute inset-0 bg-[linear-gradient(rgb(255_255_255/.04)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/.04)_1px,transparent_1px)] bg-[size:24px_24px]" />
              <CountingLineEditor line={saved.line} entryDirection={form.entry_direction} mode="view" drawStart={null} flash={null} onPlacePoint={() => undefined} onChange={() => undefined} />
            </div>
            <div className="space-y-4">
              <div>
                <span className="label">Entry direction</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(['A_TO_B', 'B_TO_A'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDir(d)}
                      aria-pressed={form.entry_direction === d}
                      className={cn('rounded-xl border px-3 py-2.5 text-left text-sm transition-colors', form.entry_direction === d ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-line hover:border-line-strong')}
                    >
                      <span className="font-medium text-slate-800">{d === 'A_TO_B' ? 'Side A → Side B' : 'Side B → Side A'}</span>
                      <span className="block text-xs text-slate-500">counts as IN</span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 rounded-lg bg-ink-900 px-3 py-2">
                  <DirectionLegend direction={form.entry_direction} compact />
                </div>
              </div>
              <button type="button" className="btn-secondary" onClick={editLine}>
                <PencilLine className="size-4" /> Edit line on live view
              </button>
            </div>
          </div>
        </Section>

        <Section id="detection" icon={<Cctv className="size-[18px]" />} title="Detection" description="Applied by the AI engine on the next frame after saving.">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="label flex justify-between" htmlFor="conf">
                Detection confidence <span className="tabular font-semibold text-slate-800">{Math.round(form.detection_confidence * 100)}%</span>
              </label>
              <input
                id="conf"
                type="range"
                min={0.3}
                max={0.9}
                step={0.05}
                value={form.detection_confidence}
                onChange={(e) => setForm({ ...form, detection_confidence: Number(e.target.value) })}
                className="w-full accent-brand-500"
              />
              <p className="mt-1 text-xs text-slate-500">Higher values reduce false detections but may miss people in poor light.</p>
            </div>
            <div>
              <label className="label" htmlFor="fps">
                Inference rate
              </label>
              {/* Measured by Vision (it runs as fast as the CPU allows); not something it can be told. */}
              <input id="fps" className="input" readOnly disabled value={saved.inference_fps ? `${saved.inference_fps} frames per second (measured)` : 'Not running'} />
              <p className="mt-1 text-xs text-slate-500">Reported by the Vision server. Lower the model input size in vision/config.py to raise it.</p>
            </div>
          </div>
        </Section>

        <Section id="occupancy" icon={<Users className="size-[18px]" />} title="Occupancy" description="Optional. When set, the dashboard shows utilisation against capacity.">
          <label className="flex items-center gap-2.5 text-sm text-slate-700">
            <input type="checkbox" className="size-4 accent-brand-500" checked={form.capacity != null} onChange={(e) => setForm({ ...form, capacity: e.target.checked ? 50 : null })} />
            Set a maximum capacity
          </label>
          {form.capacity != null && (
            <div className="mt-3 max-w-[200px]">
              <label className="label" htmlFor="cap">
                Capacity (people)
              </label>
              <input id="cap" type="number" min={1} className={cn('input', capacityInvalid && 'border-out-500')} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Math.floor(Number(e.target.value)) })} />
              {capacityInvalid && <p className="mt-1 text-xs text-out-600">Enter a whole number above zero.</p>}
            </div>
          )}
        </Section>

        <Section id="camera" icon={<Cctv className="size-[18px]" />} title="Camera configuration" description="Name, location and stream source.">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Name</dt>
              <dd className="font-medium text-slate-800">{camera?.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Resolution</dt>
              <dd className="font-medium text-slate-800">{camera?.resolution}</dd>
            </div>
            <div className="flex justify-between gap-3 sm:col-span-2">
              <dt className="text-slate-500">Source</dt>
              <dd className="truncate font-mono text-xs text-slate-700">{camera?.source}</dd>
            </div>
          </dl>
          <Link to="/cameras" className="btn-secondary mt-4">
            Manage cameras
          </Link>
        </Section>

        <Section id="system" icon={<RotateCcw className="size-[18px]" />} title="System" description="Counters and connection details.">
          <dl className="mb-4 grid gap-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Data source</dt>
              <dd className="font-medium text-slate-800">{ENV.useMock ? 'Simulated (mock mode)' : 'Live backend'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">API</dt>
              <dd className="font-mono text-xs text-slate-700">{ENV.apiBaseUrl}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Live updates</dt>
              <dd className="font-mono text-xs text-slate-700">{ENV.wsUrl}</dd>
            </div>
          </dl>
          {!confirmReset ? (
            <button type="button" className="btn-secondary text-out-700" onClick={() => setConfirmReset(true)}>
              <RotateCcw className="size-4" /> Reset today’s counters
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-out-50 px-3 py-2.5 ring-1 ring-out-100">
              <p className="mr-auto text-sm text-out-800">Reset Persons In, Out and Inside to zero for {camera?.name}? Event history is kept.</p>
              <button type="button" className="btn-ghost" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button type="button" className="btn-danger" onClick={() => void onReset()} disabled={resetting}>
                {resetting && <LoaderCircle className="size-4 animate-spin" />} Reset counters
              </button>
            </div>
          )}
        </Section>

        {import.meta.env.VITE_USE_MOCK === 'true' && camera && <DemoTools cameraId={camera.camera_id} />}
      </fieldset>

      {dirty && (
        <div className="fixed right-4 bottom-4 left-4 z-40 mx-auto flex max-w-xl animate-slide-in items-center gap-3 rounded-2xl bg-ink-900 px-4 py-3 text-white shadow-raised md:left-[calc(76px+1rem)] xl:left-[calc(248px+1rem)]">
          <span className="size-2 rounded-full bg-amber-400" />
          <p className="mr-auto text-sm">You have unsaved changes</p>
          <button className="btn rounded-lg px-3 py-1.5 text-ink-300 hover:bg-white/10 hover:text-white" onClick={() => saved && setForm({ detection_confidence: saved.detection_confidence, inference_fps: saved.inference_fps, capacity: saved.capacity, entry_direction: saved.entry_direction })}>
            Discard
          </button>
          <button className="btn-primary py-1.5" onClick={() => void onSave()} disabled={saving || capacityInvalid}>
            {saving && <LoaderCircle className="size-4 animate-spin" />} Save changes
          </button>
        </div>
      )}
    </>
  );
}
