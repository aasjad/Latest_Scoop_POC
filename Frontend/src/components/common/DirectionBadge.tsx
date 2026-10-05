import { LogIn, LogOut } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Direction } from '@/types';

export function DirectionBadge({ direction, size = 'sm', className }: { direction: Direction; size?: 'xs' | 'sm' | 'md'; className?: string }) {
  const isIn = direction === 'ENTRY';
  const Icon = isIn ? LogIn : LogOut;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md font-semibold tracking-wide',
        size === 'xs' && 'px-1.5 py-0.5 text-[10.5px]',
        size === 'sm' && 'px-2 py-0.5 text-[11.5px]',
        size === 'md' && 'px-2.5 py-1 text-sm',
        isIn ? 'bg-in-500 text-white' : 'bg-out-500 text-white',
        className,
      )}
    >
      <Icon className={size === 'md' ? 'size-4' : 'size-3'} strokeWidth={2.5} />
      {isIn ? 'IN' : 'OUT'}
    </span>
  );
}
