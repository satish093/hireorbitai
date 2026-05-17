import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import axios from 'axios';
import { Brand } from '../components/Brand';
import { config as appConfig } from '../config/env';
import { PasswordField, PasswordStrengthHints } from '../components/PasswordField';

interface ResetForm {
  new_password: string;
  confirm_password: string;
}

/**
 * Custom reset-password flow (Brevo, backend-owned). The page reads
 * the token from `?token=` in the URL, posts it to the backend along with
 * the new password.
 */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ResetForm>();

  async function submit(d: ResetForm) {
    setError(null);
    if (d.new_password !== d.confirm_password) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${appConfig.apiBaseUrl}/auth/reset-password`, {
        token,
        new_password: d.new_password,
        confirm_password: d.confirm_password,
      });
      toast.success('Password updated — please sign in.');
      nav('/login', { replace: true });
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Invalid reset link</h1>
        <p className="text-sm text-slate-600 mt-2">
          The link is missing a token. Request a new one from the sign-in page.
        </p>
        <Link
          to="/forgot-password"
          className="text-sm text-brand-700 hover:underline inline-block mt-4"
        >
          Request a new link
        </Link>
      </Shell>
    );
  }

  const pwd = form.watch('new_password') ?? '';

  return (
    <Shell>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Choose a new password</h1>
      <p className="text-sm text-slate-500 mt-1 mb-4">
        Pick something strong — you'll use this to sign in next time.
      </p>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        <PasswordField
          label="New password"
          autoComplete="new-password"
          autoFocus
          {...form.register('new_password', {
            required: 'Required',
            minLength: { value: 12, message: 'At least 12 characters' },
          })}
          error={form.formState.errors.new_password?.message}
        />
        <PasswordStrengthHints password={pwd} />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          {...form.register('confirm_password', { required: 'Required' })}
          error={form.formState.errors.confirm_password?.message}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          disabled={busy}
          className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium press"
        >
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm animate-fade-in-up">
        <div className="flex justify-center mb-6">
          <Brand size="lg" />
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7">{children}</div>
      </div>
    </div>
  );
}
