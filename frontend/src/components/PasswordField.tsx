import { forwardRef, InputHTMLAttributes, useState } from 'react';
import clsx from 'clsx';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  error?: string;
}

/**
 * Password input with a "show/hide" eye toggle. Inherits the same styling
 * language as FormInput so it slots into any form unchanged.
 */
export const PasswordField = forwardRef<HTMLInputElement, Props>(function PasswordField(
  { label, error, className, ...rest },
  ref,
) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-ink mb-1.5">{label}</span>}
      <div className="relative">
        <input
          ref={ref}
          type={show ? 'text' : 'password'}
          // Revealing the password flips the field to type="text", which on
          // mobile re-enables the keyboard's autocorrect / autocapitalize and
          // the "insert a space after a word" behaviour — that silently appends
          // an invisible trailing space, so two identical-looking passwords
          // fail the confirm-match check. Disable all of it. Callers can still
          // override via `...rest`.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          {...rest}
          className={clsx(
            'w-full rounded-lg border bg-surface pl-3 pr-10 py-2 text-sm shadow-sm transition',
            'placeholder:text-muted',
            'focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500',
            error
              ? 'border-red-300 focus:ring-red-200 focus:border-red-500'
              : 'border-border hover:border-muted',
            className,
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink px-1.5 py-1 rounded text-xs"
        >
          {show ? '🙈' : '👁'}
        </button>
      </div>
      {error && <span className="block text-xs text-red-600 dark:text-red-400 mt-1">{error}</span>}
    </label>
  );
});

// ---------------------------------------------------------------------------
// Strength hints — live indicator next to the new-password field. Matches the
// backend rules in backend/src/utils/password.ts.
// ---------------------------------------------------------------------------
interface Rule {
  label: string;
  check: (pw: string) => boolean;
}
const RULES: Rule[] = [
  { label: 'At least 12 characters', check: (p) => p.length >= 12 },
  { label: 'Uppercase letter', check: (p) => /[A-Z]/.test(p) },
  { label: 'Lowercase letter', check: (p) => /[a-z]/.test(p) },
  { label: 'Number', check: (p) => /[0-9]/.test(p) },
  { label: 'Special character', check: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function PasswordStrengthHints({ password }: { password: string }) {
  const pw = password ?? '';
  return (
    <ul className="text-[11px] text-muted space-y-0.5 -mt-1">
      {RULES.map((r) => {
        const ok = r.check(pw);
        return (
          <li
            key={r.label}
            className={clsx(
              'flex items-center gap-1.5',
              ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted',
            )}
          >
            <span
              className={clsx(
                'w-3 inline-flex justify-center',
                ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted',
              )}
            >
              {ok ? '✓' : '○'}
            </span>
            {r.label}
          </li>
        );
      })}
    </ul>
  );
}
