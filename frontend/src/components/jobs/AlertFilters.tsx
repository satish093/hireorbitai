import { useEffect, useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../Button';
import { SelectInput } from '../SelectInput';

// Daily job-alert controls for consultants: the master on/off (users.job_alerts
// via /auth/job-alerts) plus the criteria-based filters (user_job_alert_prefs
// via /auth/job-alert-prefs) that narrow WHAT the email contains. Self-contained
// token-styled card so it reads correctly on any surface (it lives on the
// consultant-reachable /my-resume page).

interface Prefs {
  keywords: string[];
  locations: string[];
  remote_only: boolean;
  min_match: number;
}
const DEFAULTS: Prefs = { keywords: [], locations: [], remote_only: false, min_match: 60 };

const MIN_MATCH_OPTIONS = [
  { value: '0', label: 'Any match' },
  { value: '50', label: '50%+ match' },
  { value: '60', label: '60%+ match' },
  { value: '70', label: '70%+ match' },
  { value: '80', label: '80%+ match' },
  { value: '90', label: '90%+ match' },
];

/** Comma/Enter-to-add chip editor. Caps + de-dupes are handled by the caller. */
function ChipInput({
  label,
  placeholder,
  values,
  onChange,
  max,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
  max: number;
}) {
  const [draft, setDraft] = useState('');
  function add() {
    const v = draft.trim();
    if (!v) return;
    if (values.length >= max) {
      toast.error(`Up to ${max} only`);
      return;
    }
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft('');
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  }
  return (
    <div>
      <span className="block text-xs font-medium text-ink mb-1.5">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2 py-1.5 min-h-8">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full bg-accent-soft text-accent text-[11px] px-2 py-0.5"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
              className="text-accent/70 hover:text-accent"
            >
              ✕
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={add}
          placeholder={values.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[90px] bg-transparent text-[13px] text-ink placeholder:text-muted focus:outline-none"
        />
      </div>
    </div>
  );
}

export function AlertFilters() {
  const { profile } = useAuth();
  const [enabled, setEnabled] = useState(profile?.job_alerts !== false);
  const [togglingMaster, setTogglingMaster] = useState(false);
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  async function toggleEnabled() {
    if (togglingMaster) return;
    const next = !enabled;
    setEnabled(next);
    setTogglingMaster(true);
    try {
      await api.post('/auth/job-alerts', { enabled: next });
      toast.success(next ? 'Daily job alerts on' : 'Daily job alerts off');
    } catch {
      setEnabled(!next);
      toast.error('Could not update alerts');
    } finally {
      setTogglingMaster(false);
    }
  }

  useEffect(() => {
    let alive = true;
    api
      .get('/auth/job-alert-prefs')
      .then(({ data }) => {
        if (!alive) return;
        setPrefs({
          keywords: Array.isArray(data?.keywords) ? data.keywords : [],
          locations: Array.isArray(data?.locations) ? data.locations : [],
          remote_only: !!data?.remote_only,
          min_match: typeof data?.min_match === 'number' ? data.min_match : 60,
        });
      })
      .catch(() => {
        /* fail-open: keep defaults */
      })
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await api.put('/auth/job-alert-prefs', prefs);
      toast.success('Alert filters saved');
      setOpen(false);
    } catch {
      toast.error('Could not save alert filters');
    } finally {
      setSaving(false);
    }
  }

  const summary = (() => {
    const parts: string[] = [];
    if (prefs.remote_only) parts.push('Remote only');
    if (prefs.locations.length) parts.push(prefs.locations.slice(0, 2).join(', '));
    if (prefs.keywords.length) parts.push(prefs.keywords.slice(0, 3).join(' · '));
    if (prefs.min_match > 0) parts.push(`≥${prefs.min_match}%`);
    return parts.length ? parts.join(' · ') : 'No filters — every strong match is emailed.';
  })();

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-ink">Daily job alerts</div>
          <div className="text-[12px] text-muted mt-0.5">
            {enabled
              ? loaded && !open
                ? summary
                : 'Get matched roles emailed to you each day.'
              : 'Turn on to get matched roles emailed to you each day.'}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {enabled && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen((o) => !o)}
              disabled={!loaded}
            >
              {open ? 'Close' : 'Customize'}
            </Button>
          )}
          <button
            onClick={toggleEnabled}
            disabled={togglingMaster}
            aria-pressed={enabled}
            aria-label="Toggle daily job alerts"
            title={enabled ? 'Daily job alerts on' : 'Daily job alerts off'}
            className="inline-flex items-center disabled:opacity-60"
          >
            <span
              className={clsx(
                'w-10 h-6 rounded-full p-0.5 transition-colors',
                enabled ? 'bg-accent' : 'bg-border-strong',
              )}
            >
              <span
                className={clsx(
                  'block w-5 h-5 rounded-full bg-white shadow transition-transform',
                  enabled ? 'translate-x-4' : '',
                )}
              />
            </span>
          </button>
        </div>
      </div>

      {enabled && open && (
        <div className="mt-3 space-y-3">
          <ChipInput
            label="Keywords (title / skills)"
            placeholder="e.g. React, Kubernetes — Enter to add"
            values={prefs.keywords}
            max={20}
            onChange={(keywords) => setPrefs((p) => ({ ...p, keywords }))}
          />
          <ChipInput
            label="Locations"
            placeholder="e.g. New York, Austin — Enter to add"
            values={prefs.locations}
            max={10}
            onChange={(locations) => setPrefs((p) => ({ ...p, locations }))}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <SelectInput
              label="Minimum match score"
              value={String(prefs.min_match)}
              options={MIN_MATCH_OPTIONS}
              onChange={(e) => setPrefs((p) => ({ ...p, min_match: Number(e.target.value) }))}
            />
            <label className="inline-flex items-center gap-2 text-[13px] text-ink h-8">
              <input
                type="checkbox"
                checked={prefs.remote_only}
                onChange={(e) => setPrefs((p) => ({ ...p, remote_only: e.target.checked }))}
                className="h-4 w-4 rounded border-border-strong text-accent focus:ring-accent"
              />
              Remote roles only
            </label>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={saving}>
              Save filters
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
