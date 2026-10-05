import { LoaderCircle, Lock, Plus, Radio, Settings2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { api } from '@/api';
import { Drawer } from '@/components/common/Drawer';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/common/States';
import { StatusPill } from '@/components/common/StatusIndicator';
import { CURRENT_USER } from '@/config/user';
import { useCameraStore } from '@/store/cameraStore';
import { useUiStore } from '@/store/uiStore';
import type { Camera } from '@/types';

const EMPTY: Camera = { camera_id: '', name: '', location: '', source: '', resolution: '1920 × 1080', stream_url: '' };

function CameraForm({ initial, isNew, onDone }: { initial: Camera; isNew: boolean; onDone(): void }) {
  const [form, setForm] = useState<Camera>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upsert = useCameraStore((s) => s.upsertCamera);
  const cameras = useCameraStore((s) => s.cameras);
  const toast = useUiStore((s) => s.toast);
  const set = (k: keyof Camera) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.camera_id.trim() || !form.name.trim()) return setError('Camera ID and name are required.');
    if (isNew && cameras.some((c) => c.camera_id === form.camera_id.trim())) return setError('A camera with this ID already exists.');
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updateCamera({ ...form, camera_id: form.camera_id.trim(), name: form.name.trim() });
      upsert(saved);
      toast({ kind: 'success', title: isNew ? 'Camera added' : 'Camera updated', description: saved.name });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form id="camera-form" onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="cam-id">
          Camera ID
        </label>
        <input id="cam-id" className="input font-mono" value={form.camera_id} onChange={set('camera_id')} disabled={!isNew} placeholder="CAM_04" />
      </div>
      <div>
        <label className="label" htmlFor="cam-name">
          Display name
        </label>
        <input id="cam-name" className="input" value={form.name} onChange={set('name')} placeholder="Main Entrance" />
      </div>
      <div>
        <label className="label" htmlFor="cam-loc">
          Location
        </label>
        <input id="cam-loc" className="input" value={form.location} onChange={set('location')} placeholder="Ground floor · North" />
      </div>
      <div>
        <label className="label" htmlFor="cam-src">
          Source (RTSP URL)
        </label>
        <input id="cam-src" className="input font-mono text-xs" value={form.source} onChange={set('source')} placeholder="rtsp://10.0.0.10:554/stream1" />
        <p className="mt-1 text-xs text-slate-500">Used by the AI engine. Credentials should be stored on the server, not here.</p>
      </div>
      <div>
        <label className="label" htmlFor="cam-stream">
          Dashboard stream URL (optional)
        </label>
        <input id="cam-stream" className="input font-mono text-xs" value={form.stream_url ?? ''} onChange={set('stream_url')} placeholder="https://…/stream.mjpg" />
      </div>
      <div>
        <label className="label" htmlFor="cam-res">
          Resolution
        </label>
        <select id="cam-res" className="input" value={form.resolution} onChange={set('resolution')}>
          {['3840 × 2160', '2560 × 1440', '1920 × 1080', '1280 × 720'].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      {error && <p className="rounded-lg bg-out-50 px-3 py-2 text-[13px] text-out-700">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={saving}>
        {saving && <LoaderCircle className="size-4 animate-spin" />} {isNew ? 'Add camera' : 'Save changes'}
      </button>
    </form>
  );
}

export default function CamerasPage() {
  const { cameras, statuses, loading, error, load, select } = useCameraStore(
    useShallow((s) => ({ cameras: s.cameras, statuses: s.statuses, loading: s.loading, error: s.error, load: s.load, select: s.select })),
  );
  const navigate = useNavigate();
  const [editing, setEditing] = useState<{ camera: Camera; isNew: boolean } | null>(null);
  const canEdit = CURRENT_USER.role === 'admin';

  return (
    <>
      <PageHeader
        title="Camera Management"
        description="Cameras connected to the AI engine and their live health."
        actions={
          canEdit ? (
            <button className="btn-primary" onClick={() => setEditing({ camera: EMPTY, isNew: true })}>
              <Plus className="size-4" /> Add camera
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-slate-500">
              <Lock className="size-4" /> Read-only
            </span>
          )
        }
      />
      <section className="card overflow-hidden">
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !loading && cameras.length === 0 ? (
          <EmptyState title="No cameras yet" description="Add a camera to start counting." />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">
                  <th className="px-4 py-3">Camera</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Resolution</th>
                  <th className="px-4 py-3 text-right">FPS</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {loading
                  ? Array.from({ length: 3 }, (_, i) => (
                      <tr key={i}>
                        <td colSpan={6} className="px-4 py-3">
                          <Skeleton className="h-9" />
                        </td>
                      </tr>
                    ))
                  : cameras.map((c) => {
                      const st = statuses[c.camera_id];
                      return (
                        <tr key={c.camera_id} className="hover:bg-slate-50/60">
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{c.name}</p>
                            <p className="text-xs text-slate-500">
                              <span className="font-mono">{c.camera_id}</span> · {c.location}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <StatusPill state={st?.status ?? 'unknown'} size="sm" />
                          </td>
                          <td className="tabular px-4 py-3 text-slate-700">{st?.resolution ?? c.resolution}</td>
                          <td className="tabular px-4 py-3 text-right text-slate-700">{st && st.status !== 'offline' ? st.camera_fps.toFixed(1) : '—'}</td>
                          <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs text-slate-500" title={c.source}>
                            {c.source}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1.5">
                              <button
                                className="btn-secondary px-2.5 py-1.5 text-xs"
                                onClick={() => {
                                  select(c.camera_id);
                                  navigate('/live');
                                }}
                              >
                                <Radio className="size-3.5" /> View live
                              </button>
                              {canEdit && (
                                <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setEditing({ camera: c, isNew: false })}>
                                  <Settings2 className="size-3.5" /> Configure
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing?.isNew ? 'Add camera' : 'Configure camera'} subtitle={editing?.isNew ? undefined : editing?.camera.camera_id}>
        {editing && <CameraForm key={editing.camera.camera_id || 'new'} initial={editing.camera} isNew={editing.isNew} onDone={() => setEditing(null)} />}
      </Drawer>
    </>
  );
}
