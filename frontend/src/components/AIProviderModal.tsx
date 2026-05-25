import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { api } from '../services/api';

export type AIProviderConfig = { mode: 'api' } | { mode: 'oauth'; token: string };

type OAuthPhase =
  | 'checking'
  | 'idle'
  | 'starting'
  | 'awaiting_approval'
  | 'polling'
  | 'restarting'
  | 'connected'
  | 'error';

interface Props {
  open: boolean;
  onConfirm: (config: AIProviderConfig) => void;
  onClose: () => void;
  action?: string;
}

export function AIProviderModal({ open, onConfirm, onClose, action = 'Generate' }: Props) {
  const [mode, setMode] = useState<'oauth' | 'apikey'>('oauth');

  // OAuth state machine
  const [oauthPhase, setOauthPhase] = useState<OAuthPhase>('checking');
  const [authUrl, setAuthUrl] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [oauthError, setOauthError] = useState('');
  const [copied, setCopied] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // On open: check if server already has a subscription configured
  useEffect(() => {
    if (!open) {
      stopPoll();
      return;
    }
    setOauthPhase('checking');
    setOauthError('');
    api
      .get<{ provider: string }>('/training/ai/provider')
      .then((r) => {
        setOauthPhase(r.data?.provider === 'subscription' ? 'connected' : 'idle');
      })
      .catch(() => setOauthPhase('idle'));
  }, [open]);

  // Clean up poll on unmount
  useEffect(() => () => stopPoll(), []);

  async function handleConnect() {
    setOauthError('');
    setOauthPhase('starting');
    try {
      const { data } = await api.post<{ sessionId: string; url: string }>(
        '/training/ai/claude-auth/start',
      );
      setSessionId(data.sessionId);
      setAuthUrl(data.url);
      setOauthPhase('awaiting_approval');
    } catch (e: any) {
      setOauthError(e?.response?.data?.error ?? e?.message ?? 'Failed to start login');
      setOauthPhase('error');
    }
  }

  function handleApproved() {
    setOauthPhase('polling');
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get<{ status: string; error?: string }>(
          `/training/ai/claude-auth/${sessionId}/status`,
        );
        if (data.status === 'complete') {
          stopPoll();
          setOauthPhase('restarting');
          setTimeout(() => setOauthPhase('connected'), 5000);
        } else if (data.status === 'failed' || data.status === 'not_found') {
          stopPoll();
          setOauthError(data.error ?? 'Login failed or timed out. Please try again.');
          setOauthPhase('error');
        }
      } catch {
        // network hiccup during server restart — ignore
      }
    }, 3000);
  }

  function handleConfirm() {
    onConfirm({ mode: 'api' });
  }

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(authUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (e.g. insecure context) — the Open link button still works.
    }
  }

  const oauthReady = oauthPhase === 'connected';
  const canGenerate = mode === 'apikey' || oauthReady;
  const busy = oauthPhase === 'starting' || oauthPhase === 'polling' || oauthPhase === 'restarting';

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) {
          stopPoll();
          onClose();
        }
      }}
      title="Choose AI Provider"
      size="sm"
      footer={
        /* Stack vertically on mobile (primary on top), row on sm+. `w-full` so
           the row spans the footer; `min-w-0` + `whitespace-normal` let a long
           action label wrap instead of pushing the dialog off-screen. */
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy}
            block
            className="min-w-0 sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            variant="accent"
            onClick={handleConfirm}
            disabled={!canGenerate}
            block
            className="min-w-0 whitespace-normal sm:w-auto sm:max-w-[65%]"
          >
            {action} →
          </Button>
        </div>
      }
    >
      {/* min-w-0 so no long token (e.g. the auth URL) can stretch the dialog. */}
      <div className="min-w-0 space-y-2">
        {/* ── OAuth option ── */}
        <div
          className={`rounded-lg border p-3 sm:p-4 transition-colors ${
            mode === 'oauth' ? 'border-accent bg-accent/5' : 'border-border'
          }`}
        >
          <label className="flex items-start gap-2.5 sm:gap-3 cursor-pointer">
            <input
              type="radio"
              name="ai-mode"
              value="oauth"
              checked={mode === 'oauth'}
              onChange={() => setMode('oauth')}
              className="mt-1 accent-[var(--accent)] shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium text-ink">Claude Max (OAuth)</span>
                {oauthPhase === 'checking' && <span className="text-xs text-muted">Checking…</span>}
                {oauthPhase === 'connected' && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                    Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-muted mt-0.5 break-words">
                Use your Claude Max subscription. No API credits needed.
              </p>

              {mode === 'oauth' && (
                <div className="mt-3 space-y-2">
                  {(oauthPhase === 'idle' || oauthPhase === 'error') && (
                    <>
                      {oauthError && (
                        <p className="text-xs text-rose-600 dark:text-rose-400 break-words">
                          {oauthError}
                        </p>
                      )}
                      <Button variant="outline" size="sm" onClick={handleConnect} block>
                        Connect Claude Max
                      </Button>
                    </>
                  )}

                  {oauthPhase === 'starting' && (
                    <p className="text-xs text-muted">Starting authentication…</p>
                  )}

                  {oauthPhase === 'awaiting_approval' && (
                    <div className="space-y-2">
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2.5 space-y-2">
                        <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                          Open this URL in your browser and approve the login:
                        </p>
                        {/* Internal scroll cap so a long URL never grows the dialog. */}
                        <div className="max-h-24 overflow-y-auto overflow-x-hidden rounded border border-amber-200/70 dark:border-amber-800/70 bg-white/60 dark:bg-black/20 px-2 py-1.5">
                          <span className="block text-[11px] leading-relaxed break-all text-ink/80">
                            {authUrl}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={authUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-[5px] border border-border-strong bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            Open link ↗
                          </a>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCopyUrl}
                            className="min-w-0 flex-1"
                          >
                            {copied ? 'Copied ✓' : 'Copy'}
                          </Button>
                        </div>
                      </div>
                      <Button variant="accent" size="sm" onClick={handleApproved} block>
                        I&apos;ve approved — continue
                      </Button>
                    </div>
                  )}

                  {oauthPhase === 'polling' && (
                    <p className="text-xs text-muted">
                      Waiting for authorization… (checking every 3 s)
                    </p>
                  )}

                  {oauthPhase === 'restarting' && (
                    <p className="text-xs text-muted">Token saved — server restarting (~5 s)…</p>
                  )}

                  {oauthPhase === 'connected' && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 break-words">
                      Subscription is active. Click &ldquo;{action} →&rdquo; to proceed.
                    </p>
                  )}
                </div>
              )}
            </div>
          </label>
        </div>

        {/* ── API key option ── */}
        <label
          className={`flex items-start gap-2.5 sm:gap-3 p-3 sm:p-4 rounded-lg border cursor-pointer transition-colors ${
            mode === 'apikey' ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/40'
          }`}
        >
          <input
            type="radio"
            name="ai-mode"
            value="apikey"
            checked={mode === 'apikey'}
            onChange={() => setMode('apikey')}
            className="mt-1 accent-[var(--accent)] shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink">API key</div>
            <p className="text-xs text-muted mt-0.5 break-words">
              Use the Anthropic API key configured on the server.
            </p>
          </div>
        </label>
      </div>
    </Modal>
  );
}
