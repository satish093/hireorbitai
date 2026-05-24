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
    // Both options use the server key — 'api' mode sends no aiToken in the request body
    onConfirm({ mode: 'api' });
  }

  const oauthReady = oauthPhase === 'connected';
  // API key option is always ready — the key is already in .env
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
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="accent" onClick={handleConfirm} disabled={!canGenerate}>
            {action} →
          </Button>
        </div>
      }
    >
      <div className="space-y-2">
        {/* ── OAuth option ── */}
        <div
          className={`rounded-lg border p-3 transition-colors ${
            mode === 'oauth' ? 'border-accent bg-accent/5' : 'border-border'
          }`}
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="ai-mode"
              value="oauth"
              checked={mode === 'oauth'}
              onChange={() => setMode('oauth')}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink">Claude Max (OAuth)</span>
                {oauthPhase === 'checking' && <span className="text-xs text-muted">Checking…</span>}
                {oauthPhase === 'connected' && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Connected
                  </span>
                )}
              </div>
              <div className="text-xs text-muted mt-0.5">
                Use your Claude Max subscription. No API credits needed.
              </div>

              {mode === 'oauth' && (
                <div className="mt-3 space-y-2">
                  {(oauthPhase === 'idle' || oauthPhase === 'error') && (
                    <>
                      {oauthError && (
                        <p className="text-xs text-rose-600 dark:text-rose-400">{oauthError}</p>
                      )}
                      <Button variant="outline" size="sm" onClick={handleConnect}>
                        Connect Claude Max
                      </Button>
                    </>
                  )}

                  {oauthPhase === 'starting' && (
                    <p className="text-xs text-muted">Starting authentication…</p>
                  )}

                  {oauthPhase === 'awaiting_approval' && (
                    <div className="space-y-2">
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2.5 space-y-1.5">
                        <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                          Open this URL in your browser and approve the login:
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
                      <Button variant="accent" size="sm" onClick={handleApproved}>
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
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
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
          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            mode === 'apikey' ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/40'
          }`}
        >
          <input
            type="radio"
            name="ai-mode"
            value="apikey"
            checked={mode === 'apikey'}
            onChange={() => setMode('apikey')}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <div>
            <div className="text-sm font-medium text-ink">API key</div>
            <div className="text-xs text-muted mt-0.5">
              Use the Anthropic API key configured on the server.
            </div>
          </div>
        </label>
      </div>
    </Modal>
  );
}
