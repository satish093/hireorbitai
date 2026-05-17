import { forwardRef, SelectHTMLAttributes } from 'react';
import clsx from 'clsx';

interface Option {
  value: string;
  label: string;
}

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: Option[];
  placeholder?: string;
}

/**
 * Standard select. Height + radius + focus-visible ring match FormInput +
 * Button so a row of [Input] [Select] [Button] is pixel-aligned.
 */
export const SelectInput = forwardRef<HTMLSelectElement, Props>(function SelectInput(
  { label, error, options, placeholder, className, ...rest },
  ref,
) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-slate-700 mb-1.5">{label}</span>}
      <div className="relative">
        <select
          ref={ref}
          {...rest}
          className={clsx(
            // h-9 matches FormInput + Button(md). pr-9 leaves room for the
            // chevron at the right.
            'w-full h-9 appearance-none rounded-lg border bg-white pl-3 pr-9 text-sm shadow-sm transition',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 focus-visible:border-brand-500',
            error
              ? 'border-red-300 focus-visible:ring-red-200 focus-visible:border-red-500'
              : 'border-slate-300 hover:border-slate-400',
            rest.disabled && 'opacity-60 cursor-not-allowed bg-slate-50',
            className,
          )}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      {error && <span className="block text-xs text-red-600 mt-1">{error}</span>}
    </label>
  );
});
