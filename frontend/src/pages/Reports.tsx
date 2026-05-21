import { useEffect, useState, ReactNode } from 'react';
import { Layout } from '../components/Layout';
import { DashboardCard } from '../components/DashboardCard';
import { Avatar } from '../components/TaskBits';
import { Modal } from '../components/Modal';
import { FormInput } from '../components/FormInput';
import { SelectInput } from '../components/SelectInput';
import { GroupBadge } from '../components/GroupBadge';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import clsx from 'clsx';

type Tab = 'recruiters' | 'consultants' | 'placement' | 'daily' | 'user-time';

interface UserTimeRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  group_id: string | null;
  last_seen_at: string | null;
  total_seconds: number;
  days_active: number;
  by_day: { date: string; active_seconds: number }[];
}

interface RecruiterRow {
  recruiter_id: string;
  name: string;
  email: string;
  team: string | null;
  target_per_week: number | null;
  group_id: string | null;
  active_consultants: number;
  placed_consultants: number;
  submissions: number;
  interviews: number;
  offers: number;
  rejections: number;
}

interface ConsultantRow {
  consultant_id: string;
  name: string;
  email: string;
  primary_skill: string | null;
  marketing_status: 'ACTIVE' | 'PAUSED' | 'PLACED';
  recruiter_name: string | null;
  recruiter_team: string | null;
  submissions: number;
  interviews_scheduled: number;
  interviews_completed: number;
  offers: number;
  rejections: number;
  last_activity_at: string | null;
}

interface PlacementSnapshot {
  funnel: {
    submissions: number;
    interviews: number;
    offers: number;
    placements: number;
    sub_to_interview: number;
    interview_to_offer: number;
    offer_to_placement: number;
    overall_placement_rate: number;
  };
  interviews: { scheduled: number; completed: number; completion_rate: number };
  applications_by_status: Record<string, number>;
  top_vendors: { vendor_id: string; name: string; submissions: number }[];
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'recruiters', label: 'Recruiter performance' },
  { key: 'consultants', label: 'Consultant pipeline' },
  { key: 'placement', label: 'Placement analytics' },
  { key: 'daily', label: 'Daily activity log' },
  { key: 'user-time', label: 'Time in app' },
];

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
];

const STATUS_TONE: Record<string, string> = {
  ACTIVE:
    'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/20',
  PAUSED:
    'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-100 dark:border-amber-500/20',
  PLACED:
    'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-500/20',
};

export function Reports() {
  const [tab, setTab] = useState<Tab>('recruiters');
  const [days, setDays] = useState('30');
  const [recruiters, setRecruiters] = useState<RecruiterRow[] | null>(null);
  const [consultants, setConsultants] = useState<ConsultantRow[] | null>(null);
  const [placement, setPlacement] = useState<PlacementSnapshot | null>(null);
  const [userTime, setUserTime] = useState<UserTimeRow[] | null>(null);

  // Clear caches AND refetch in a single effect keyed on (tab, days). Doing
  // the clear in a separate effect raced against the fetch (the fetch read the
  // previous, still-cached value before the clear committed) and could leave
  // stale data on screen.
  useEffect(() => {
    const controller = new AbortController();
    const opts = { signal: controller.signal };
    if (tab === 'recruiters') {
      setRecruiters(null);
      api
        .get('/reports/recruiter-performance', { params: { days }, ...opts })
        .then((r) => setRecruiters(r.data?.recruiters ?? []))
        .catch((e) => {
          if (e?.code !== 'ERR_CANCELED') toast.error(e?.response?.data?.error ?? 'Failed to load');
        });
    } else if (tab === 'consultants') {
      setConsultants(null);
      api
        .get('/reports/consultant-pipeline', { params: { days }, ...opts })
        .then((r) => setConsultants(r.data?.consultants ?? []))
        .catch((e) => {
          if (e?.code !== 'ERR_CANCELED') toast.error(e?.response?.data?.error ?? 'Failed to load');
        });
    } else if (tab === 'placement') {
      setPlacement(null);
      api
        .get('/reports/placement-analytics', { params: { days }, ...opts })
        .then((r) => setPlacement(r.data))
        .catch((e) => {
          if (e?.code !== 'ERR_CANCELED') toast.error(e?.response?.data?.error ?? 'Failed to load');
        });
    } else if (tab === 'user-time') {
      setUserTime(null);
      // Convert "Last N days" → from/to range using local-date YYYY-MM-DD,
      // not UTC, so users near day boundaries don't see "yesterday" picked.
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - (Number(days) - 1));
      const ymd = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      api
        .get('/reports/user-time', { params: { from: ymd(from), to: ymd(to) }, ...opts })
        .then((r) => setUserTime(r.data?.users ?? []))
        .catch((e) => {
          if (e?.code !== 'ERR_CANCELED')
            toast.error(e?.response?.data?.error ?? 'Failed to load time-in-app report');
        });
    }
    return () => controller.abort();
  }, [tab, days]);

  return (
    <Layout title="Reports">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Performance across recruiters, consultant pipeline, and placement analytics.
          </p>
        </div>
        <SelectInput
          label="Range"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          options={RANGE_OPTIONS}
        />
      </div>

      {/* Tab strip */}
      <div className="flex items-end gap-5 border-b border-border mb-5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'relative pb-2.5 -mb-px text-sm transition-colors whitespace-nowrap press',
              tab === t.key
                ? 'text-foreground font-semibold'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            <span
              aria-hidden="true"
              className={clsx(
                'absolute left-0 right-0 -bottom-px h-0.5 bg-foreground rounded-full origin-center transition-transform duration-200 ease-out',
                tab === t.key ? 'scale-x-100' : 'scale-x-0',
              )}
            />
          </button>
        ))}
      </div>

      {tab === 'recruiters' && <RecruiterPerformance rows={recruiters} />}
      {tab === 'consultants' && <ConsultantPipeline rows={consultants} />}
      {tab === 'placement' && <PlacementAnalytics data={placement} />}
      {tab === 'daily' && <DailyActivity />}
      {tab === 'user-time' && <UserTimeTable rows={userTime} />}
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Recruiter performance
// ---------------------------------------------------------------------------

function RecruiterPerformance({ rows }: { rows: RecruiterRow[] | null }) {
  if (rows === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <EmptyState label="No recruiters yet" />;

  const totals = rows.reduce(
    (a, r) => ({
      submissions: a.submissions + r.submissions,
      interviews: a.interviews + r.interviews,
      offers: a.offers + r.offers,
      placed: a.placed + r.placed_consultants,
    }),
    { submissions: 0, interviews: 0, offers: 0, placed: 0 },
  );

  const maxSubs = Math.max(1, ...rows.map((r) => r.submissions));

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <DashboardCard label="Total submissions" value={totals.submissions} accent="slate" />
        <DashboardCard label="Interviews" value={totals.interviews} accent="blue" />
        <DashboardCard label="Offers" value={totals.offers} accent="amber" />
        <DashboardCard label="Placements" value={totals.placed} accent="green" />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
            <tr>
              <th className="text-left px-3 py-2">Recruiter</th>
              <th className="text-left px-3 py-2">Team</th>
              <th className="text-right px-3 py-2">Active</th>
              <th className="text-right px-3 py-2">Placed</th>
              <th className="px-3 py-2">Submissions</th>
              <th className="text-right px-3 py-2">Interviews</th>
              <th className="text-right px-3 py-2">Offers</th>
              <th className="text-right px-3 py-2">Rejections</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.recruiter_id} className="border-t border-border hover:bg-muted">
                <td className="px-3 py-2.5">
                  <div className="inline-flex items-center gap-2">
                    <Avatar name={r.name} email={r.email} size={26} />
                    <div className="leading-tight">
                      <div className="font-medium text-foreground inline-flex items-center gap-1.5">
                        {r.name}
                        <GroupBadge groupId={r.group_id} compact hideEmpty />
                      </div>
                      {r.target_per_week ? (
                        <div className="text-[11px] text-muted-foreground">
                          {r.target_per_week}/wk target
                        </div>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-foreground">{r.team ?? '—'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.active_consultants}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-300">
                  {r.placed_consultants}
                </td>
                <td className="px-3 py-2.5">
                  <BarCell value={r.submissions} max={maxSubs} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.interviews}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-amber-700 dark:text-amber-300">
                  {r.offers}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {r.rejections}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BarCell({ value, max }: { value: number; max: number }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2 w-44">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm tabular-nums w-8 text-right">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Consultant pipeline
// ---------------------------------------------------------------------------

function ConsultantPipeline({ rows }: { rows: ConsultantRow[] | null }) {
  if (rows === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <EmptyState label="No consultants yet" />;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
          <tr>
            <th className="text-left px-3 py-2">Consultant</th>
            <th className="text-left px-3 py-2">Recruiter</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-right px-3 py-2">Subs</th>
            <th className="text-right px-3 py-2">Interviews</th>
            <th className="text-right px-3 py-2">Completed</th>
            <th className="text-right px-3 py-2">Offers</th>
            <th className="text-right px-3 py-2">Last activity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.consultant_id} className="border-t border-border hover:bg-muted">
              <td className="px-3 py-2.5">
                <div className="inline-flex items-center gap-2">
                  <Avatar name={c.name} email={c.email} size={26} />
                  <div className="leading-tight">
                    <div className="font-medium text-foreground">{c.name}</div>
                    {c.primary_skill && (
                      <div className="text-[11px] text-muted-foreground">{c.primary_skill}</div>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5 text-foreground">
                {c.recruiter_name ?? (
                  <span className="italic text-muted-foreground">Unassigned</span>
                )}
              </td>
              <td className="px-3 py-2.5">
                <span
                  className={clsx(
                    'text-[11px] font-medium px-2 py-0.5 rounded-full border',
                    STATUS_TONE[c.marketing_status],
                  )}
                >
                  {c.marketing_status}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{c.submissions}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{c.interviews_scheduled}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-blue-700 dark:text-blue-300">
                {c.interviews_completed}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-300">
                {c.offers}
              </td>
              <td className="px-3 py-2.5 text-right text-muted-foreground text-xs">
                {c.last_activity_at ? new Date(c.last_activity_at).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placement analytics
// ---------------------------------------------------------------------------

function PlacementAnalytics({ data }: { data: PlacementSnapshot | null }) {
  if (data === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const f = data.funnel;
  const steps = [
    { label: 'Submissions', value: f.submissions, color: 'bg-muted-foreground' },
    { label: 'Interviews', value: f.interviews, color: 'bg-blue-500' },
    { label: 'Offers', value: f.offers, color: 'bg-amber-500' },
    { label: 'Placements', value: f.placements, color: 'bg-emerald-500' },
  ];
  const max = Math.max(1, ...steps.map((s) => s.value));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DashboardCard
          label="Sub → Interview"
          value={`${f.sub_to_interview}%`}
          accent="blue"
          hint={`${f.interviews} of ${f.submissions}`}
        />
        <DashboardCard
          label="Interview → Offer"
          value={`${f.interview_to_offer}%`}
          accent="amber"
          hint={`${f.offers} of ${f.interviews}`}
        />
        <DashboardCard
          label="Offer → Placed"
          value={`${f.offer_to_placement}%`}
          accent="green"
          hint={`${f.placements} of ${f.offers}`}
        />
        <DashboardCard
          label="Overall placement"
          value={`${f.overall_placement_rate}%`}
          accent="brand"
          hint={`${f.placements} of ${f.submissions}`}
        />
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-semibold text-foreground mb-3">Placement funnel</h3>
        <div className="space-y-3">
          {steps.map((s) => {
            const pct = Math.round((s.value / max) * 100);
            return (
              <div key={s.label}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-foreground">{s.label}</span>
                  <span className="font-semibold tabular-nums text-foreground">{s.value}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className={clsx('h-full', s.color)} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-1">Interview health</h3>
          <p className="text-xs text-muted-foreground mb-3">Scheduled vs. completed in window</p>
          <div className="text-3xl font-semibold tabular-nums text-foreground">
            {data.interviews.completion_rate}%
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {data.interviews.completed} completed of {data.interviews.scheduled} scheduled
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-3">Top vendors by submissions</h3>
          {data.top_vendors.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No vendor activity yet.</p>
          ) : (
            <div className="space-y-2">
              {data.top_vendors.map((v) => (
                <div key={v.vendor_id} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{v.name}</span>
                  <span className="tabular-nums font-semibold text-foreground">
                    {v.submissions}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-semibold text-foreground mb-3">Applications by status</h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          {Object.entries(data.applications_by_status).map(([k, v]) => (
            <div key={k} className="border border-border rounded-lg p-2 text-sm">
              <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{k}</div>
              <div className="font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily activity log (existing manual log, kept under its own tab)
// ---------------------------------------------------------------------------

function DailyActivity() {
  const [rows, setRows] = useState<any[]>([]);
  const [recruiters, setRecruiters] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    recruiter_id: '',
    activity_date: localYMD(new Date()),
    submissions_count: 0,
    interviews_scheduled: 0,
    interviews_completed: 0,
    vendor_calls: 0,
    offers: 0,
    placements: 0,
    notes: '',
  });

  function load() {
    api
      .get('/reports/daily')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load daily activity'));
  }
  useEffect(() => {
    load();
    api
      .get('/recruiters')
      .then((r) => setRecruiters(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load recruiters'));
  }, []);

  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving) return;
    if (!form.recruiter_id) {
      toast.error('Pick a recruiter');
      return;
    }
    setSaving(true);
    try {
      await api.post('/reports/daily', form);
      toast.success('Saved');
      setOpen(false);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const recruiterName = (id: string) => recruiters.find((r) => r.id === id)?.user?.full_name ?? id;

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setOpen(true)}
          className="bg-foreground text-background text-sm px-3 py-2 rounded-lg hover:opacity-90"
        >
          + Log activity
        </button>
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
            <tr>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-left px-3 py-2">Recruiter</th>
              <th className="text-right px-3 py-2">Subs</th>
              <th className="text-right px-3 py-2">Int. Sched</th>
              <th className="text-right px-3 py-2">Int. Done</th>
              <th className="text-right px-3 py-2">Vendor calls</th>
              <th className="text-right px-3 py-2">Offers</th>
              <th className="text-right px-3 py-2">Placements</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground italic">
                  No daily logs yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border hover:bg-muted">
                <td className="px-3 py-2.5">{r.activity_date}</td>
                <td className="px-3 py-2.5 text-foreground">{recruiterName(r.recruiter_id)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.submissions_count ?? 0}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.interviews_scheduled ?? 0}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.interviews_completed ?? 0}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.vendor_calls ?? 0}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.offers ?? 0}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.placements ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Log daily activity"
        footer={
          <button
            onClick={save}
            disabled={saving}
            className="bg-foreground text-background px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        }
      >
        <div className="space-y-3">
          <SelectInput
            label="Recruiter"
            placeholder="Select…"
            value={form.recruiter_id ?? ''}
            options={recruiters.map((r) => ({
              value: r.id,
              label: r.user?.full_name ?? r.user?.email ?? r.id,
            }))}
            onChange={(e) => setForm({ ...form, recruiter_id: e.target.value })}
          />
          <FormInput
            label="Date"
            type="date"
            value={form.activity_date}
            onChange={(e) => setForm({ ...form, activity_date: e.target.value })}
          />
          {/* Number inputs — passing `value` makes them controlled. The
              previous uncontrolled form left a gap between visible-empty
              and the actual numeric state, so submitting an "empty" field
              would silently send 0 / NaN. Now what you see is what you
              send. */}
          <div className="grid grid-cols-2 gap-3">
            <FormInput
              label="Submissions"
              type="number"
              min={0}
              value={form.submissions_count ?? 0}
              onChange={(e) =>
                setForm({
                  ...form,
                  submissions_count: e.target.value === '' ? 0 : Number(e.target.value),
                })
              }
            />
            <FormInput
              label="Interviews scheduled"
              type="number"
              min={0}
              value={form.interviews_scheduled ?? 0}
              onChange={(e) =>
                setForm({
                  ...form,
                  interviews_scheduled: e.target.value === '' ? 0 : Number(e.target.value),
                })
              }
            />
            <FormInput
              label="Interviews completed"
              type="number"
              min={0}
              value={form.interviews_completed ?? 0}
              onChange={(e) =>
                setForm({
                  ...form,
                  interviews_completed: e.target.value === '' ? 0 : Number(e.target.value),
                })
              }
            />
            <FormInput
              label="Vendor calls"
              type="number"
              min={0}
              value={form.vendor_calls ?? 0}
              onChange={(e) =>
                setForm({
                  ...form,
                  vendor_calls: e.target.value === '' ? 0 : Number(e.target.value),
                })
              }
            />
            <FormInput
              label="Offers"
              type="number"
              min={0}
              value={form.offers ?? 0}
              onChange={(e) =>
                setForm({ ...form, offers: e.target.value === '' ? 0 : Number(e.target.value) })
              }
            />
            <FormInput
              label="Placements"
              type="number"
              min={0}
              value={form.placements ?? 0}
              onChange={(e) =>
                setForm({ ...form, placements: e.target.value === '' ? 0 : Number(e.target.value) })
              }
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function EmptyState({ label }: { label: string; children?: ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time in app — per-user totals from the heartbeat-derived activity counter.
// Powered by /api/reports/user-time which reads user_activity_daily.
// ---------------------------------------------------------------------------
function UserTimeTable({ rows }: { rows: UserTimeRow[] | null }) {
  if (rows === null) return <EmptyState label="Loading…" />;
  if (rows.length === 0) {
    return (
      <EmptyState label="No activity recorded yet in this window. Sign in and click around — heartbeats are recorded every 30 seconds. If you've never seen data here, apply database/user-activity-tracking.sql to your database." />
    );
  }
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted border-b border-border">
            <tr className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              <th className="text-left px-4 py-2.5">User</th>
              <th className="text-left px-3 py-2.5">Role</th>
              <th className="text-right px-3 py-2.5">Time in app</th>
              <th className="text-right px-3 py-2.5">Days active</th>
              <th className="text-right px-3 py-2.5">Avg / day</th>
              <th className="text-left px-3 py-2.5">Last seen</th>
              <th className="text-left px-3 py-2.5">Activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const avg = r.days_active > 0 ? Math.round(r.total_seconds / r.days_active) : 0;
              const peak = Math.max(1, ...r.by_day.map((d) => d.active_seconds));
              return (
                <tr key={r.user_id} className="align-middle">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.full_name} email={r.email ?? undefined} size={28} />
                      <div className="leading-tight min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          {r.full_name ?? r.email ?? 'Unknown'}
                        </div>
                        {r.email && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            {r.email}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="inline-flex items-center gap-1.5">
                      {r.role && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide bg-muted text-foreground px-1.5 py-0.5 rounded">
                          {r.role}
                        </span>
                      )}
                      <GroupBadge groupId={r.group_id} compact hideEmpty />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-foreground">
                    {formatDuration(r.total_seconds)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                    {r.days_active}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                    {formatDuration(avg)}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {r.last_seen_at ? relativeTime(r.last_seen_at) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {/* Sparkline-style bars — width relative to per-row peak. */}
                    <div className="flex items-end gap-[1px] h-4">
                      {r.by_day.slice(-14).map((d) => (
                        <div
                          key={d.date}
                          className="w-1.5 bg-brand-500 rounded-sm"
                          style={{
                            height: `${Math.max(2, Math.round((d.active_seconds / peak) * 100))}%`,
                          }}
                          title={`${d.date}: ${formatDuration(d.active_seconds)}`}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

/** YYYY-MM-DD for the user's local date (not UTC). */
function localYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
