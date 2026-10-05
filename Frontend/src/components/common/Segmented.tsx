import { cn } from '@/lib/cn';

interface SegmentedProps<T extends string> {
  value: T;
  onChange(v: NoInfer<T>): void;
  options: ReadonlyArray<{ value: NoInfer<T>; label: string }>;
  size?: 'sm' | 'md';
  ariaLabel: string;
}

export function Segmented<T extends string>({ value, onChange, options, size = 'sm', ariaLabel }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-lg bg-slate-100 p-0.5 ring-1 ring-line">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md font-medium transition-all duration-150',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'bg-white text-slate-900 shadow-sm ring-1 ring-line' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
