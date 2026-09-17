import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../Button';
import { api } from '../../services/api';

type LinkedInStatus = 'not_connected' | 'connected' | 'reauthorization_required';

interface StatusResponse {
  status: LinkedInStatus;
  linkedinMemberId?: string;
  connectedAt?: string;
  lastVerifiedAt?: string | null;
  accessTokenExpiresAt?: string;
}

/**
 * Persistent, account-level LinkedIn connection used by the Application
 * Copilot. This is identity only (Sign In with LinkedIn / OpenID Connect) —
 * LinkedIn issues no refresh token at this tier, so a token that's expired or
 * been revoked always says "reconnect", never "auto-refreshed".
 */
export function LinkedInConnectionCard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    api
      .get('/linkedin/status')
      .then((r) => setStatus(r.data))
      .catch(() => setStatus({ status: 'not_connected' }))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function connect() {
    setBusy(true);
    try {
      const r = await api.get('/linkedin/authorize');
      window.location.href = r.data.url;
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to start LinkedIn connect');
      setBusy(false);
    }
  }

  async function disconnect() {
    if (
      !confirm('Disconnect LinkedIn? You will need to reconnect before applying via the Copilot.')
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.post('/linkedin/disconnect');
      toast.success('LinkedIn disconnected');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to disconnect');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-hover border border-border rounded-xl p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-3">
        LinkedIn connection
      </div>

      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : !status || status.status === 'not_connected' ? (
        <div className="space-y-2.5">
          <p className="text-sm text-muted">
            Connect LinkedIn to use the Application Copilot's one-click apply-and-confirm flow on
            LinkedIn job postings.
          </p>
          <Button variant="primary" size="sm" onClick={connect} loading={busy}>
            Connect LinkedIn
          </Button>
        </div>
      ) : status.status === 'reauthorization_required' ? (
        <div className="space-y-2.5">
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Your LinkedIn connection needs to be reconnected before you can confirm applications.
          </p>
          <Button variant="outline" size="sm" onClick={connect} loading={busy}>
            Reconnect LinkedIn
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="text-sm text-ink">Connected</div>
          {status.connectedAt && (
            <div className="text-xs text-muted">
              Since {new Date(status.connectedAt).toLocaleDateString()}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={connect} loading={busy}>
              Reconnect
            </Button>
            <Button variant="danger-ghost" size="sm" onClick={disconnect} loading={busy}>
              Disconnect
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
