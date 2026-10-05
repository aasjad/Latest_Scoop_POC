import { useCallback, useEffect, useMemo } from 'react';
import { useCameraStore } from '@/store/cameraStore';
import { selectIsDirty, useConfigStore } from '@/store/configStore';
import { useUiStore } from '@/store/uiStore';

/** Shared line-editing actions so buttons and keyboard shortcuts behave identically. */
export function useLineEditor() {
  const mode = useConfigStore((s) => s.mode);
  const dirty = useConfigStore(selectIsDirty);
  const saving = useConfigStore((s) => s.saving);
  const ready = useConfigStore((s) => !!s.saved);
  const toast = useUiStore((s) => s.toast);

  const save = useCallback(async () => {
    const st = useConfigStore.getState();
    if (!st.saved || st.saving) return;
    if (!selectIsDirty(st)) {
      if (st.mode !== 'view') st.cancel();
      toast({ kind: 'info', title: 'No changes to save' });
      return;
    }
    try {
      await st.save();
      toast({ kind: 'success', title: 'Configuration saved', description: 'Counting line and entry direction are now active.' });
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save configuration', description: (e as Error).message });
    }
  }, [toast]);

  return useMemo(() => {
    const s = useConfigStore.getState();
    return {
      mode,
      dirty,
      saving,
      ready,
      startDraw: s.startDraw,
      startEdit: s.startEdit,
      reverse: s.reverseDirection,
      reset: s.resetLine,
      cancel: s.cancel,
      save,
    };
  }, [mode, dirty, saving, ready, save]);
}

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** D / C / S / R / Esc on the Live page. */
export function useLineShortcuts(enabled: boolean) {
  const editor = useLineEditor();
  const openPanel = useUiStore((s) => s.openPanel);

  useEffect(() => {
    if (!enabled || !editor.ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const ui = useUiStore.getState();
      if (ui.drawerEvent || ui.panel) return; // drawers own the keyboard while open
      const cam = useCameraStore.getState();
      if (cam.selectedId && cam.statuses[cam.selectedId]?.status === 'offline' && e.key !== '?') return; // no video to edit on
      switch (e.key.toLowerCase()) {
        case 'd':
          editor.startDraw();
          break;
        case 'c':
          editor.reverse();
          break;
        case 's':
          void editor.save();
          break;
        case 'r':
          editor.reset();
          break;
        case 'e':
          editor.startEdit();
          break;
        case 'escape':
          if (useConfigStore.getState().mode === 'view') return;
          editor.cancel();
          break;
        case '?':
          openPanel('shortcuts');
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, editor, openPanel]);
}
