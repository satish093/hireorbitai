import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Brand } from '../components/Brand';
import { PasswordField, PasswordStrengthHints } from '../components/PasswordField';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

interface ChangeForm {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

/**
 * Forced password change page. Shown:
 *   - on the user's first sign-in (must_change_password = true)
 *   - any time the user clicks "Change password" from settings
 *
 * The auth backend re-verifies the current password (defends against session
 * theft), rotates the password, revokes existing sessions, and returns a fresh
 * session so the user stays signed in.
 */
export function ChangePassword() {
  const { profile, refreshSession, signOut } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ChangeForm>();
  const newPwd = form.watch('new_password') ?? '';

  const forced = !!profile?.must_change_password;

  async function submit(d: ChangeForm) {
    setError(null);
    if (d.new_password !== d.confirm_password) {
      setError("New passwords don't match.");
      return;
    }
    if (d.new_password === d.current_password) {
      setError('New password must be different from the current one.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/auth/change-password', d);
      // Backend returns a fresh access_token/refresh_token. Push them into
      // the local session store so the next API call uses the new bearer.
      if (data?.access_token && data?.refresh_token) {
        await refreshSession(data.access_token, data.refresh_token);
      }
      toast.success('Password updated.');
      nav('/dashboard', { replace: true });
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Password change failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-hover flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm animate-fade-in-up">
        <div className="flex justify-center mb-6">
          <Brand size="lg" />
        </div>
        <div className="bg-surface rounded-2xl border border-border shadow-sm p-7">
          <div className="mb-4">
            <h1 className="text-xl font-semibold tracking-tight text-ink">
              {forced ? 'Set a new password' : 'Change your password'}
            </h1>
            {forced && (
              <p className="text-sm text-muted mt-1">
                You signed in with a temporary password. Choose a new one to continue.
              </p>
            )}
          </div>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
            <PasswordField
              label={forced ? 'Temporary password' : 'Current password'}
              autoComplete="current-password"
              autoFocus
              {...form.register('current_password', { required: 'Required' })}
              error={form.formState.errors.current_password?.message}
            />
            <PasswordField
              label="New password"
              autoComplete="new-password"
              {...form.register('new_password', {
                required: 'Required',
                minLength: { value: 12, message: 'At least 12 characters' },
              })}
              error={form.formState.errors.new_password?.message}
            />
            <PasswordStrengthHints password={newPwd} />
            <PasswordField
              label="Confirm new password"
              autoComplete="new-password"
              {...form.register('confirm_password', { required: 'Required' })}
              error={form.formState.errors.confirm_password?.message}
            />
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <button
              disabled={busy}
              className="w-full bg-ink hover:opacity-90 disabled:opacity-50 text-bg rounded-lg py-2.5 text-sm font-medium press"
            >
              {busy ? 'Saving…' : 'Update password'}
            </button>
            {forced && (
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  nav('/login', { replace: true });
                }}
                className="w-full text-xs text-muted hover:text-ink py-1"
              >
                Sign out instead
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
