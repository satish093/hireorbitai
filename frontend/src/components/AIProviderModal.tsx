import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { api } from '../services/api';

export type AIProviderConfig = { mode: 'api' } | { mode: 'oauth'; token: string };

const STORAGE_KEY = 'ai_oauth_token';

interface Props {
  open: boolean;
  onConfirm: (config: AIProviderConfig) => void;
  onClose: () => void;
  action?: string;
  /** When true the server key option is available (server is configured) */
  serverConfigured?: boolean;
}

export function AIProviderModal({
  open,
  onConfirm,
  onClose,
  action = 'Generate',
  serverConfigured = false,
}: Props) {
  const [mode, setMode] = useState<'api' | 'oauth'>(serverConfigured ? 'api' : 'oauth');
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '');
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCheckError(null);
    // Pre-select oauth if a saved token exists, otherwise default to server key if configured
    if (localStorage.getItem(STORAGE_KEY)) setMode('oauth');
    else setMode(serverConfigured ? 'api' : 'oauth');
  }, [open, serverConfigured]);

  function handleTokenChange(v: string) {
    setToken(v);
    setCheckError(null);
    if (v) localStorage.setItem(STORAGE_KEY, v);
    else localStorage.removeItem(STORAGE_KEY);
  }

  async function handleConfirm() {
    if (mode === 'api') {
      onConfirm({ mode: 'api' });
      return;
    }
    // OAuth path: validate subscription before generating
    const trimmed = token.trim();
    if (trimmed.length < 10) {
      setCheckError('Enter your Claude Max OAuth token first.');
      return;
    }
    if (!trimmed.startsWith('sk-ant-oat01-')) {
      setCheckError(
        'This must be a Claude Max OAuth token starting with sk-ant-oat01-. ' +
          'API keys (sk-ant-api03-) are not supported here.',
      );
      return;
    }
    setChecking(true);
    setCheckError(null);
    try {
      const r = await api.post('/training/ai/check-token', { aiToken: trimmed });
      if (r.data?.ok) {
        onConfirm({ mode: 'oauth', token: trimmed });
      } else {
        setCheckError(
          'Subscription check failed — ' +
            (r.data?.error ?? 'your Claude Max subscription may not be active.') +
            ' Visit claude.ai/settings to check your plan.',
        );
      }
    } catch {
      setCheckError('Could not reach the server to validate your token. Please try again.');
    } finally {
      setChecking(false);
    }
  }

  const canConfirm =
    !checking && (mode === 'api' || (mode === 'oauth' && token.trim().startsWith('sk-ant-oat01-')));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose AI Provider"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={checking}>
            Cancel
          </Button>
          <Button
            variant="accent"
            onClick={handleConfirm}
            disabled={!canConfirm}
            loading={checking}
          >
            {checking ? 'Checking subscription…' : `${action} →`}
          </Button>
        </div>
      }
    >
      <div className="space-y-2">
        {/* Claude Max OAuth token */}
        <label
          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            mode === 'oauth' ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/40'
          }`}
        >
          <input
            type="radio"
            name="ai-mode"
            value="oauth"
            checked={mode === 'oauth'}
            onChange={() => setMode('oauth')}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink">Claude Max OAuth token</div>
            <div className="text-xs text-muted mt-0.5">
              Use your Claude Max subscription. We&apos;ll verify your subscription is active before
              generating.
            </div>
            {mode === 'oauth' && (
              <div className="mt-2 space-y-1.5">
                <input
                  type="password"
                  value={token}
                  onChange={(e) => handleTokenChange(e.target.value)}
                  placeholder="sk-ant-oat01-…"
                  autoFocus
                  className="w-full text-sm bg-bg-sunken border border-border rounded-md px-2.5 py-1.5 text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
                {checkError && (
                  <p className="text-xs text-rose-600 dark:text-rose-400">{checkError}</p>
                )}
                <a
                  href="https://claude.ai/settings"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  Manage your Claude Max subscription →
                </a>
              </div>
            )}
          </div>
        </label>

        {/* Server key */}
        <label
          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            mode === 'api' ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/40'
          } ${!serverConfigured ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <input
            type="radio"
            name="ai-mode"
            value="api"
            checked={mode === 'api'}
            onChange={() => setMode('api')}
            disabled={!serverConfigured}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <div>
            <div className="text-sm font-medium text-ink">
              Server key
              {serverConfigured && (
                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 px-1.5 py-0.5 rounded-full">
                  Configured
                </span>
              )}
            </div>
            <div className="text-xs text-muted mt-0.5">
              {serverConfigured
                ? 'Use the OAuth token or API key already set up on the server.'
                : 'No server key configured — go to AI Settings to set one up.'}
            </div>
          </div>
        </label>
      </div>
    </Modal>
  );
}
