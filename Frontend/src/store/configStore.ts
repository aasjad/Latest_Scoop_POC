import { create } from 'zustand';
import { api } from '@/api';
import { DEFAULT_CONFIG, DEFAULT_LINE, THRESHOLDS } from '@/config/constants';
import { lineLength, linesEqual } from '@/lib/geometry';
import type { CameraConfig, CountingLine, EntryDirection, Point } from '@/types';

export type LineEditMode = 'view' | 'draw' | 'edit';

interface Draft {
  line: CountingLine;
  entry_direction: EntryDirection;
}

interface ConfigState {
  saved: CameraConfig | null;
  loading: boolean;
  error: string | null;
  mode: LineEditMode;
  draft: Draft | null;
  /** First click while drawing. */
  drawStart: Point | null;
  saving: boolean;
  load(cameraId: string): Promise<void>;
  startEdit(): void;
  startDraw(): void;
  placePoint(p: Point): void;
  setDraftLine(line: CountingLine): void;
  reverseDirection(): void;
  resetLine(): void;
  cancel(): void;
  /** Saves the line draft (or a full config when given). */
  save(partial?: Partial<CameraConfig>): Promise<CameraConfig>;
}

const flip = (d: EntryDirection): EntryDirection => (d === 'A_TO_B' ? 'B_TO_A' : 'A_TO_B');

export const useConfigStore = create<ConfigState>((set, get) => {
  const ensureDraft = (): Draft => {
    const { draft, saved } = get();
    return draft ?? { line: structuredClone(saved?.line ?? DEFAULT_LINE), entry_direction: saved?.entry_direction ?? DEFAULT_CONFIG.entry_direction };
  };

  return {
    saved: null,
    loading: true,
    error: null,
    mode: 'view',
    draft: null,
    drawStart: null,
    saving: false,

    async load(cameraId) {
      set({ loading: true, error: null, mode: 'view', draft: null, drawStart: null });
      try {
        const saved = await api.getConfig(cameraId);
        set({ saved, loading: false });
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    startEdit() {
      set({ mode: 'edit', draft: ensureDraft(), drawStart: null });
    },

    startDraw() {
      set({ mode: 'draw', draft: ensureDraft(), drawStart: null });
    },

    placePoint(p) {
      const { drawStart } = get();
      if (!drawStart) return set({ drawStart: p });
      const line = { p1: drawStart, p2: p };
      if (lineLength(line) < THRESHOLDS.minLineLength) return; // ignore accidental double click
      set({ mode: 'edit', drawStart: null, draft: { ...ensureDraft(), line } });
    },

    setDraftLine(line) {
      set({ draft: { ...ensureDraft(), line } });
    },

    reverseDirection() {
      const d = ensureDraft();
      set({ draft: { ...d, entry_direction: flip(d.entry_direction) }, mode: get().mode === 'view' ? 'edit' : get().mode });
    },

    resetLine() {
      set({ draft: { line: structuredClone(DEFAULT_LINE), entry_direction: DEFAULT_CONFIG.entry_direction }, mode: 'edit', drawStart: null });
    },

    cancel() {
      set({ mode: 'view', draft: null, drawStart: null });
    },

    async save(partial) {
      const { saved, draft } = get();
      if (!saved) throw new Error('Configuration not loaded');
      const next: CameraConfig = { ...saved, ...(draft ?? {}), ...partial };
      set({ saving: true });
      try {
        const stored = await api.saveConfig(next);
        set({ saved: stored, saving: false, mode: 'view', draft: null, drawStart: null });
        return stored;
      } catch (e) {
        set({ saving: false });
        throw e;
      }
    },
  };
});

export const selectIsDirty = (s: ConfigState) =>
  !!s.draft && !!s.saved && (!linesEqual(s.draft.line, s.saved.line) || s.draft.entry_direction !== s.saved.entry_direction);

/** The line/direction currently shown on the video (draft wins while editing). */
export const selectActiveLine = (s: ConfigState) => ({
  line: s.draft?.line ?? s.saved?.line ?? null,
  entry_direction: s.draft?.entry_direction ?? s.saved?.entry_direction ?? DEFAULT_CONFIG.entry_direction,
});
