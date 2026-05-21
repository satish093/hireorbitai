import { forwardRef, InputHTMLAttributes } from 'react';
import clsx from 'clsx';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

/**
 * Standard text input. Height (h-9), radius (rounded-lg), focus-visible ring
 * colour, and border treatment match Button + SelectInput exactly so a row
 * of [Input] [Select] [Button] aligns perfectly.
 */
export const FormInput = forwardRef<HTMLInputElement, Props>(function FormInput(
  { label, error, hint, className, ...rest },
  ref,
) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-foreground mb-1.5">{label}</span>}
      <input
        ref={ref}
        {...rest}
        className={clsx(
          // Same height + radius + base padding as Button size="md" so they
          // align inside toolbars without a top-row reset.
          'w-full h-9 rounded-lg border bg-card px-3 text-sm shadow-sm transition',
          'placeholder:text-muted-foreground',
          // focus-visible so a mouse click doesn't trigger the ring (matches
          // Button behaviour). The keyboard-only ring still shows on Tab.
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 focus-visible:border-brand-500',
          error
            ? 'border-red-300 focus-visible:ring-red-200 focus-visible:border-red-500'
            : 'border-border hover:border-muted-foreground',
          rest.disabled && 'opacity-60 cursor-not-allowed bg-muted',
          className,
        )}
      />
      {error ? (
        <span className="block text-xs text-red-600 dark:text-red-400 mt-1">{error}</span>
      ) : (
        hint && <span className="block text-[11px] text-muted-foreground mt-1">{hint}</span>
      )}
    </label>
  );
});
