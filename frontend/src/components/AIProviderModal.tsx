import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

export type AIProviderConfig = { mode: 'api' } | { mode: 'oauth'; token: string };

interface Props {
  open: boolean;
  onConfirm: (config: AIProviderConfig) => void;
  onClose: () => void;
  /** Label for the confirm button, e.g. "Generate" or "Fill in materials". */
  action?: string;
}

export function AIProviderModal({ open, onConfirm, onClose, action = 'Generate' }: Props) {
  const [mode, setMode] = useState<'api' | 'oauth'>('api');
  const [oauthToken, setOauthToken] = useState<string | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  // Reset oauth state when modal opens/closes
  useEffect(() => {
    if (!open) {
      setOauthToken(null);
      setOauthError(null);
      setOauthBusy(false);
    }
  }, [open]);

  // Listen for the postMessage from the OAuth callback page
  useEffect(() => {
    function handler(event: MessageEvent) {
      if (!event.data || typeof event.data !== 'object') return;
      const { type, token, error } = event.data as {
        type?: string;
        token?: string;
        error?: string;
      };
      if (type === 'ai_oauth_complete' && token) {
        setOauthToken(token);
        setOauthBusy(false);
        setOauthError(null);
        popupRef.current?.close();
      } else if (type === 'ai_oauth_error') {
        setOauthError(error ?? 'OAuth failed — try again.');
        setOauthBusy(false);
        popupRef.current?.close();
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  function openOAuthPopup() {
    setOauthError(null);
    setOauthToken(null);
    setOauthBusy(true);
    const popup = window.open(
      '/api/training/ai/oauth/start',
      'anthropic_oauth',
      'width=600,height=720,left=200,top=100,resizable=yes,scrollbars=yes',
    );
    popupRef.current = popup;
    // If popup was blocked, fall back gracefully
    if (!popup) {
      setOauthBusy(false);
      setOauthError('Popup blocked — allow popups for this site and try again.');
    }
  }

  function handleConfirm() {
    if (mode === 'oauth' && oauthToken) {
      onConfirm({ mode: 'oauth', token: oauthToken });
    } else if (mode === 'api') {
      onConfirm({ mode: 'api' });
    }
  }

  const canConfirm = mode === 'api' || (mode === 'oauth' && !!oauthToken);

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
        {/* OAuth option */}
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
            <div className="text-sm font-medium text-ink">OAuth</div>
            <div className="text-xs text-muted mt-0.5">
              Log in with your Claude.ai subscription — no API key needed
            </div>
            {mode === 'oauth' && (
              <div className="mt-2">
                {oauthToken ? (
                  <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Connected — ready to generate
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openOAuthPopup}
                    loading={oauthBusy}
                    disabled={oauthBusy}
                  >
                    {oauthBusy ? 'Connecting…' : 'Login with Claude.ai →'}
                  </Button>
                )}
                {oauthError && <p className="text-xs text-red-500 mt-1.5">{oauthError}</p>}
              </div>
            )}
          </div>
        </label>

        {/* API option */}
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
