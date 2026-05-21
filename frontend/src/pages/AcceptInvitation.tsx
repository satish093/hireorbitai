import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Role } from '../types';
import { Brand } from '../components/Brand';
import { PasswordField, PasswordStrengthHints } from '../components/PasswordField';
import { FormInput } from '../components/FormInput';
import { config as appConfig } from '../config/env';

const API_URL = appConfig.apiBaseUrl;

interface InvitePreview {
  email: string;
  role: Role;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  expires_at: string;
  expired: boolean;
}

interface SetupResponse {
  email: string;
  role: Role;
  session: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  } | null;
}

/**
 * Brevo-only invitation accept flow.
 *
 * The user lands here from the email link with `?token=…`. There is NO
 * backend session at this point (we removed the third-party invitation flow — Brevo
 * delivers a plain token URL, not a magic-link). The full flow:
 *
 *   1. GET  /invitations/preview?token=…   → fetch role + email + status
 *   2. user enters full name + strong password
 *   3. POST /invitations/setup             → creates auth user + public.users,
 *                                            clears must_change_password,
 *                                            returns a fresh session pair
 *   4. push that session into the local store (via AuthContext.refreshSession)
 *   5. route to /onboarding/* or /dashboard based on role
 *
 * If the user happens to be signed in as someone else when they click the
 * link, we sign them out first — silently rotating the password on whoever
 * is currently signed in (the bug the previous implementation had) would be
 * a security incident.
 */
export function AcceptInvitation() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { session, refreshSession, signOut } = useAuth();
  const nav = useNavigate();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  // Sign out any existing session when the page loads with a token. We never
  // want the invitation form to mutate a different user's account.
  useEffect(() => {
    if (token && session) {
      // Fire-and-forget — we don't block the page on this.
      void signOut();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) {
      setError('Missing invitation token');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const r = await axios.get(`${API_URL}/invitations/preview`, {
          params: { token },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setPreview(r.data);
      } catch (e: any) {
        if (controller.signal.aborted) return;
        setError(e?.response?.data?.error ?? 'Could not load invitation');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    if (!fullName.trim()) {
      setSubmitErr('Please enter your full name.');
      return;
    }
    if (password.length < 12) {
      setSubmitErr('Password must be at least 12 characters.');
      return;
    }
    if (password !== confirm) {
      setSubmitErr("Passwords don't match.");
      return;
    }
    if (!preview) return;
    setSubmitting(true);
    try {
      const { data } = await axios.post<SetupResponse>(`${API_URL}/invitations/setup`, {
        token,
        password,
        full_name: fullName.trim() || undefined,
      });

      // Backend returned a session pair — push it into the local session store so the
      // app is immediately signed in. This avoids a second /auth/login
      // roundtrip that could race indexing lag on the just-created user.
      if (data.session) {
        await refreshSession(data.session.access_token, data.session.refresh_token);
      }

      toast.success('Welcome to HireOrbit AI');
      if (!data.session) {
        // Backend couldn't auto-issue a session for some reason. Send them
        // to /login so they can sign in with the password they just set.
        nav('/login', { replace: true });
        return;
      }
      if (preview.role === 'CONSULTANT') nav('/onboarding/consultant', { replace: true });
      else if (preview.role === 'RECRUITER') nav('/onboarding/recruiter', { replace: true });
      else nav('/dashboard', { replace: true });
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message ?? 'Failed to complete sign-up';
      setSubmitErr(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh bg-hover flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md animate-fade-in-up">
        <div className="flex justify-center mb-6">
          <Brand size="lg" />
        </div>

        <div className="bg-surface rounded-2xl border border-border shadow-sm p-8">
          {loading ? (
            <p className="text-sm text-muted text-center">Loading invitation…</p>
          ) : error ? (
            <ErrorState message={error} />
          ) : !preview ? (
            <ErrorState message="Invitation not found" />
          ) : preview.expired || preview.status === 'EXPIRED' ? (
            <ErrorState message="This invitation has expired. Ask your manager to resend it." />
          ) : preview.status === 'REVOKED' ? (
            <ErrorState message="This invitation has been revoked." />
          ) : preview.status === 'ACCEPTED' ? (
            <div className="text-center space-y-3">
              <h1 className="text-xl font-semibold tracking-tight text-ink">Already accepted</h1>
              <p className="text-sm text-muted">
                This invitation has been used. Sign in to continue.
              </p>
              <button
                onClick={() => nav('/login')}
                className="bg-ink text-bg text-sm px-4 py-2 rounded-lg press"
              >
                Go to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <div className="text-[10px] font-semibold tracking-widest text-brand-700 uppercase mb-1">
                  You've been invited
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-ink">
                  Set up your account
                </h1>
                <p className="text-sm text-muted mt-1">
                  Joining as <span className="font-medium text-ink">{roleLabel(preview.role)}</span>{' '}
                  · <span className="text-ink">{preview.email}</span>
                </p>
              </div>

              <FormInput
                label="Full name"
                value={fullName}
                autoFocus
                required
                placeholder="Your full name"
                onChange={(e) => setFullName(e.target.value)}
              />

              <PasswordField
                label="Password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <PasswordStrengthHints password={password} />
              <PasswordField
                label="Confirm password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />

              {submitErr && (
                <p
                  role="alert"
                  aria-live="polite"
                  className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/15 border border-red-100 dark:border-red-500/20 rounded-md px-2.5 py-1.5 animate-fade-in-down"
                >
                  {submitErr}
                </p>
              )}

              <button
                disabled={submitting}
                className="w-full bg-ink hover:opacity-90 disabled:opacity-50 text-bg rounded-lg py-2.5 text-sm font-medium press"
              >
                {submitting ? 'Creating account…' : 'Create account & continue'}
              </button>

              <p className="text-xs text-muted text-center">
                Expires {new Date(preview.expires_at).toLocaleString()}
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  const nav = useNavigate();
  return (
    <div className="text-center space-y-3">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Can't open this invitation</h1>
      <p className="text-sm text-muted">{message}</p>
      <button onClick={() => nav('/login')} className="text-sm text-brand-700 hover:underline">
        Back to sign in
      </button>
    </div>
  );
}

function roleLabel(r: Role): string {
  return r
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
