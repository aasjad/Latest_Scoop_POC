import { CloudOff, Inbox, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/70', className)} />;
}

export function EmptyState({ title, description, icon, action, className }: { title: string; description?: string; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <div className="mb-3 grid size-10 place-items-center rounded-full bg-slate-100 text-slate-400">{icon ?? <Inbox className="size-5" />}</div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-xs text-[13px] text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className, compact }: { message: string; onRetry?: () => void; className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-5' : 'px-6 py-10', className)} role="alert">
      <div className="mb-3 grid size-10 place-items-center rounded-full bg-out-50 text-out-500">
        <CloudOff className="size-5" />
      </div>
      <p className="text-sm font-medium text-slate-700">Couldn’t load data</p>
      <p className="mt-1 max-w-xs text-[13px] text-slate-500">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary mt-4 py-1.5">
          <RefreshCw className="size-3.5" /> Retry
        </button>
      )}
    </div>
  );
}
