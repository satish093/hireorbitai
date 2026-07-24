import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { Button } from '../components/Button';

type ProviderStatus = 'subscription' | 'api' | 'none' | 'loading';
type LoginPhase = 'idle' | 'starting' | 'awaiting_approval' | 'polling' | 'restarting' | 'done';

export function AdminAISettings() {
  const [provider, setProvider] = useState<ProviderStatus>('loading');
  const [loginPhase, setLoginPhase] = useState<LoginPhase>('idle');
  const [authUrl, setAuthUrl] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProvider = () => {
    api
      .get<{ provider: string }>('/training/ai/provider')
      .then((r: { data: { provider: string } }) =>
        setProvider((r.data?.provider ?? 'none') as ProviderStatus),
      )
      .catch(() => setProvider('none'));
  };

  useEffect(() => {
    fetchProvider();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Fast path: refresh token via `claude setup-token` ──────────────────────
  async function handleRefresh() {
    setError('');
    setSuccessMsg('');
    setLoginPhase('starting');
    try {
      await api.post('/training/ai/claude-auth/refresh');
      setLoginPhase('restarting');
      setSuccessMsg('Token refreshed. Server is restarting (~3 s)…');
      // Wait for the server to come back, then re-fetch provider status
      setTimeout(() => {
        setLoginPhase('done');
        fetchProvider();
        setSuccessMsg('Token refreshed successfully. AI generation is active.');
      }, 5000);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Refresh failed');
      setLoginPhase('idle');
    }
  }

  // ── Re-login flow: `claude auth login` ─────────────────────────────────────
  async function handleStartLogin() {
    setError('');
    setSuccessMsg('');
    setLoginPhase('starting');
    try {
      const { data } = await api.post<{ sessionId: string; url: string }>(
        '/training/ai/claude-auth/start',
      );
      setSessionId(data.sessionId);
      setAuthUrl(data.url);
      setLoginPhase('awaiting_approval');
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to start login');
      setLoginPhase('idle');
    }
  }

  // ── Submit the browser-issued code, then poll for completion ───────────────
  async function handleSubmitCode() {
    const trimmed = code.trim();
    if (trimmed.length < 8) {
      setError('Paste the full authorization code from the browser.');
      return;
    }
    setError('');
    try {
      await api.post(`/training/ai/claude-auth/${sessionId}/code`, { code: trimmed });
      startPolling();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to submit code');
    }
  }

  function startPolling() {
    setLoginPhase('polling');
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get<{ status: string; error?: string }>(
          `/training/ai/claude-auth/${sessionId}/status`,
        );
        if (data.status === 'complete') {
          clearInterval(pollRef.current!);
          setCode('');
          setLoginPhase('restarting');
          setSuccessMsg('Login successful! Server is restarting (~3 s)…');
          setTimeout(() => {
            setLoginPhase('done');
            fetchProvider();
            setSuccessMsg('Authentication complete. AI generation is active.');
          }, 5000);
        } else if (data.status === 'failed' || data.status === 'not_found') {
          clearInterval(pollRef.current!);
          setError(data.error ?? 'Login failed or timed out. Please try again.');
          setLoginPhase('idle');
        }
        // status === 'pending' → keep polling
      } catch {
        // network hiccup during server restart — ignore
      }
    }, 3000);
  }

  const busy = loginPhase !== 'idle' && loginPhase !== 'done';

  const statusBadge = () => {
    if (provider === 'loading') return <span className="text-muted text-sm">Checking…</span>;
    if (provider === 'subscription')
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Active — Claude subscription
        </span>
      );
    if (provider === 'api')
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          Active — API key
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        Not configured / token expired
      </span>
    );
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">AI Settings</h1>
        <p className="text-sm text-muted mt-1">
          Manage the Claude AI credential used for training content generation.
        </p>
      </div>

      {/* Status card */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-ink">Server AI provider</div>
            <div className="mt-1">{statusBadge()}</div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchProvider} disabled={busy}>
            Refresh status
          </Button>
        </div>

        {/* Success / error banners */}
        {successMsg && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
            {successMsg}
          </div>
        )}
        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <hr className="border-border" />

        {/* Fast-refresh section */}
        <div>
          <div className="text-sm font-medium text-ink mb-1">Refresh token</div>
          <p className="text-xs text-muted mb-3">
            Generates a new 1-year token using the Claude CLI already authenticated on the server.
            Use this when the current token has expired.
          </p>
          <Button variant="accent" size="sm" onClick={handleRefresh} disabled={busy}>
            {loginPhase === 'starting' && !authUrl
              ? 'Refreshing…'
              : loginPhase === 'restarting'
                ? 'Restarting server…'
                : 'Refresh token'}
          </Button>
        </div>

        <hr className="border-border" />

        {/* Re-login section */}
        <div>
          <div className="text-sm font-medium text-ink mb-1">Re-authenticate Claude CLI</div>
          <p className="text-xs text-muted mb-3">
            If the CLI session itself has expired, start a new login flow. You will be given a URL
            to open in your browser.
          </p>

          {loginPhase === 'idle' || loginPhase === 'done' ? (
            <Button variant="outline" size="sm" onClick={handleStartLogin}>
              Start re-authentication
            </Button>
          ) : loginPhase === 'starting' && !authUrl ? (
            <Button variant="outline" size="sm" disabled>
              Starting…
            </Button>
          ) : loginPhase === 'awaiting_approval' ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 space-y-2">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                  Open this URL in your browser, approve the login, then paste the code it gives you
                  below:
                </p>
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-xs break-all text-accent hover:underline"
                >
                  {authUrl}
                </a>
              </div>
              <div className="space-y-2">
                <label htmlFor="claude-auth-code" className="block text-xs font-medium text-ink">
                  Authorization code
                </label>
                <input
                  id="claude-auth-code"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Paste the code from the browser"
                  className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <Button
                  variant="accent"
                  size="sm"
                  onClick={handleSubmitCode}
                  disabled={code.trim().length < 8}
                >
                  Submit code
                </Button>
              </div>
            </div>
          ) : loginPhase === 'polling' ? (
            <div className="text-sm text-muted">Waiting for approval… (checking every 3 s)</div>
          ) : loginPhase === 'restarting' ? (
            <div className="text-sm text-muted">Server restarting…</div>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-muted">
        Tokens are valid for 1 year. After refresh the server restarts automatically (~3 s
        downtime).
      </p>
    </div>
  );
}
