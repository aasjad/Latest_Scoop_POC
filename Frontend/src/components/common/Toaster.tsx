import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useUiStore, type ToastKind } from '@/store/uiStore';

const ICON: Record<ToastKind, { Icon: typeof Info; cls: string }> = {
  success: { Icon: CircleCheck, cls: 'text-in-500' },
  error: { Icon: TriangleAlert, cls: 'text-out-500' },
  info: { Icon: Info, cls: 'text-brand-400' },
};

/** Non-blocking confirmations (bottom-right). */
export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const { Icon, cls } = ICON[t.kind];
        return (
          <div key={t.id} className="pointer-events-auto flex animate-slide-in items-start gap-3 rounded-xl bg-ink-900 px-4 py-3 text-white shadow-raised ring-1 ring-white/10">
            <Icon className={cn('mt-0.5 size-[18px] shrink-0', cls)} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.description && <p className="mt-0.5 text-[13px] text-ink-300">{t.description}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-ink-400 hover:text-white" aria-label="Dismiss notification">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
