import { useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

// Daily job-alert opt-in toggle, shown in the hero for consultants.
export function AlertsToggle() {
  const { profile } = useAuth();
  const [on, setOn] = useState(profile?.job_alerts !== false);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    try {
      await api.post('/auth/job-alerts', { enabled: next });
      toast.success(next ? 'Daily job alerts on' : 'Daily job alerts off');
    } catch {
      setOn(!next);
      toast.error('Could not update alerts');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      className="inline-flex items-center gap-2 text-sm text-white/90 hover:text-white disabled:opacity-60"
      title="Email me new matching jobs daily"
    >
      <span
        className={clsx(
          'w-9 h-5 rounded-full p-0.5 transition-colors',
          on ? 'bg-white/90' : 'bg-white/25',
        )}
      >
        <span
          className={clsx(
            // Fixed dark knob: this toggle lives on the always-indigo hero with
            // an always-white track, so the knob must stay dark in both themes
            // (a token like bg-ink would invert to light and vanish).
            'block w-4 h-4 rounded-full bg-slate-900 transition-transform',
            on ? 'translate-x-4' : '',
          )}
        />
      </span>
      {on ? '🔔 Daily job alerts on' : '🔕 Daily job alerts off'}
    </button>
  );
}
