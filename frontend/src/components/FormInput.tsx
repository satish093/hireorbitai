import { forwardRef, InputHTMLAttributes } from 'react';
import clsx from 'clsx';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

/**
 * Standard text input. Height (h-8), radius (rounded-md), focus-visible ring
 * colour (--ring), and border treatment match Button(md) + SelectInput exactly
 * so a row of [Input] [Select] [Button] aligns perfectly.
 */
export const FormInput = forwardRef<HTMLInputElement, Props>(function FormInput(
  { label, error, hint, className, ...rest },
  ref,
) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-ink mb-1.5">{label}</span>}
      <input
        ref={ref}
        {...rest}
        className={clsx(
          // Same height + radius + base padding as Button size="md" so they
          // align inside toolbars without a top-row reset.
          'w-full h-8 rounded-md border bg-surface px-3 text-[13px] text-ink shadow-btn-soft transition',
          'placeholder:text-muted',
          // focus-visible so a mouse click doesn't trigger the ring (matches
          // Button behaviour). The keyboard-only ring still shows on Tab.
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:border-accent',
          error
            ? 'border-danger focus-visible:border-danger'
            : 'border-border-strong hover:border-[oklch(0.78_0.010_260)]',
          rest.disabled && 'opacity-60 cursor-not-allowed bg-hover',
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
