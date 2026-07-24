import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';

type Variant = 'primary' | 'accent' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'danger-ghost';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconOnly?: boolean;
  block?: boolean;
  pill?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  /** @deprecated use `leftIcon`. Kept for back-compat with older call sites. */
  icon?: ReactNode;
}

const base =
  'relative inline-flex items-center justify-center font-medium tracking-tight whitespace-nowrap select-none transition-all duration-150 ease-out shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:ring-accent disabled:opacity-45 disabled:cursor-not-allowed active:translate-y-px active:scale-[0.995]';

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-[5px]',
  md: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  lg: 'h-[38px] px-4 text-sm gap-2 rounded-[7px]',
};

const variants: Record<Variant, string> = {
  primary:
    'bg-ink text-bg border border-ink shadow-btn ' +
    'hover:bg-[oklch(0.12_0.012_260)] hover:border-[oklch(0.12_0.012_260)] hover:shadow-btn-hover ' +
    'dark:bg-ink dark:text-[oklch(0.15_0.012_260)] dark:border-ink dark:hover:bg-white',
  accent: 'bg-brand-grad text-white border-transparent shadow-btn hover:brightness-110',
  secondary:
    'bg-[oklch(0.94_0.005_260)] text-ink border-transparent hover:bg-[oklch(0.91_0.006_260)] ' +
    'dark:bg-[oklch(0.245_0.010_260)] dark:text-ink dark:hover:bg-[oklch(0.30_0.011_260)]',
  outline:
    'bg-surface text-ink border border-border-strong shadow-btn-soft ' +
    'hover:bg-[oklch(0.97_0.005_260)] hover:border-[oklch(0.78_0.010_260)] ' +
    'dark:bg-[oklch(0.245_0.010_260)] dark:border-[oklch(0.38_0.012_260)] dark:hover:bg-[oklch(0.295_0.011_260)]',
  ghost:
    'bg-transparent text-ink border-transparent ' +
    'hover:bg-[oklch(0.94_0.006_260)] ' +
    'dark:hover:bg-[oklch(0.245_0.010_260)]',
  danger: 'bg-danger text-white border border-danger shadow-btn hover:bg-[oklch(0.52_0.19_25)]',
  'danger-ghost': 'bg-transparent text-danger hover:bg-danger-soft',
};

/**
 * Standard button. Use `variant="primary"` for the page's single primary CTA,
 * `accent` for AI/highlight actions, `outline` for secondary siblings, `ghost`
 * for inline/filter actions, and `danger` / `danger-ghost` for destructive ops.
 */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'outline',
    size = 'md',
    loading,
    iconOnly,
    block,
    pill,
    leftIcon,
    rightIcon,
    icon,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      data-loading={loading ? 'true' : undefined}
      className={clsx(
        base,
        sizes[size],
        variants[variant],
        iconOnly && 'aspect-square !px-0',
        block && 'w-full',
        pill && '!rounded-full',
        loading && '[&_*]:invisible',
        className,
      )}
      {...rest}
    >
      {leftIcon ?? icon}
      {children}
      {rightIcon}
      {loading && (
        <span aria-hidden className="absolute inset-0 grid place-items-center !visible">
          <span className="size-3.5 rounded-full border-[1.6px] border-current border-t-transparent animate-spin" />
        </span>
      )}
    </button>
  );
});
