import { useUiStore } from '@/store/uiStore';
import { Drawer } from '../common/Drawer';

export const SHORTCUTS = [
  { key: 'D', label: 'Draw a new counting line' },
  { key: 'E', label: 'Edit the current line' },
  { key: 'C', label: 'Reverse entry direction' },
  { key: 'S', label: 'Save configuration' },
  { key: 'R', label: 'Reset line to default' },
  { key: 'Esc', label: 'Cancel editing' },
  { key: '?', label: 'Show this list' },
] as const;

export function ShortcutsDrawer() {
  const open = useUiStore((s) => s.panel === 'shortcuts');
  const openPanel = useUiStore((s) => s.openPanel);
  return (
    <Drawer open={open} onClose={() => openPanel(null)} title="Keyboard shortcuts" subtitle="Available on the Live page. Every action also has a button.">
      <ul className="divide-y divide-line rounded-xl border border-line">
        {SHORTCUTS.map((s) => (
          <li key={s.key} className="flex items-center justify-between px-4 py-3 text-sm text-slate-700">
            {s.label}
            <span className="kbd-light">{s.key}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[13px] text-slate-500">Shortcuts are ignored while typing in a field. Endpoints and the line can be nudged with arrow keys once focused (hold Shift for larger steps).</p>
    </Drawer>
  );
}
