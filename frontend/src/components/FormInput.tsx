import { forwardRef, InputHTMLAttributes } from 'react';
import clsx from 'clsx';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const FormInput = forwardRef<HTMLInputElement, Props>(function FormInput(
  { label, error, hint, className, ...rest },
  ref
) {
  return (
    <label className="block">
      {label && (
        <span className="block text-xs font-medium text-slate-700 mb-1.5">{label}</span>
      )}
      <input
        ref={ref}
        {...rest}
        className={clsx(
          'w-full rounded-lg border bg-white px-3 py-2 text-sm shadow-sm transition',
          'placeholder:text-slate-400',
          'focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500',
          error ? 'border-red-300 focus:ring-red-200 focus:border-red-500' : 'border-slate-300 hover:border-slate-400',
          rest.disabled && 'opacity-60 cursor-not-allowed bg-slate-50',
          className,
        )}
      />
      {error
        ? <span className="block text-xs text-red-600 mt-1">{error}</span>
        : hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
    </label>
  );
});
