import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

export type AIProviderConfig = { mode: 'api' } | { mode: 'oauth'; token: string };

const STORAGE_KEY = 'ai_custom_token';

interface Props {
  open: boolean;
  onConfirm: (config: AIProviderConfig) => void;
  onClose: () => void;
  action?: string;
}

export function AIProviderModal({ open, onConfirm, onClose, action = 'Generate' }: Props) {
  const [mode, setMode] = useState<'api' | 'oauth'>('api');
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '');

  useEffect(() => {
    if (!open) return;
    // Pre-select "OAuth" if a saved token exists
    if (localStorage.getItem(STORAGE_KEY)) setMode('oauth');
  }, [open]);

  function handleTokenChange(v: string) {
    setToken(v);
    if (v) localStorage.setItem(STORAGE_KEY, v);
    else localStorage.removeItem(STORAGE_KEY);
  }

  function handleConfirm() {
    if (mode === 'oauth') onConfirm({ mode: 'oauth', token });
    else onConfirm({ mode: 'api' });
  }

  const canConfirm = mode === 'api' || (mode === 'oauth' && token.trim().length > 10);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose AI Provider"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" onClick={handleConfirm} disabled={!canConfirm}>
            {action} →
          </Button>
        </div>
      }
    >
      <div className="space-y-2">
        {/* My API Key option */}
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
            <div className="text-sm font-medium text-ink">My API Key</div>
            <div className="text-xs text-muted mt-0.5">
              Use your own Anthropic API key — billed to your account
            </div>
            {mode === 'oauth' && (
              <div className="mt-2 space-y-1.5">
                <input
                  type="password"
                  value={token}
                  onChange={(e) => handleTokenChange(e.target.value)}
                  placeholder="sk-ant-…"
                  autoFocus
                  className="w-full text-sm bg-bg-sunken border border-border rounded-md px-2.5 py-1.5 text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  Get your API key from console.anthropic.com →
                </a>
              </div>
            )}
          </div>
        </label>

        {/* Server API key option */}
        <label
          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            mode === 'api' ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/40'
          }`}
        >
          <input
            type="radio"
            name="ai-mode"
            value="api"
            checked={mode === 'api'}
            onChange={() => setMode('api')}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <div>
            <div className="text-sm font-medium text-ink">API</div>
            <div className="text-xs text-muted mt-0.5">
              Use the API key configured on the server (.env)
            </div>
          </div>
        </label>
      </div>
    </Modal>
  );
}
