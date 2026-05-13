import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import axios from 'axios';
import { FormInput } from '../components/FormInput';
import { Brand } from '../components/Brand';
import { config as appConfig } from '../config/env';

interface ForgotForm { email: string }

/**
 * Standalone "Forgot password?" page. Posts to /api/auth/forgot-password
 * which kicks off the Brevo-backed flow (no Supabase recovery emails).
 *
 * The endpoint always returns 200 to prevent user enumeration; we mirror
 * that on the client by always showing the same success state.
 */
export function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useForm<ForgotForm>();

  async function submit(d: ForgotForm) {
    setBusy(true);
    try {
      await axios.post(`${appConfig.apiBaseUrl}/auth/forgot-password`, { email: d.email });
      setSent(true);
    } catch (e: any) {
      // Even network errors shouldn't reveal whether the email exists. Show
      // success regardless. We *do* surface a toast if it was a 429 (rate
      // limit) so the user understands why nothing happens.
      if (e?.response?.status === 429) {
        toast.error('Too many requests. Please wait a few minutes and try again.');
      } else {
        setSent(true);
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm animate-fade-in-up">
        <div className="flex justify-center mb-6">
          <Brand size="lg" caption="Bridging Talent · Building Futures" />
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7">
          {!sent ? (
            <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
              <Link to="/login" className="text-xs text-slate-500 hover:text-slate-900">← Back to sign in</Link>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-slate-900 mt-1">Reset your password</h1>
                <p className="text-sm text-slate-500 mt-1">
                  We'll send you an email with a link to set a new password. The link is valid for 15 minutes.
                </p>
              </div>
              <FormInput
                label="Email"
                type="email"
                autoComplete="username"
                autoFocus
                {...form.register('email', { required: 'Required' })}
                error={form.formState.errors.email?.message}
              />
              <button
                disabled={busy}
                className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium press"
              >
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          ) : (
            <div className="space-y-3 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 text-2xl mx-auto">✓</div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">Check your inbox</h1>
              <p className="text-sm text-slate-600">
                If an account exists for that email, we just sent a password-reset link. It's valid for 15 minutes.
              </p>
              <Link to="/login" className="text-sm text-brand-700 hover:underline inline-block mt-2">
                Back to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
