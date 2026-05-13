import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabase';
import { api } from '../services/api';
import { Role } from '../types';
import { Brand } from '../components/Brand';
import { config as appConfig } from '../config/env';

const API_URL = appConfig.apiBaseUrl;

interface InvitePreview {
  email: string;
  role: Role;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  expires_at: string;
  expired: boolean;
}

/**
 * Two entry paths:
 *   A. User clicked the Supabase-sent invite email — they arrive with an auth
 *      session already (Supabase set it via the URL hash). We just collect the
 *      password + full name, set the password via auth.updateUser, then POST
 *      /invitations/complete to apply the invited role.
 *   B. User has only a manually-shared link and no session — fall back to the
 *      original /invitations/setup flow (creates the auth user with the given
 *      password).
 */
export function AcceptInvitation() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { session, signIn, refreshProfile } = useAuth();
  const nav = useNavigate();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setError('Missing invitation token'); setLoading(false); return; }
    const controller = new AbortController();
    (async () => {
      try {
        const r = await axios.get(`${API_URL}/invitations/preview`, { params: { token }, signal: controller.signal });
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

  const hasSession = !!session;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (password !== confirm) { toast.error("Passwords don't match"); return; }
    if (!preview) return;
    setSubmitting(true);
    try {
      if (hasSession) {
        // Path A — Supabase invite link, user already authed.
        if (session?.user.email?.toLowerCase() !== preview.email.toLowerCase()) {
          throw new Error(`You're signed in as ${session?.user.email}, but this invitation is for ${preview.email}. Sign out first.`);
        }
        const { error: updErr } = await supabase.auth.updateUser({ password });
        if (updErr) throw updErr;
        // Apply role + name (uses the current session — interceptor adds bearer)
        await api.post('/invitations/complete', { token, full_name: fullName.trim() || undefined });
        await refreshProfile();
      } else {
        // Path B — no session yet (manual link). Create auth user via our endpoint.
        await axios.post(`${API_URL}/invitations/setup`, {
          token, password, full_name: fullName.trim() || undefined,
        });
        await signIn(preview.email, password);
      }
      toast.success('Welcome to HireOrbit AI');
      if (preview.role === 'CONSULTANT') nav('/onboarding/consultant', { replace: true });
      else if (preview.role === 'RECRUITER') nav('/onboarding/recruiter', { replace: true });
      else nav('/dashboard', { replace: true });
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message ?? 'Failed to complete sign-up';
      toast.error(msg);
    } finally { setSubmitting(false); }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md animate-fade-in-up">
        {/* Brand */}
        <div className="flex justify-center mb-6">
          <Brand size="lg" caption="Bridging Talent · Building Futures" />
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          {loading ? (
            <p className="text-sm text-slate-500 text-center">Loading invitation…</p>
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
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">Already accepted</h1>
              <p className="text-sm text-slate-600">This invitation has been used. Sign in to continue.</p>
              <button onClick={() => nav('/login')} className="bg-slate-900 text-white text-sm px-4 py-2 rounded-lg">
                Go to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <div className="text-[10px] font-semibold tracking-widest text-brand-700 uppercase mb-1">
                  You've been invited
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Set up your account</h1>
                <p className="text-sm text-slate-600 mt-1">
                  Joining as <span className="font-medium text-slate-900">{roleLabel(preview.role)}</span> ·{' '}
                  <span className="text-slate-700">{preview.email}</span>
                </p>
                {hasSession && (
                  <p className="text-xs text-emerald-700 mt-1">✓ Email verified via invitation link</p>
                )}
              </div>

              <label className="block">
                <span className="block text-xs font-medium text-slate-700 mb-1">Full name</span>
                <input
                  value={fullName} onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                  autoFocus
                />
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-slate-700 mb-1">Password</span>
                <input
                  type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-700 mb-1">Confirm password</span>
                <input
                  type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                />
              </label>

              <button
                disabled={submitting}
                className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium"
              >
                {submitting ? 'Creating account…' : 'Create account & continue'}
              </button>

              <p className="text-xs text-slate-500 text-center">
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
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Can't open this invitation</h1>
      <p className="text-sm text-slate-600">{message}</p>
      <button onClick={() => nav('/login')} className="text-sm text-brand-700 hover:underline">
        Back to sign in
      </button>
    </div>
  );
}

function roleLabel(r: Role): string {
  return r.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
