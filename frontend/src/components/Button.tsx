import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-slate-900/40 disabled:bg-slate-300',
  secondary:
    'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 focus-visible:ring-slate-300/60 disabled:opacity-60',
  ghost:
    'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-300/60 disabled:opacity-60',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500/40 disabled:bg-red-300',
};

const SIZE: Record<Size, string> = {
  sm: 'h-7 text-xs px-2.5 rounded-md gap-1',
  md: 'h-9 text-sm px-3.5 rounded-lg gap-1.5',
  lg: 'h-10 text-sm px-5 rounded-lg gap-2',
};

/**
 * Standard button used across the app. Use `<Button variant="primary">` for the
 * page's primary CTA, `secondary` for cancel/secondary actions, `ghost` for
 * inline text-like buttons, and `danger` for destructive actions.
 */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center font-medium transition shadow-sm press',
        'focus:outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="4"
          />
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      ) : (
        icon
      )}
      {children}
    </button>
  );
});
