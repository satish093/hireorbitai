import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../TaskBits';
import { PresencePill } from '../PresenceDot';
import { GroupBadge } from '../GroupBadge';
import { StatusBadge } from '../StatusBadge';
import { ROLE_LABEL, type Role } from '../../types';
import { relationshipLabel } from '../../lib/canMessage';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { BugReportModal } from './BugReportModal';

interface Party {
  id: string;
  email: string;
  full_name?: string | null;
  role?: Role | null;
  last_seen_at?: string | null;
  group_id?: string | null;
}

interface CallLogEntry {
  id: string;
  direction: 'in' | 'out';
  outcome: 'completed' | 'missed' | 'declined';
  duration_seconds: number | null;
  ended_at: string | null;
  started_at: string | null;
}

interface RelatedApp {
  id: string;
  status: string;
  submitted_at: string | null;
  job?: { id: string; title: string; company_name?: string | null } | null;
  vendor?: { id: string; company_name?: string | null } | null;
}

interface Props {
  peer: Party;
  /** Called when the user taps the voice-call button. */
  onCall?: () => void;
  onClose?: () => void;
}

function fmtDuration(s: number | null): string {
  if (s == null) return '';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * ContactPanel — right-side context panel in the 3-pane Messages layout.
 *
 * Desktop: rendered as a persistent right column (lg:w-72).
 * Mobile: rendered inside a BottomSheet triggered from the thread header.
 *
 * Shows: profile header, relationship label, group, profile link, voice-call
 * button, recent call history, and an admin-only audit note slot.
 */
export function ContactPanel({ peer, onCall, onClose }: Props) {
  const { profile } = useAuth();
  const name = peer.full_name ?? peer.email;
  const roleLabel = peer.role ? (ROLE_LABEL[peer.role] ?? peer.role) : '';
  const rel = relationshipLabel(profile?.role, peer.role ?? undefined);
  const isAdmin = profile?.role && ['SUPER_ADMIN', 'CEO', 'CTO', 'DIRECTOR'].includes(profile.role);
  const [bugOpen, setBugOpen] = useState(false);

  // Recent calls with this peer (read-only log).
  const [calls, setCalls] = useState<CallLogEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .get('/calls/history', { params: { peer_id: peer.id, limit: 5 } })
      .then((r) => {
        if (!cancelled) setCalls(r.data ?? []);
      })
      .catch(() => {
        /* feature flag off or endpoint unavailable — hide the section */
      });
    return () => {
      cancelled = true;
    };
  }, [peer.id]);

  // Related work — the peer's latest application (when the peer is a
  // consultant the viewer may see). Server gates this by canViewConversation.
  const [relatedApp, setRelatedApp] = useState<RelatedApp | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRelatedApp(null);
    api
      .get(`/messages/with/${peer.id}/context`)
      .then((r) => {
        if (!cancelled) setRelatedApp(r.data?.application ?? null);
      })
      .catch(() => {
        /* endpoint unavailable / not permitted — hide the section */
      });
    return () => {
      cancelled = true;
    };
  }, [peer.id]);

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: 'var(--surface)' }}>
      {/* Close (mobile only — desktop panel has no X, it closes with peer deselect) */}
      {onClose && (
        <div className="flex justify-end p-3 pb-0 shrink-0">
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full grid place-items-center hover:bg-hover transition-colors"
            style={{ color: 'var(--muted)' }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Profile header */}
      <div className="flex flex-col items-center text-center px-4 pt-5 pb-4 shrink-0">
        <Avatar name={name} email={peer.email} size={64} />
        <div className="mt-3 font-semibold text-[15px]" style={{ color: 'var(--ink)' }}>
          {name}
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
          {roleLabel}
        </div>
        {peer.last_seen_at && (
          <div className="mt-1.5">
            <PresencePill lastSeenAt={peer.last_seen_at} />
          </div>
        )}
      </div>

      <div className="shrink-0 mx-4 border-t" style={{ borderColor: 'var(--border)' }} />

      {/* Info rows */}
      <div className="flex flex-col gap-3 px-4 py-4">
        {/* Relationship */}
        <InfoRow label="Relationship" value={rel} />

        {/* Group */}
        {peer.group_id && (
          <div>
            <div
              className="text-[10.5px] font-bold uppercase tracking-wide mb-1"
              style={{ color: 'var(--muted)' }}
            >
              Group
            </div>
            <GroupBadge groupId={peer.group_id} />
          </div>
        )}

        {/* Email */}
        <InfoRow label="Email" value={peer.email} />
      </div>

      <div className="shrink-0 mx-4 border-t" style={{ borderColor: 'var(--border)' }} />

      {/* Actions */}
      <div className="flex flex-col gap-2 px-4 py-4">
        {/* View profile */}
        <Link
          to={`/users/${peer.id}`}
          className="flex items-center justify-center gap-2 h-9 rounded-lg text-sm font-semibold transition-colors"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--ink)',
          }}
        >
          View profile
        </Link>

        {/* Voice call — disabled only while already in a call (onCall undefined) */}
        <button
          type="button"
          onClick={onCall}
          disabled={!onCall}
          className="flex items-center justify-center gap-2 h-9 rounded-lg text-sm font-semibold transition-colors"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: onCall ? 'var(--ink)' : 'var(--faint)',
            cursor: onCall ? 'pointer' : 'not-allowed',
          }}
          title={onCall ? 'Start a voice call' : 'Unavailable while on a call'}
        >
          <PhoneIcon />
          Voice call
        </button>

        {/* Report an issue — opens the structured bug-report form. */}
        <button
          type="button"
          onClick={() => setBugOpen(true)}
          className="flex items-center justify-center gap-2 h-9 rounded-lg text-sm font-medium transition-colors"
          style={{ color: 'var(--muted)' }}
        >
          Report an issue
        </button>
      </div>

      <BugReportModal open={bugOpen} onClose={() => setBugOpen(false)} />

      {/* Related work — the peer consultant's latest application */}
      {relatedApp && (
        <>
          <div className="shrink-0 mx-4 border-t" style={{ borderColor: 'var(--border)' }} />
          <div className="px-4 py-4">
            <div
              className="text-[10.5px] font-bold uppercase tracking-wide mb-2"
              style={{ color: 'var(--muted)' }}
            >
              Related work
            </div>
            <Link
              to={relatedApp.job?.id ? `/jobs/${relatedApp.job.id}` : '/applications'}
              className="block rounded-lg p-3 transition-colors hover:bg-hover"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>
                {relatedApp.job?.title ?? 'Application'}
              </div>
              <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>
                {relatedApp.job?.company_name ?? relatedApp.vendor?.company_name ?? '—'}
                {relatedApp.submitted_at &&
                  ` · ${new Date(relatedApp.submitted_at).toLocaleDateString()}`}
              </div>
              <div className="mt-1.5">
                <StatusBadge status={relatedApp.status} />
              </div>
            </Link>
          </div>
        </>
      )}

      {/* Recent calls */}
      {calls.length > 0 && (
        <>
          <div className="shrink-0 mx-4 border-t" style={{ borderColor: 'var(--border)' }} />
          <div className="px-4 py-4">
            <div
              className="text-[10.5px] font-bold uppercase tracking-wide mb-2"
              style={{ color: 'var(--muted)' }}
            >
              Recent calls
            </div>
            <ul className="space-y-2">
              {calls.map((c) => {
                const missed = c.outcome === 'missed';
                const declined = c.outcome === 'declined';
                const when = c.ended_at ?? c.started_at;
                return (
                  <li key={c.id} className="flex items-center gap-2.5 text-[13px]">
                    {/* Direction + outcome icon (text label too — not color alone) */}
                    <span
                      className="shrink-0"
                      style={{
                        color: missed || declined ? 'var(--danger)' : 'var(--ink-2)',
                        transform: c.direction === 'out' ? 'scaleX(-1)' : undefined,
                      }}
                      aria-hidden="true"
                    >
                      {c.direction === 'in' ? '↙' : '↗'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div style={{ color: 'var(--ink)' }}>
                        {c.direction === 'in' ? 'Incoming' : 'Outgoing'}
                        {missed && ' · Missed'}
                        {declined && ' · Declined'}
                        {c.outcome === 'completed' && c.duration_seconds != null && (
                          <span style={{ color: 'var(--muted)' }}>
                            {' '}
                            · {fmtDuration(c.duration_seconds)}
                          </span>
                        )}
                      </div>
                      {when && (
                        <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
                          {new Date(when).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      {/* Admin audit note (admin-only) */}
      {isAdmin && (
        <>
          <div className="shrink-0 mx-4 border-t" style={{ borderColor: 'var(--border)' }} />
          <div className="px-4 py-4">
            <div
              className="text-[10.5px] font-bold uppercase tracking-wide mb-2"
              style={{ color: 'var(--muted)' }}
            >
              Admin note
            </div>
            <textarea
              placeholder="Internal note about this user (admin-only, not shared)"
              rows={3}
              className="w-full rounded-lg px-3 py-2 text-sm resize-none outline-none"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--ink)',
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="text-[10.5px] font-bold uppercase tracking-wide mb-0.5"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </div>
      <div className="text-sm" style={{ color: 'var(--ink)' }}>
        {value}
      </div>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.62 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
