import { ArrowRightLeft, Check, LoaderCircle, Maximize2, Minimize2, PencilLine, RotateCcw, Spline, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLineEditor } from '@/hooks/useLineEditor';
import { cn } from '@/lib/cn';
import type { EntryDirection } from '@/types';

function ToolButton({ k, label, icon, onClick, disabled, primary, active }: { k: string; label: string; icon: ReactNode; onClick(): void; disabled?: boolean; primary?: boolean; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={k === 'Esc' ? 'Escape' : k}
      className={cn(
        'flex h-8 shrink-0 items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        primary ? 'bg-brand-500 text-white hover:bg-brand-600' : active ? 'bg-white/15 text-white' : 'text-ink-300 hover:bg-white/10 hover:text-white',
      )}
    >
      <span className="kbd">{k}</span>
      <span className="hidden items-center gap-1.5 xl:inline-flex">
        {icon}
        {label}
      </span>
      <span className="xl:hidden">{label.split(' ')[0]}</span>
    </button>
  );
}

export function DirectionLegend({ direction, compact }: { direction: EntryDirection; compact?: boolean }) {
  const inFrom = direction === 'A_TO_B' ? 'A' : 'B';
  const inTo = direction === 'A_TO_B' ? 'B' : 'A';
  return (
    <div className={cn('flex items-center gap-3 font-medium', compact ? 'text-[11.5px]' : 'text-[12.5px]')}>
      <span className="flex items-center gap-1.5 text-in-400">
        Side {inFrom} → {inTo} <span className="rounded bg-in-500 px-1.5 py-px text-[10.5px] font-bold text-white">IN</span>
      </span>
      <span className="flex items-center gap-1.5 text-out-400">
        Side {inTo} → {inFrom} <span className="rounded bg-out-500 px-1.5 py-px text-[10.5px] font-bold text-white">OUT</span>
      </span>
    </div>
  );
}

export function CameraToolbar({ fullscreen, onToggleFullscreen, locked }: { fullscreen: boolean; onToggleFullscreen(): void; locked?: boolean }) {
  const ed = useLineEditor();
  const ready = ed.ready && !locked;
  const editing = ed.mode !== 'view';

  return (
    <div className="scroll-thin flex items-center gap-1 overflow-x-auto border-t border-white/[0.06] bg-ink-900 px-2.5 py-2">
      {!editing && (
        <button onClick={ed.startEdit} disabled={!ready} className="mr-1 flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-[12.5px] font-medium text-white hover:bg-white/15 disabled:opacity-40">
          <PencilLine className="size-3.5" /> Edit line
        </button>
      )}
      <ToolButton k="D" label="Draw line" icon={<Spline className="size-3.5" />} onClick={ed.startDraw} disabled={!ready} active={ed.mode === 'draw'} />
      <ToolButton k="C" label="Reverse direction" icon={<ArrowRightLeft className="size-3.5" />} onClick={ed.reverse} disabled={!ready} />
      <ToolButton k="R" label="Reset" icon={<RotateCcw className="size-3.5" />} onClick={ed.reset} disabled={!ready} />
      {editing && (
        <>
          <ToolButton k="Esc" label="Cancel" icon={<X className="size-3.5" />} onClick={ed.cancel} />
          <ToolButton
            k="S"
            label={ed.saving ? 'Saving…' : 'Save'}
            icon={ed.saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            onClick={() => void ed.save()}
            disabled={ed.saving || ed.mode === 'draw'}
            primary={ed.dirty}
          />
        </>
      )}
      <div className="ml-auto flex shrink-0 items-center pl-2">
        <button onClick={onToggleFullscreen} className="grid size-8 place-items-center rounded-lg text-ink-300 hover:bg-white/10 hover:text-white" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}>
          {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </div>
    </div>
  );
}
