import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Avatar } from '../components/TaskBits';
import { ApplyInterceptModal, shouldShowApplyIntercept } from '../components/ApplyInterceptModal';
import { CustomizeResumeWizard } from '../components/CustomizeResumeWizard';
import { DuplicateSubmissionModal } from '../components/DuplicateSubmissionModal';
import { invalidate } from '../hooks/useInvalidate';
import { useFeatureFlag } from '../hooks/useFeatureFlags';
import { SkillGap } from '../components/SkillGap';
import toast from 'react-hot-toast';
import clsx from 'clsx';

type TabKey = 'recommended' | 'liked' | 'applied';

/** Applications pipeline (mirrors the database enum). */
type AppStatus =
  | 'SUBMITTED'
  | 'SCREENING'
  | 'INTERVIEW'
  | 'OFFER'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'ARCHIVED';

type AppliedSubTab = 'applied' | 'interviewing' | 'offer' | 'rejected' | 'archived';

const APPLIED_SUB_TABS: { key: AppliedSubTab; label: string; statuses: AppStatus[] }[] = [
  { key: 'applied', label: 'Applied', statuses: ['SUBMITTED', 'SCREENING'] },
  { key: 'interviewing', label: 'Interviewing', statuses: ['INTERVIEW'] },
  { key: 'offer', label: 'Offer Received', statuses: ['OFFER'] },
  { key: 'rejected', label: 'Rejected', statuses: ['REJECTED'] },
  { key: 'archived', label: 'Archived', statuses: ['ARCHIVED', 'WITHDRAWN'] },
];

/** Human-friendly labels for the status dropdown on each card. */
const STATUS_LABEL: Record<AppStatus, string> = {
  SUBMITTED: 'Applied',
  SCREENING: 'Applied',
  INTERVIEW: 'Interviewing',
  OFFER: 'Offer Received',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Archived',
  ARCHIVED: 'Archived',
};

function matchSubTab(status: string | undefined): AppliedSubTab {
  if (!status) return 'applied';
  for (const t of APPLIED_SUB_TABS) {
    if ((t.statuses as string[]).includes(status)) return t.key;
  }
  return 'applied';
}

interface JobRow {
  id: string;
  title: string;
  location?: string | null;
  remote?: boolean;
  job_type?: string | null;
  level?: string | null;
  rate_min?: number | null;
  rate_max?: number | null;
  description?: string | null;
  required_skills?: string[] | null;
  posted_at?: string | null;
  created_at: string;
  is_active?: boolean;
  client?: { id: string; company_name: string } | null;
  vendor?: { id: string; company_name: string } | null;
  liked?: boolean;
  match_score?: number | null;
  match_reasons?: string[];
  application_id?: string;
  application_status?: AppStatus | string;
  applied_at?: string;
  applied_method?: 'CUSTOMIZED' | 'ORIGINAL' | null;
  ats_score?: number | null;
  // Live ingestion fields
  source?: 'remoteok' | 'greenhouse' | 'lever' | 'adzuna' | null;
  external_id?: string | null;
  apply_url?: string | null;
  company_name?: string | null;
  publisher?: string | null;
  last_synced_at?: string | null;
  requirements?: {
    // Hard match signals
    must_haves?: string[];
    nice_to_haves?: string[];
    required_skills?: string[];
    min_years_of_experience?: number | null;
    job_seniority?: string | null;
    work_model?: string | null;
    work_authorization?: string[];
    location_requirements?: string | null;
    // Human-readable bullets
    core_responsibilities?: string[];
    skill_summaries?: string[];
    benefits_summaries?: string[];
    education_summaries?: string[];
    // Display chips
    highlights?: string[];
    recommendation_tags?: string[];
    // Legacy fields (back-compat)
    years_required?: number | null;
    level?: string | null;
  } | null;
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'recommended', label: 'Recommended' },
  { key: 'liked', label: 'Liked' },
  { key: 'applied', label: 'Applied' },
];

type ApplyTarget = {
  consultantId: string;
  consultantName: string;
  resumeId: string | null;
  skills: string[];
};

export function JobSearch() {
  const { profile } = useAuth();
  const isManager = profile?.role === 'SUPER_ADMIN' || profile?.role === 'MANAGER';
  const isConsultant = profile?.role === 'CONSULTANT';
  /** True for everyone who can apply on behalf of a consultant — recruiters
   *  and the manager tier all qualify. */
  const isRecruiterMode = !!profile && profile.role !== 'CONSULTANT';
  const [tab, setTab] = useState<TabKey>('recommended');
  const [rows, setRows] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [insightFor, setInsightFor] = useState<JobRow | null>(null);
  const [interceptFor, setInterceptFor] = useState<JobRow | null>(null);
  const [customizeFor, setCustomizeFor] = useState<JobRow | null>(null);
  const [confirmFor, setConfirmFor] = useState<{ job: JobRow; resumeId: string | null } | null>(
    null,
  );
  const [dupWarning, setDupWarning] = useState<{
    job: JobRow;
    consultantName: string;
    status: string;
    submittedAt: string | null;
  } | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  /** Recruiter-mode: who we're applying on behalf of. */
  const [target, setTarget] = useState<ApplyTarget | null>(null);
  /** Consultant-mode: their own consultant row + current resume so we can
   *  record applications and run the customize wizard. */
  const [myConsultantId, setMyConsultantId] = useState<string | null>(null);
  const [myResumeId, setMyResumeId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  // Default to US: most consultants on this platform are US-based, and
  // the backend treats this filter as "USA + remote" (remote roles are
  // US-eligible).
  const [location, setLocation] = useState('United States');
  const [remote, setRemote] = useState<'' | 'true' | 'false'>('');
  /** Stable values for the Posted pill: '' (any), or a day count like '1' / '7' / '30'.
   *  We convert to an ISO date at request time. Default to '1' (past 24 hours) to
   *  match Jobright's default and keep the feed fresh. */
  const [postedAfter, setPostedAfter] = useState<string>('1');
  const [yearsMin, setYearsMin] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [publisherFilter, setPublisherFilter] = useState<string>('');
  const [jobFunction, setJobFunction] = useState<string>('');
  const [appliedSub, setAppliedSub] = useState<AppliedSubTab>('applied');
  /** Diagnostic from the recommended endpoint — tells us whether scoring used
   *  a resume, skills only, or didn't run at all. */
  const [matchMode, setMatchMode] = useState<string | null>(null);

  // Load the consultant's profile (skills + consultant row id) and their
  // current resume id. Used by the recommended ranker AND the apply flow so
  // we can record applications + open the customize wizard.
  useEffect(() => {
    if (!isConsultant) return;
    (async () => {
      try {
        const r = await api.get('/consultants', { params: {} });
        const me = (r.data ?? [])[0];
        setSkills(Array.isArray(me?.skills) ? me.skills : []);
        if (me?.id) {
          setMyConsultantId(me.id);
          try {
            const rr = await api.get(`/resumes/consultant/${me.id}`);
            const current = (rr.data ?? []).find((x: any) => x.is_current) ?? (rr.data ?? [])[0];
            if (current?.id) setMyResumeId(current.id);
          } catch {
            /* no resume yet */
          }
        }
      } catch {
        /* silent — picker just starts empty */
      } finally {
        setSkillsLoaded(true);
      }
    })();
  }, [isConsultant]);

  async function saveSkills(next: string[]) {
    setSkills(next);
    try {
      await api.post('/consultants/onboard', { skills: next });
      toast.success('Skills saved — refresh recommendations to apply');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to save skills');
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const r = await api.post('/jobs/sync');
      const s = r.data;
      const reports: any[] = s.reports ?? [];
      const errs = reports.filter((rp) => rp.error);
      // Aggregate per source so the toast shows where the jobs came from.
      const bySource = new Map<
        string,
        { pulled: number; upserted: number; errors: number; rows: number }
      >();
      for (const rp of reports) {
        const cur = bySource.get(rp.source) ?? { pulled: 0, upserted: 0, errors: 0, rows: 0 };
        cur.pulled += rp.jobs_pulled ?? 0;
        cur.upserted += rp.jobs_upserted ?? 0;
        cur.rows += 1;
        if (rp.error) cur.errors += 1;
        bySource.set(rp.source, cur);
      }
      const breakdown = Array.from(bySource.entries())
        .sort((a, b) => b[1].pulled - a[1].pulled)
        .map(([src, v]) => `${src}: ${v.pulled}${v.errors ? ` (${v.errors} err)` : ''}`)
        .join(', ');
      toast.success(
        `Pulled ${s.jobs_pulled} jobs across ${bySource.size} drivers · ${s.new_jobs ?? 0} new` +
          (errs.length ? ` · ${errs.length} errors` : ''),
        { duration: 6000 },
      );
      if (errs.length > 0) {
        // Show one extra toast listing the failing sources so the user knows
        // which keys / configs are broken without opening the drawer.
        const failing = errs
          .slice(0, 3)
          .map((e) => `${e.source}${e.slug ? `/${e.slug}` : ''}: ${e.error?.slice(0, 100)}`)
          .join('\n');
        toast.error(
          `Failures:\n${failing}${errs.length > 3 ? `\n…and ${errs.length - 3} more` : ''}`,
          { duration: 10000 },
        );
      }
      // eslint-disable-next-line no-console
      console.info('[sync] breakdown:', breakdown, 'reports:', reports);
      await load(tab);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function enrichNow() {
    setSyncing(true);
    try {
      toast('Enriching jobs with AI… this may take a minute', { duration: 4000 });
      const r = await api.post('/jobs/enrich-pending', null, {
        params: { limit: 30, concurrency: 5 },
      });
      toast.success(`Enriched ${r.data.enriched} jobs (${r.data.failed} failed)`);
      await load(tab);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Enrichment failed');
    } finally {
      setSyncing(false);
    }
  }

  async function load(currentTab: TabKey = tab, signal?: AbortSignal) {
    setLoading(true);
    try {
      let url = '/jobs';
      if (currentTab === 'recommended') url = '/jobs/recommended';
      else if (currentTab === 'liked') url = '/jobs/liked';
      else if (currentTab === 'applied') url = '/jobs/applied';

      const params: Record<string, string> = {};
      // Filters only apply to the "Recommended" base feed in this simple version
      // (Liked/Applied are user-scoped lists).
      if (currentTab === 'recommended') {
        if (q) params.q = q;
        if (location) params.location = location;
        if (remote) params.remote = remote;
        if (postedAfter) params.posted_after = daysAgoISO(Number(postedAfter));
        if (yearsMin) params.years_min = yearsMin;
        if (publisherFilter) params.publisher = publisherFilter;
        if (jobFunction) params.job_function = jobFunction;
        // Recruiter mode: rank/score against the targeted consultant.
        if (target?.consultantId) params.consultant_id = target.consultantId;
      }
      // The Applied tab is consultant-scoped — pass through the targeted
      // consultant so recruiters can see what they've submitted on their behalf.
      if (currentTab === 'applied' && target?.consultantId) {
        params.consultant_id = target.consultantId;
      }
      const r = await api.get(url, { params, signal });
      if (signal?.aborted) return;
      setRows(r.data ?? []);
      // The recommended endpoint sets x-match-mode so the UI can explain why
      // a card has no score (e.g. resume not on file). Axios lowercases headers.
      const mode = r.headers?.['x-match-mode'];
      setMatchMode(typeof mode === 'string' ? mode : null);
    } catch (e: any) {
      if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return;
      toast.error(e?.response?.data?.error ?? 'Failed to load jobs');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  // Reload whenever the tab, the targeted consultant, OR any auto-apply filter
  // pill changes. Manual filters (`q`, `location`, `remote`, `yearsMin`,
  // `sourceFilter`) only fire on Apply click. Abort previous in-flight request
  // so a slow earlier load can't clobber a newer one.
  useEffect(() => {
    const controller = new AbortController();
    load(tab, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line
  }, [tab, target?.consultantId, postedAfter, publisherFilter, jobFunction]);

  /** Apply click — three modes:
   *   - Recruiter with a consultant targeted: open intercept (will route to wizard or plain apply).
   *   - Consultant viewing their own page: open intercept.
   *   - Anyone else / opt-out: open the apply URL directly.
   */
  async function handleApplyClick(job: JobRow) {
    const consultantId = isRecruiterMode ? target?.consultantId : myConsultantId;
    const name = isRecruiterMode ? target?.consultantName : 'You';

    // Duplicate-submission warning — works in both modes.
    if (consultantId) {
      try {
        const r = await api.get(`/jobs/${job.id}/duplicate-check`, {
          params: { consultant_id: consultantId },
        });
        if (r.data?.duplicate) {
          setDupWarning({
            job,
            consultantName: name ?? 'This consultant',
            status: r.data.status ?? 'SUBMITTED',
            submittedAt: r.data.submitted_at ?? null,
          });
          return;
        }
      } catch {
        /* non-fatal */
      }
    }

    proceedToApply(job, consultantId);
  }

  function proceedToApply(job: JobRow, consultantId?: string | null) {
    if (isRecruiterMode && consultantId) {
      setInterceptFor(job);
      return;
    }
    if (isConsultant && shouldShowApplyIntercept()) {
      setInterceptFor(job);
    } else {
      window.open(resolveApplyUrl(job), '_blank', 'noopener,noreferrer');
    }
  }

  /** "Apply Without Customizing" — open the company site, then ask "Did you
   *  apply?" so we can record the application. Works for both modes:
   *   - Recruiter mode: requires a targeted consultant.
   *   - Consultant mode: uses their own consultant + current resume. */
  function handlePlainApply(job: JobRow) {
    setInterceptFor(null);
    const consultantId = isRecruiterMode ? target?.consultantId : myConsultantId;
    const resumeId = isRecruiterMode ? target?.resumeId : myResumeId;
    if (!consultantId) {
      // No target — open URL and bail, can't record without a consultant row.
      window.open(resolveApplyUrl(job), '_blank', 'noopener,noreferrer');
      return;
    }
    window.open(resolveApplyUrl(job), '_blank', 'noopener,noreferrer');
    setConfirmFor({ job, resumeId: resumeId ?? null });
  }

  async function recordApplication(p: {
    job: JobRow;
    method: 'CUSTOMIZED' | 'ORIGINAL';
    resumeId: string | null;
    tailoredResumeId: string | null;
    matchScore: number | null;
    atsScore: number | null;
  }) {
    // Either the recruiter has targeted someone, or the consultant is recording
    // their own submission. Without either we can't write the row.
    const consultantId = isRecruiterMode ? target?.consultantId : myConsultantId;
    if (!consultantId) {
      toast.error(
        isRecruiterMode
          ? 'No consultant selected — pick one in the targeting bar first'
          : 'Your consultant profile is missing; finish onboarding to record applications',
      );
      return;
    }
    try {
      await api.post('/applications/from-job', {
        job_id: p.job.id,
        consultant_id: consultantId,
        resume_id: p.resumeId,
        tailored_resume_id: p.tailoredResumeId,
        method: p.method,
        match_score: p.matchScore,
        ats_score: p.atsScore,
        source_url: p.job.apply_url,
      });
      toast.success('Application recorded');
      // Always refresh the current tab — the recommended endpoint excludes
      // already-applied jobs, so applying from Recommended should drop the
      // job from the visible list, not just appear in Applied later.
      load(tab);
      // Notify Applications.tsx, ManagerDashboard, Reports.
      invalidate('applications');
    } catch (e: any) {
      // Show the actual backend error message so we can fix the root cause
      // instead of a generic toast.
      const status = e?.response?.status;
      const msg = e?.response?.data?.error || e?.message || 'Unknown error';
      toast.error(`Record application failed (${status ?? 'no status'}): ${msg}`);
      // eslint-disable-next-line no-console
      console.error('[recordApplication]', e?.response?.data ?? e);
    }
  }

  async function toggleLike(job: JobRow) {
    // optimistic
    setRows((rs) => rs.map((r) => (r.id === job.id ? { ...r, liked: !r.liked } : r)));
    try {
      if (job.liked) await api.delete(`/jobs/${job.id}/like`);
      else await api.post(`/jobs/${job.id}/like`);
    } catch (e: any) {
      // revert
      setRows((rs) => rs.map((r) => (r.id === job.id ? { ...r, liked: job.liked } : r)));
      toast.error(e?.response?.data?.error ?? 'Failed to update like');
    }
  }

  return (
    <Layout title="Jobs" crumbs={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Jobs' }]}>
      {/* Tabs + search */}
      <div className="flex items-center gap-4 mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Jobs</h1>
        <nav className="flex items-end gap-5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                'pb-1.5 text-sm border-b-2 transition',
                tab === t.key
                  ? 'border-slate-900 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative w-72">
            <input
              type="text"
              placeholder="Search by title or company"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') load();
              }}
              className="w-full bg-slate-50 border border-slate-200 rounded-full pl-9 pr-3 py-1.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
              ⌕
            </span>
          </div>
          {isManager && (
            <>
              <button
                onClick={() => setSourcesOpen(true)}
                className="border border-slate-200 bg-white rounded-full px-3 py-1.5 text-sm hover:bg-slate-50"
                title="Manage live job sources"
              >
                Sources
              </button>
              <button
                onClick={enrichNow}
                disabled={syncing}
                className="border border-brand-200 bg-brand-50 text-brand-700 rounded-full px-3 py-1.5 text-sm hover:bg-brand-100 disabled:opacity-50 inline-flex items-center gap-1.5"
                title="Run AI to extract requirements, seniority, work model, etc."
              >
                ✦ Enrich
              </button>
              <button
                onClick={syncNow}
                disabled={syncing}
                className="bg-slate-900 text-white rounded-full px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-1.5"
                title="Pull fresh jobs from all sources"
              >
                <span className={syncing ? 'inline-block animate-spin' : ''}>↻</span>
                {syncing ? 'Working…' : 'Sync now'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Recruiter targeting — pick a consultant + resume to apply on behalf of. */}
      {isRecruiterMode && tab === 'recommended' && (
        <RecruiterTargetingBar value={target} onChange={setTarget} />
      )}

      {/* Skills picker — consultants tune the recommender by adding their skills */}
      {isConsultant && skillsLoaded && tab === 'recommended' && (
        <SkillsPicker skills={skills} onChange={saveSkills} onRecompute={() => load()} />
      )}

      {/* Filter chips */}
      {tab === 'recommended' && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <PillSelect
            label="Location"
            value={location}
            placeholder="Anywhere"
            onChange={(v) => {
              setLocation(v);
            }}
            options={[
              { value: '', label: 'Anywhere' },
              { value: 'United States', label: 'United States' },
              { value: 'Remote', label: 'Remote' },
              { value: 'New York', label: 'New York' },
              { value: 'San Francisco', label: 'San Francisco' },
            ]}
          />
          <PillSelect
            label="Onsite"
            value={remote}
            onChange={(v) => setRemote(v as any)}
            options={[
              { value: '', label: 'Any' },
              { value: 'true', label: 'Remote' },
              { value: 'false', label: 'Onsite' },
            ]}
          />
          <PillSelect
            label="Posted"
            value={postedAfter}
            onChange={(v) => setPostedAfter(v)}
            options={[
              { value: '', label: 'Any time' },
              { value: '1', label: 'Past 24 hours' },
              { value: '7', label: 'Past week' },
              { value: '30', label: 'Past month' },
            ]}
          />
          <PillSelect
            label="Years"
            value={yearsMin}
            onChange={(v) => setYearsMin(v)}
            options={[
              { value: '', label: 'Any' },
              { value: '0', label: 'Entry (0+)' },
              { value: '3', label: 'Mid (3+)' },
              { value: '5', label: 'Senior (5+)' },
              { value: '8', label: 'Lead (8+)' },
            ]}
          />
          <PillSelect
            label="Job function"
            value={jobFunction}
            onChange={(v) => setJobFunction(v)}
            options={[
              { value: '', label: 'Any role' },
              { value: 'Software Engineer', label: 'Software Engineer' },
              { value: 'Java Engineer', label: 'Java Engineer' },
              { value: 'Frontend Engineer', label: 'Frontend Engineer' },
              { value: 'Backend Engineer', label: 'Backend Engineer' },
              { value: 'Full Stack Engineer', label: 'Full Stack' },
              { value: 'Data Engineer', label: 'Data Engineer' },
              { value: 'Data Scientist', label: 'Data Scientist' },
              { value: 'DevOps / SRE', label: 'DevOps / SRE' },
              { value: 'Cloud Engineer', label: 'Cloud Engineer' },
              { value: 'QA Engineer', label: 'QA Engineer' },
              { value: 'Salesforce Developer', label: 'Salesforce Developer' },
              { value: 'Business Analyst', label: 'Business Analyst' },
              { value: 'Project Manager', label: 'Project Manager' },
              { value: 'Product Manager', label: 'Product Manager' },
            ]}
          />
          <PillSelect
            label="Job board"
            value={publisherFilter}
            onChange={(v) => setPublisherFilter(v)}
            options={[
              { value: '', label: 'All boards' },
              { value: 'LinkedIn', label: 'LinkedIn' },
              { value: 'Dice', label: 'Dice' },
              { value: 'Monster', label: 'Monster' },
              { value: 'CareerBuilder', label: 'CareerBuilder' },
              { value: 'Indeed', label: 'Indeed' },
              { value: 'Glassdoor', label: 'Glassdoor' },
              { value: 'ZipRecruiter', label: 'ZipRecruiter' },
            ]}
          />
          <PillSelect
            label="Source"
            value={sourceFilter}
            onChange={(v) => setSourceFilter(v)}
            options={[
              { value: '', label: 'All sources' },
              { value: 'greenhouse', label: 'Greenhouse' },
              { value: 'lever', label: 'Lever' },
              { value: 'remoteok', label: 'RemoteOK' },
              { value: 'remotive', label: 'Remotive' },
              { value: 'arbeitnow', label: 'Arbeitnow' },
              { value: 'adzuna', label: 'Adzuna' },
              { value: 'jsearch', label: 'JSearch (Indeed / LinkedIn)' },
              { value: 'ashby', label: 'Ashby' },
              { value: 'jooble', label: 'Jooble' },
              { value: 'usajobs', label: 'USAJobs' },
              { value: 'serpapi', label: 'SerpAPI Google Jobs' },
              { value: 'searchapi', label: 'SearchApi.io Google Jobs' },
              { value: 'linkedin', label: 'LinkedIn (Fantastic Jobs)' },
              { value: 'monster', label: 'Monster (RapidAPI)' },
              { value: 'manual', label: 'Manual import' },
            ]}
          />
          <button
            onClick={() => load()}
            className="ml-1 bg-slate-900 text-white text-sm px-4 py-1.5 rounded-full hover:bg-slate-800"
          >
            Apply
          </button>
          <button
            onClick={() => {
              setQ('');
              setLocation('United States');
              setRemote('');
              setPostedAfter('1');
              setYearsMin('');
              setSourceFilter('');
              setPublisherFilter('');
              setJobFunction('');
            }}
            className="text-xs text-slate-500 hover:text-slate-900 ml-1"
          >
            Reset
          </button>
        </div>
      )}

      {/* Match-mode banner — explains missing scores. */}
      {!loading && tab === 'recommended' && matchMode === 'skills-only' && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 mb-3 text-xs text-amber-900 flex items-center gap-2">
          <span>⚠️</span>
          <span>
            <strong>No resume on file</strong> — match scores below are based on the curated skill
            list only. Upload a resume on{' '}
            <a className="underline" href="/resumes">
              Resumes
            </a>{' '}
            so we can rank against your actual experience.
          </span>
        </div>
      )}
      {!loading && tab === 'recommended' && matchMode === 'no-consultant' && isRecruiterMode && (
        <div className="bg-sky-50 border border-sky-100 rounded-xl px-4 py-2.5 mb-3 text-xs text-sky-900 flex items-center gap-2">
          <span>ℹ️</span>
          <span>Pick a consultant in the targeting bar to see resume-aware match scores.</span>
        </div>
      )}

      {/* Source breakdown stats */}
      {!loading && rows.length > 0 && tab === 'recommended' && (
        <SourceBreakdown
          rows={rows}
          active={sourceFilter}
          onClick={(s) => setSourceFilter(s === sourceFilter ? '' : s)}
        />
      )}

      {/* Applied sub-tabs — Jobright-style pipeline view. */}
      {tab === 'applied' && (
        <AppliedSubTabs rows={rows} active={appliedSub} onChange={setAppliedSub} />
      )}

      {/* Results — apply source filter (Recommended/Liked) and sub-tab filter (Applied). */}
      {(() => {
        const filtered = filteredRows(rows, tab, sourceFilter, appliedSub);
        if (loading) return <div className="text-sm text-slate-500">Loading…</div>;
        if (filtered.length === 0)
          return <EmptyState tab={tab} onSync={isManager ? syncNow : undefined} />;
        return (
          <div className="space-y-3">
            {filtered.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                isConsultant={isConsultant}
                onToggleLike={() => toggleLike(j)}
                onOpenInsight={() => setInsightFor(j)}
                onApply={() => handleApplyClick(j)}
                // Only supply the dropdown handler when this row IS an application
                // (the Applied tab). Recommended/Liked rows keep the Apply button.
                onChangeStatus={
                  j.application_id
                    ? async (next) => {
                        const appId = j.application_id;
                        if (!appId) return;
                        // Optimistic.
                        setRows((rs) =>
                          rs.map((r) => (r.id === j.id ? { ...r, application_status: next } : r)),
                        );
                        try {
                          await api.patch(`/applications/${appId}`, { status: next });
                          invalidate('applications');
                        } catch (e: any) {
                          toast.error(e?.response?.data?.error ?? 'Failed to update status');
                          // Roll back by reloading.
                          load(tab);
                        }
                      }
                    : undefined
                }
              />
            ))}
          </div>
        );
      })()}

      {sourcesOpen && (
        <SourcesDrawer onClose={() => setSourcesOpen(false)} onAfterSync={() => load(tab)} />
      )}
      {insightFor && <MatchInsightModal job={insightFor} onClose={() => setInsightFor(null)} />}
      {interceptFor && (
        <ApplyInterceptModal
          job={interceptFor}
          mySkills={isRecruiterMode ? (target?.skills ?? []) : skills}
          applyUrl={resolveApplyUrl(interceptFor)}
          onClose={() => setInterceptFor(null)}
          onCustomize={() => {
            const j = interceptFor;
            setInterceptFor(null);
            // Determine the customize context for either mode.
            const ctxConsultantId = isRecruiterMode ? target?.consultantId : myConsultantId;
            const ctxResumeId = isRecruiterMode ? target?.resumeId : myResumeId;
            if (ctxConsultantId && ctxResumeId) {
              setCustomizeFor(j);
            } else if (isRecruiterMode) {
              toast.error('Pick a consultant and resume first');
            } else if (!myResumeId) {
              // Consultant has no resume yet — fall back to read-only insight
              // so they can at least see the match analysis + paste resume text.
              toast('Upload a resume first to use Fix My Resume', { icon: 'ℹ️' });
              setInsightFor(j);
            } else {
              setInsightFor(j);
            }
          }}
          // Both modes go through the "Did you apply?" confirmation now.
          onApplyAnyway={() => handlePlainApply(interceptFor)}
        />
      )}
      {customizeFor &&
        (() => {
          const ctxConsultantId = isRecruiterMode ? target?.consultantId : myConsultantId;
          const ctxResumeId = isRecruiterMode ? target?.resumeId : myResumeId;
          const ctxSkills = isRecruiterMode ? (target?.skills ?? []) : skills;
          if (!ctxConsultantId || !ctxResumeId) return null;
          return (
            <CustomizeResumeWizard
              job={customizeFor}
              consultantId={ctxConsultantId}
              sourceResumeId={ctxResumeId}
              mySkills={ctxSkills}
              onClose={() => setCustomizeFor(null)}
              onApplied={(r) => {
                const job = customizeFor;
                setCustomizeFor(null);
                recordApplication({
                  job,
                  method: 'CUSTOMIZED',
                  resumeId: ctxResumeId,
                  tailoredResumeId: r.tailoredResumeId,
                  matchScore: r.matchScore,
                  atsScore: r.atsScore,
                });
              }}
            />
          );
        })()}
      {dupWarning && (
        <DuplicateSubmissionModal
          consultantName={dupWarning.consultantName}
          jobTitle={dupWarning.job.title}
          status={dupWarning.status}
          submittedAt={dupWarning.submittedAt}
          onCancel={() => setDupWarning(null)}
          onConfirm={() => {
            const job = dupWarning.job;
            const cid = isRecruiterMode ? target?.consultantId : myConsultantId;
            setDupWarning(null);
            proceedToApply(job, cid);
          }}
        />
      )}
      {confirmFor && (
        <ApplyConfirmModal
          job={confirmFor.job}
          onClose={() => setConfirmFor(null)}
          onConfirm={async (yes) => {
            const { job, resumeId } = confirmFor;
            setConfirmFor(null);
            const consultantId = isRecruiterMode ? target?.consultantId : myConsultantId;
            if (!yes) {
              // Log the funnel-exit even when no application is created so we can
              // see "viewed but did not apply" in reports later.
              try {
                await api.post('/applications/none/events', {
                  kind: 'apply_declined',
                  job_id: job.id,
                  consultant_id: consultantId ?? null,
                  payload: { reason: 'user_said_no' },
                });
              } catch {
                /* non-fatal */
              }
              return;
            }
            recordApplication({
              job,
              method: 'ORIGINAL',
              resumeId,
              tailoredResumeId: null,
              matchScore: typeof job.match_score === 'number' ? job.match_score : null,
              atsScore: null,
            });
          }}
        />
      )}
    </Layout>
  );
}

function PillSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 border border-slate-200 bg-white rounded-full pl-3 pr-1 py-1 text-sm text-slate-700 hover:bg-slate-50">
      <span className="text-slate-500">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-sm font-medium text-slate-900 outline-none pr-1"
      >
        {placeholder && !options.find((o) => o.value === '') && (
          <option value="">{placeholder}</option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyState({ tab, onSync }: { tab: TabKey; onSync?: () => void }) {
  const map: Record<TabKey, string> = {
    recommended: 'No jobs found yet. Pull fresh listings from your live sources to get started.',
    liked: "You haven't liked any jobs yet — tap the heart on a card to save it.",
    applied: "You haven't submitted to any jobs yet.",
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500">
      <div className="mb-3">{map[tab]}</div>
      {tab === 'recommended' && onSync && (
        <button
          onClick={onSync}
          className="bg-slate-900 text-white text-sm px-4 py-2 rounded-full hover:bg-slate-800 inline-flex items-center gap-1.5"
        >
          <span>↻</span> Sync jobs now
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function JobCard({
  job,
  isConsultant,
  onToggleLike,
  onOpenInsight,
  onApply,
  onChangeStatus,
}: {
  job: JobRow;
  isConsultant: boolean;
  onToggleLike: () => void;
  onOpenInsight: () => void;
  onApply: () => void;
  /** Optional — only supplied on the Applied tab when the row has an application_id. */
  onChangeStatus?: (next: AppStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // ai_match flag hides every AI match-score affordance (pill + circular
  // score in the expanded view). Default-allow on missing flag so older
  // installs keep showing the score.
  const aiMatchEnabled = useFeatureFlag('ai_match');
  const companyName =
    job.company_name ?? job.client?.company_name ?? job.vendor?.company_name ?? 'Confidential';
  const matchScore =
    aiMatchEnabled && typeof job.match_score === 'number' ? Math.round(job.match_score) : null;

  const reqs = job.requirements ?? {};
  const recTags = reqs.recommendation_tags ?? [];
  const authBullets = reqs.work_authorization ?? [];
  const highlights = reqs.highlights ?? [];
  const responsibilities = reqs.core_responsibilities ?? [];
  const skillSummaries = reqs.skill_summaries ?? [];
  const benefits = reqs.benefits_summaries ?? [];

  const minYears = reqs.min_years_of_experience ?? reqs.years_required ?? null;
  const seniority = reqs.job_seniority ?? reqs.level ?? job.level ?? null;
  const workModel = reqs.work_model ?? (job.remote ? 'Remote' : 'Onsite');
  const requiredSkills =
    (reqs.required_skills?.length ? reqs.required_skills : job.required_skills) ?? [];
  const enriched = !!job.requirements;

  return (
    <div className="bg-white border border-slate-200 rounded-xl flex overflow-hidden hover:border-slate-300 hover:shadow-sm transition">
      {/* Left: job content */}
      <div className="flex-1 p-5 min-w-0">
        <div className="flex items-start gap-3">
          <Avatar name={companyName} size={44} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs text-slate-500">
                {relative(job.posted_at ?? job.created_at)}
              </span>
              {isEarly(job.posted_at ?? job.created_at) && (
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">
                  Be an early applicant
                </span>
              )}
              {job.source && <SourceBadge source={job.source} />}
              {job.publisher && <PublisherBadge publisher={job.publisher} />}
              {aiMatchEnabled && typeof job.match_score === 'number' && (
                <span
                  className={clsx(
                    'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border',
                    job.match_score >= 85
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                      : job.match_score >= 70
                        ? 'bg-sky-50 text-sky-700 border-sky-100'
                        : job.match_score >= 50
                          ? 'bg-amber-50 text-amber-700 border-amber-100'
                          : 'bg-rose-50 text-rose-700 border-rose-100',
                  )}
                >
                  Match {Math.round(job.match_score)}%
                </span>
              )}
              {job.application_status && !onChangeStatus && (
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                  {STATUS_LABEL[job.application_status as AppStatus] ?? job.application_status}
                </span>
              )}
              {job.applied_method && (
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded">
                  {job.applied_method === 'CUSTOMIZED' ? '✦ Customized' : 'Original'}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onOpenInsight}
              className="text-left group"
              title="View full requirements + match insight"
            >
              <h3 className="text-lg font-semibold text-slate-900 leading-tight group-hover:text-brand-700 transition-colors">
                {job.title}
              </h3>
            </button>
            <div className="text-sm text-slate-600 mt-0.5">
              <span className="font-medium">{companyName}</span>
              {job.client && job.client.company_name !== companyName && (
                <span className="text-slate-400"> · {job.client.company_name}</span>
              )}
            </div>
          </div>
          <button
            onClick={onToggleLike}
            title={job.liked ? 'Unlike' : 'Like'}
            className={clsx(
              'shrink-0 w-9 h-9 rounded-full border flex items-center justify-center',
              job.liked
                ? 'bg-red-50 border-red-200 text-red-500'
                : 'bg-white border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200',
            )}
          >
            {job.liked ? '♥' : '♡'}
          </button>
        </div>

        {/* Meta strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-y-1.5 gap-x-6 mt-3 text-sm">
          <MetaItem icon="◎" label={job.location ?? 'Unknown location'} />
          <MetaItem icon="◷" label={prettyType(job.job_type)} />
          <MetaItem icon="$" label={prettyRate(job.rate_min, job.rate_max)} />
          <MetaItem icon="⌂" label={workModel} />
          <MetaItem icon="◯" label={seniority ?? '—'} />
          <MetaItem icon="⌛" label={minYears != null ? `${minYears}+ years exp` : '—'} />
        </div>

        {/* Recommendation tags (Jobright-style "H1B Sponsor Likely" etc.) */}
        {recTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {recTags.slice(0, 6).map((t) => (
              <RecommendationTag key={t} tag={t} />
            ))}
          </div>
        )}

        {/* Required skills tags */}
        {requiredSkills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {requiredSkills.slice(0, 8).map((s) => (
              <span
                key={s}
                className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700"
              >
                {s}
              </span>
            ))}
          </div>
        )}

        {/* Skill gap card — only when expanded; cheap deterministic call, no AI */}
        {expanded && (
          <div className="mt-4">
            <SkillGap jobId={job.id} />
          </div>
        )}

        {/* Expanded details — skill summaries + responsibilities */}
        {expanded && enriched && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-5">
            {responsibilities.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-1.5">
                  Core responsibilities
                </div>
                <ul className="space-y-1 text-sm text-slate-700">
                  {responsibilities.slice(0, 6).map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-slate-400">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {skillSummaries.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-1.5">
                  Skill requirements
                </div>
                <ul className="space-y-1 text-sm text-slate-700">
                  {skillSummaries.slice(0, 6).map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-slate-400">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {highlights.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-1.5">
                  Why it might fit
                </div>
                <ul className="space-y-1 text-sm text-slate-700">
                  {highlights.slice(0, 4).map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-sky-500">★</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {benefits.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-1.5">
                  Benefits
                </div>
                <ul className="space-y-1 text-sm text-slate-700">
                  {benefits.slice(0, 4).map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-emerald-500">+</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Applied-on caption (only on the Applied tab). */}
        {job.applied_at && (
          <div className="mt-3 text-xs text-slate-500">
            Applied on{' '}
            {new Date(job.applied_at).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </div>
        )}

        {/* Footer: Apply / Status + expand */}
        <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
          {onChangeStatus ? (
            <StatusDropdown current={job.application_status} onChange={onChangeStatus} />
          ) : (
            <button
              onClick={onApply}
              className="inline-flex items-center gap-1.5 bg-slate-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-slate-800"
            >
              Apply on company site <span>↗</span>
            </button>
          )}
          <div className="flex items-center gap-3">
            {isConsultant && (
              <button
                onClick={onOpenInsight}
                className="text-xs font-medium text-brand-700 bg-brand-50 border border-brand-200 px-3 py-1.5 rounded-full hover:bg-brand-100"
                title="Score your resume against this job's requirements"
              >
                ✦ Match Insight
              </button>
            )}
            {!enriched && (
              <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded">
                Not yet enriched
              </span>
            )}
            {enriched && (responsibilities.length > 0 || skillSummaries.length > 0) && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-xs text-slate-600 hover:text-slate-900"
              >
                {expanded ? 'Show less ▴' : 'Show details ▾'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Right: match panel — shown whenever we have a score (consultant
          viewing their own page, OR recruiter mode with a targeted consultant). */}
      {(isConsultant || typeof job.match_score === 'number') && (
        <button
          type="button"
          onClick={onOpenInsight}
          className="w-64 shrink-0 bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 flex flex-col text-left hover:from-slate-800 hover:to-slate-700 transition"
          title="Open match insight"
        >
          <div className="relative w-20 h-20 self-center mb-2">
            <CircularScore score={matchScore} />
          </div>
          <div className="text-center">
            <div className="text-[11px] font-semibold tracking-widest text-emerald-300 uppercase">
              {scoreLabel(matchScore)}
            </div>
          </div>
          <ul className="text-xs text-white/80 mt-3 space-y-1 leading-snug">
            {(job.match_reasons ?? []).slice(0, 3).map((r, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-emerald-300">✓</span>
                <span>{r}</span>
              </li>
            ))}
            {authBullets.slice(0, 2).map((w, i) => (
              <li key={`auth-${i}`} className="flex items-start gap-1.5">
                <span className="text-amber-300">•</span>
                <span>{w}</span>
              </li>
            ))}
            {highlights.slice(0, 1).map((h, i) => (
              <li key={`hl-${i}`} className="flex items-start gap-1.5">
                <span className="text-sky-300">★</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
          <span className="mt-auto pt-3 text-[11px] text-white/60 hover:text-white">
            View details →
          </span>
        </button>
      )}
    </div>
  );
}

function RecommendationTag({ tag }: { tag: string }) {
  // Color the tag based on what it implies.
  const t = tag.toLowerCase();
  const tone = /(no sponsor|no h1b)/.test(t)
    ? 'bg-red-50 text-red-700 border-red-100'
    : /(sponsor|h1b)/.test(t)
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
      : /(clearance|secret)/.test(t)
        ? 'bg-amber-50 text-amber-800 border-amber-100'
        : /(remote)/.test(t)
          ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
          : 'bg-slate-50 text-slate-700 border-slate-200';
  return (
    <span
      className={clsx(
        'text-[11px] font-medium px-2 py-0.5 rounded-full border inline-flex items-center gap-1',
        tone,
      )}
    >
      ✦ {tag}
    </span>
  );
}

function MetaItem({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-slate-600">
      <span className="text-slate-400">{icon}</span>
      <span className="truncate">{label}</span>
    </div>
  );
}

function MetaPill({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
      <span className="text-slate-400">{icon}</span>
      <span className="truncate text-xs">{label}</span>
    </div>
  );
}

function CircularScore({ score }: { score: number | null }) {
  const pct = score ?? 0;
  const r = 28;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const color =
    score == null
      ? '#475569'
      : score >= 90
        ? '#10b981'
        : score >= 75
          ? '#22d3ee'
          : score >= 50
            ? '#fbbf24'
            : '#f87171';
  return (
    // Outer wrapper holds the rotated SVG; the number sits on top as a
    // plain absolutely-positioned span so it's always upright + centered.
    <div className="relative w-full h-full">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="6" />
        {score != null && (
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={c}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="text-white font-bold leading-none tabular-nums"
          style={{ fontSize: '15px' }}
        >
          {score == null ? '—' : `${Math.round(score)}%`}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filteredRows(
  rows: JobRow[],
  tab: TabKey,
  sourceFilter: string,
  sub: AppliedSubTab,
): JobRow[] {
  let out = rows;
  if (sourceFilter) out = out.filter((j) => j.source === sourceFilter);
  if (tab === 'applied') {
    const def = APPLIED_SUB_TABS.find((t) => t.key === sub)!;
    out = out.filter((j) =>
      (def.statuses as string[]).includes(j.application_status ?? 'SUBMITTED'),
    );
  }
  return out;
}

function AppliedSubTabs({
  rows,
  active,
  onChange,
}: {
  rows: JobRow[];
  active: AppliedSubTab;
  onChange: (k: AppliedSubTab) => void;
}) {
  // Bucket once.
  const counts: Record<AppliedSubTab, number> = {
    applied: 0,
    interviewing: 0,
    offer: 0,
    rejected: 0,
    archived: 0,
  };
  for (const r of rows) counts[matchSubTab(r.application_status ?? 'SUBMITTED')]++;
  return (
    <div className="border-b border-slate-200 mb-5 flex items-center gap-4 flex-wrap">
      {APPLIED_SUB_TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            'pb-2 text-sm flex items-center gap-1.5 border-b-2 transition -mb-px',
            active === t.key
              ? 'border-slate-900 text-slate-900 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {t.label}
          <span
            className={clsx(
              'text-[10px] font-semibold tabular-nums rounded-full px-1.5 py-0.5',
              active === t.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600',
            )}
          >
            {counts[t.key]}
          </span>
        </button>
      ))}
    </div>
  );
}

function StatusDropdown({
  current,
  onChange,
}: {
  current: AppStatus | string | undefined;
  onChange: (next: AppStatus) => void;
}) {
  const status = (current ?? 'SUBMITTED') as AppStatus;
  const label = STATUS_LABEL[status] ?? status;
  const tone =
    status === 'OFFER'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : status === 'INTERVIEW'
        ? 'bg-sky-50 text-sky-700 border-sky-200'
        : status === 'REJECTED'
          ? 'bg-rose-50 text-rose-700 border-rose-200'
          : status === 'ARCHIVED' || status === 'WITHDRAWN'
            ? 'bg-slate-100 text-slate-600 border-slate-200'
            : 'bg-amber-50 text-amber-800 border-amber-200';
  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value as AppStatus)}
      className={clsx(
        'text-xs font-semibold border rounded-full px-2.5 py-1 outline-none focus:ring-2 focus:ring-brand-500/40',
        tone,
      )}
      aria-label="Application status"
    >
      <option value="SUBMITTED">Applied</option>
      <option value="SCREENING">Applied · Screening</option>
      <option value="INTERVIEW">Interviewing</option>
      <option value="OFFER">Offer Received</option>
      <option value="REJECTED">Rejected</option>
      <option value="ARCHIVED">Archived</option>
    </select>
  );
  // Note: select default-renders the option text — we render `label` only
  // as a fallback if browsers strip select styling.
  void label;
}

function daysAgoISO(d: number): string {
  return new Date(Date.now() - d * 24 * 3600 * 1000).toISOString();
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

function isEarly(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 24 * 3600 * 1000;
}

function prettyType(t?: string | null): string {
  if (!t) return 'Full-time';
  const map: Record<string, string> = {
    W2: 'W2',
    C2C: 'C2C',
    FTE: 'Full-time',
    '1099': '1099',
  };
  return map[t] ?? t;
}

function prettyRate(min?: number | null, max?: number | null): string {
  if (min == null && max == null) return 'Rate undisclosed';
  if (min != null && max != null) return `$${min}/hr – $${max}/hr`;
  return `$${min ?? max}/hr`;
}

function scoreLabel(score: number | null): string {
  if (score == null) return 'No match yet';
  if (score >= 90) return 'Strong match';
  if (score >= 75) return 'Good match';
  if (score >= 50) return 'Fair match';
  return 'Weak match';
}

// Reserved for future use — referenced via memo to avoid TS unused warnings.
void useMemo;

// Final apply-URL safety net: even if the server somehow stored an empty
// string, we'll synthesize a Google-for-jobs search so the button is usable.
function resolveApplyUrl(job: JobRow): string {
  const u = (job.apply_url ?? '').trim();
  if (u && /^https?:\/\//i.test(u)) return u;
  const company = job.company_name ?? job.client?.company_name ?? '';
  return (
    'https://www.google.com/search?ibp=htl;jobs&q=' + encodeURIComponent(`${job.title} ${company}`)
  );
}

// ---------------------------------------------------------------------------
// Skills picker — "Add skill" chip input. Saves to consultants.skills via the
// onboard endpoint; the next /jobs/recommended call uses it for ranking.
// ---------------------------------------------------------------------------
function SkillsPicker({
  skills,
  onChange,
  onRecompute,
}: {
  skills: string[];
  onChange: (next: string[]) => void;
  onRecompute: () => void;
}) {
  const [input, setInput] = useState('');

  function add() {
    const v = input.trim();
    if (!v) return;
    if (skills.some((s) => s.toLowerCase() === v.toLowerCase())) {
      setInput('');
      return;
    }
    onChange([...skills, v]);
    setInput('');
  }
  function remove(s: string) {
    onChange(skills.filter((x) => x !== s));
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 mb-3 flex items-center gap-2 flex-wrap">
      <span className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase">
        My skills
      </span>
      {skills.length === 0 && (
        <span className="text-xs text-slate-400 italic">
          Add skills (React, Java, AWS, Python…) to tune recommendations.
        </span>
      )}
      {skills.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1 bg-slate-100 text-slate-800 text-xs font-medium px-2 py-0.5 rounded-full"
        >
          {s}
          <button
            onClick={() => remove(s)}
            className="text-slate-400 hover:text-red-500 text-sm leading-none"
            title="Remove"
          >
            ×
          </button>
        </span>
      ))}
      <div className="flex items-center gap-1.5 ml-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          placeholder="Add skill…"
          className="text-xs bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
        <button
          onClick={add}
          className="text-xs bg-slate-900 text-white px-2.5 py-1 rounded-full hover:bg-slate-800"
        >
          +
        </button>
        <button
          onClick={onRecompute}
          className="text-xs text-slate-600 hover:text-slate-900 ml-1"
          title="Re-run AI ranking with these skills"
        >
          Recompute ⟳
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match Insight modal — per-skill resume↔requirement scoring + overall ATS.
// Jobright-style "Resume Insight": opens from clicking the score panel or
// the "Match Insight" pill. Auto-enriches the job first (so we have skills).
// ---------------------------------------------------------------------------
interface SkillMatchResp {
  per_skill: { skill: string; score: number; evidence: string | null }[];
  overall_score: number;
  rank_desc: string;
  feature_scores: { seniority_match: number; skill_match: number; industry_match: number };
  rationale: string[];
}
interface AtsResp {
  score: number;
  matched_keywords: string[];
  missing_keywords: string[];
  summary: string;
}

function MatchInsightModal({ job, onClose }: { job: JobRow; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skillMatch, setSkillMatch] = useState<SkillMatchResp | null>(null);
  const [ats, setAts] = useState<AtsResp | null>(null);
  const [resumePaste, setResumePaste] = useState('');
  const [needsResume, setNeedsResume] = useState(false);

  async function run(extraResumeText?: string) {
    setLoading(true);
    setError(null);
    try {
      // Ask the backend to score the calling consultant's saved resume against
      // the job. Backend either pulls from resumes.ai_feedback.resume_text or
      // accepts a pasted version via the request body.
      const body: any = {};
      if (extraResumeText) body.resume_text = extraResumeText;
      const r = await api.post(`/jobs/${job.id}/skill-match-for-me`, body);
      setSkillMatch(r.data);
      setNeedsResume(false);

      if (extraResumeText) {
        try {
          const a = await api.post(`/jobs/${job.id}/ats-match`, { resume_text: extraResumeText });
          setAts(a.data);
        } catch {
          /* ATS is best-effort */
        }
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? 'Failed to score match';
      if (/no resume text/i.test(msg)) {
        setNeedsResume(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run(); /* eslint-disable-next-line */
  }, [job.id]);

  const company = job.company_name ?? job.client?.company_name ?? 'Unknown';
  const overall = skillMatch?.overall_score != null ? Math.round(skillMatch.overall_score) : null;
  const atsScore = ats?.score != null ? Math.round(ats.score) : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-0.5">
              Match Insight
            </div>
            <h2 className="text-lg font-semibold text-slate-900 leading-tight">{job.title}</h2>
            <div className="text-sm text-slate-600">
              {company} · {job.location ?? 'Unknown'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Quick-facts meta strip — mirrors what the card shows so the modal
              functions as a full job-detail view, not just a score breakdown. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <MetaPill icon="◎" label={job.location ?? 'Unknown location'} />
            <MetaPill icon="⌂" label={job.remote ? 'Remote' : 'Onsite'} />
            <MetaPill icon="◷" label={prettyType(job.job_type)} />
            <MetaPill icon="$" label={prettyRate(job.rate_min, job.rate_max)} />
          </div>

          {/* Recommendation tags (visa, clearance, etc.) */}
          {(job.requirements?.recommendation_tags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(job.requirements?.recommendation_tags ?? []).slice(0, 8).map((t) => (
                <RecommendationTag key={t} tag={t} />
              ))}
            </div>
          )}

          {/* Required skills chips */}
          {(() => {
            const skills =
              (job.requirements?.required_skills?.length
                ? job.requirements.required_skills
                : job.required_skills) ?? [];
            return skills.length > 0 ? (
              <div>
                <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-1.5">
                  Required skills
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((s) => (
                    <span
                      key={s}
                      className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ) : null;
          })()}

          {/* Full JD body */}
          {job.description && (
            <div>
              <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-1.5">
                Job description
              </div>
              <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-4 max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {job.description}
              </div>
            </div>
          )}

          {loading && <div className="text-sm text-slate-500">Scoring against your resume…</div>}

          {error && !loading && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
              {error}
            </div>
          )}

          {needsResume && !loading && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="text-sm font-semibold text-amber-900 mb-1">No resume on file yet</div>
              <p className="text-xs text-amber-800 mb-2">
                Upload a resume on the Resumes page, or paste the text below to score this job now.
              </p>
              <textarea
                rows={6}
                value={resumePaste}
                onChange={(e) => setResumePaste(e.target.value)}
                placeholder="Paste your resume here…"
                className="w-full text-xs border border-amber-200 rounded p-2 focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
              <button
                onClick={() => run(resumePaste)}
                disabled={!resumePaste.trim()}
                className="mt-2 bg-slate-900 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-slate-800 disabled:opacity-50"
              >
                Score this resume
              </button>
            </div>
          )}

          {skillMatch && !loading && (
            <>
              {/* Header scorecards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <ScoreCard
                  label="Overall match"
                  value={overall}
                  suffix="%"
                  tone="primary"
                  sub={skillMatch.rank_desc}
                />
                <ScoreCard
                  label="Skill match"
                  value={Math.round((skillMatch.feature_scores?.skill_match ?? 0) * 100)}
                  suffix="%"
                  tone="info"
                  sub={`${skillMatch.per_skill.length} skills evaluated`}
                />
                <ScoreCard
                  label="Seniority fit"
                  value={Math.round((skillMatch.feature_scores?.seniority_match ?? 0) * 100)}
                  suffix="%"
                  tone="ok"
                  sub="years vs requirement"
                />
              </div>

              {atsScore != null && (
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase">
                      ATS score
                    </span>
                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                      {atsScore}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded overflow-hidden mb-2">
                    <div className="h-full bg-emerald-500" style={{ width: `${atsScore}%` }} />
                  </div>
                  {ats && <p className="text-xs text-slate-700">{ats.summary}</p>}
                  {ats?.missing_keywords && ats.missing_keywords.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-1">
                        Missing keywords
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {ats.missing_keywords.slice(0, 16).map((k) => (
                          <span
                            key={k}
                            className="text-[11px] bg-red-50 text-red-700 border border-red-100 px-2 py-0.5 rounded-full"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Rationale */}
              {skillMatch.rationale?.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-1.5">
                    Why this score
                  </div>
                  <ul className="space-y-1 text-sm text-slate-700">
                    {skillMatch.rationale.map((r, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-slate-400">•</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Per-skill table */}
              {skillMatch.per_skill.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-1.5">
                    Skill-by-skill
                  </div>
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {skillMatch.per_skill.map((s) => {
                      const pct = Math.round((s.score ?? 0) * 100);
                      const tone =
                        pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
                      return (
                        <div key={s.skill} className="p-3 flex items-center gap-3">
                          <div className="w-40 shrink-0 text-sm font-medium text-slate-900 truncate">
                            {s.skill}
                          </div>
                          <div className="flex-1 h-1.5 bg-slate-100 rounded overflow-hidden">
                            <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="w-12 text-right text-xs tabular-nums font-semibold text-slate-700">
                            {pct}%
                          </div>
                          {s.evidence && (
                            <div
                              className="hidden lg:block flex-1 text-[11px] text-slate-500 italic truncate"
                              title={s.evidence}
                            >
                              “{s.evidence}”
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            Resume scored against this job's extracted requirements.
          </span>
          <a
            href={resolveApplyUrl(job)}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-slate-900 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-slate-800 inline-flex items-center gap-1.5"
          >
            Apply on company site <span>↗</span>
          </a>
        </div>
      </div>
    </div>
  );
}

function ScoreCard({
  label,
  value,
  suffix = '',
  tone,
  sub,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  tone: 'primary' | 'info' | 'ok';
  sub?: string;
}) {
  const toneClass =
    tone === 'primary'
      ? 'from-brand-50 to-white border-brand-100 text-brand-700'
      : tone === 'info'
        ? 'from-sky-50 to-white border-sky-100 text-sky-700'
        : 'from-emerald-50 to-white border-emerald-100 text-emerald-700';
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${toneClass} p-4`}>
      <div className="text-[10px] font-semibold tracking-widest uppercase mb-1 opacity-80">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums text-slate-900">
        {value == null ? '—' : `${value}${suffix}`}
      </div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source badge + Sources drawer
// ---------------------------------------------------------------------------

const SOURCE_TONE: Record<string, string> = {
  remoteok: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  greenhouse: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  lever: 'bg-purple-50 text-purple-700 border-purple-100',
  adzuna: 'bg-orange-50 text-orange-700 border-orange-100',
  remotive: 'bg-sky-50 text-sky-700 border-sky-100',
  arbeitnow: 'bg-amber-50 text-amber-800 border-amber-100',
  jsearch: 'bg-rose-50 text-rose-700 border-rose-100',
  ashby: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100',
  jooble: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  usajobs: 'bg-blue-50 text-blue-700 border-blue-100',
  serpapi: 'bg-yellow-50 text-yellow-800 border-yellow-100',
  searchapi: 'bg-violet-50 text-violet-700 border-violet-100',
  linkedin: 'bg-sky-100 text-sky-800 border-sky-200',
  monster: 'bg-violet-100 text-violet-800 border-violet-200',
  manual: 'bg-slate-100 text-slate-700 border-slate-200',
};
const SOURCE_LABEL: Record<string, string> = {
  remoteok: 'RemoteOK',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  adzuna: 'Adzuna',
  remotive: 'Remotive',
  arbeitnow: 'Arbeitnow',
  jsearch: 'JSearch (Indeed / LinkedIn)',
  ashby: 'Ashby',
  jooble: 'Jooble',
  usajobs: 'USAJobs',
  serpapi: 'SerpAPI Google Jobs',
  searchapi: 'SearchApi.io Google Jobs',
  linkedin: 'LinkedIn',
  monster: 'Monster',
  manual: 'Manual',
};

function SourceBreakdown({
  rows,
  active,
  onClick,
}: {
  rows: JobRow[];
  active: string;
  onClick: (s: string) => void;
}) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.source) continue;
    counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const ordered = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 mb-4 flex items-center gap-2 flex-wrap">
      <span className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase">
        By source
      </span>
      {ordered.map(([source, n]) => (
        <button
          key={source}
          onClick={() => onClick(source)}
          className={clsx(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition',
            active === source
              ? 'bg-slate-900 text-white border-slate-900'
              : (SOURCE_TONE[source] ?? 'bg-slate-100 text-slate-700 border-slate-200') +
                  ' hover:opacity-80',
          )}
        >
          <span className="font-medium">{SOURCE_LABEL[source] ?? source}</span>
          <span className="tabular-nums opacity-90">{n}</span>
        </button>
      ))}
      <span className="ml-auto text-xs text-slate-500 tabular-nums">{rows.length} total</span>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const tone = SOURCE_TONE[source] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span
      className={clsx(
        'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border',
        tone,
      )}
    >
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}

// Publisher = the user-facing job board (LinkedIn, Dice, Monster, …).
// Distinct from `source`, which is the ingestion driver (e.g. JSearch).
const PUBLISHER_TONE: Record<string, string> = {
  LinkedIn: 'bg-sky-50 text-sky-700 border-sky-100',
  Dice: 'bg-red-50 text-red-700 border-red-100',
  Monster: 'bg-violet-50 text-violet-700 border-violet-100',
  CareerBuilder: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  Indeed: 'bg-blue-50 text-blue-700 border-blue-100',
  Glassdoor: 'bg-teal-50 text-teal-700 border-teal-100',
  ZipRecruiter: 'bg-orange-50 text-orange-700 border-orange-100',
};
// ---------------------------------------------------------------------------
// Recruiter targeting bar — pick a consultant + resume to apply on behalf of.
// ---------------------------------------------------------------------------
interface ConsultantOption {
  id: string;
  user_id: string;
  primary_skill?: string | null;
  skills?: string[] | null;
  user?: { id: string; full_name: string | null; email: string } | null;
}
interface ResumeOption {
  id: string;
  version: number;
  file_name: string;
  is_current: boolean;
  ai_score?: number | null;
}
function RecruiterTargetingBar({
  value,
  onChange,
}: {
  value: ApplyTarget | null;
  onChange: (next: ApplyTarget | null) => void;
}) {
  const [consultants, setConsultants] = useState<ConsultantOption[]>([]);
  const [resumes, setResumes] = useState<ResumeOption[]>([]);

  useEffect(() => {
    api
      .get('/consultants', { params: {} })
      .then((r) => setConsultants(r.data ?? []))
      .catch(() => {
        /* silent */
      });
  }, []);

  useEffect(() => {
    if (!value?.consultantId) {
      setResumes([]);
      return;
    }
    api
      .get(`/resumes/consultant/${value.consultantId}`)
      .then((r) => {
        const list = (r.data ?? []) as ResumeOption[];
        setResumes(list);
        // Auto-pick current resume if none chosen yet.
        if (!value.resumeId) {
          const current = list.find((x) => x.is_current) ?? list[0];
          if (current) onChange({ ...value, resumeId: current.id });
        }
      })
      .catch(() => {
        setResumes([]);
      });
    // eslint-disable-next-line
  }, [value?.consultantId]);

  function pickConsultant(c: ConsultantOption | null) {
    if (!c) {
      onChange(null);
      return;
    }
    const skills =
      Array.isArray(c.skills) && c.skills.length > 0
        ? c.skills
        : c.primary_skill
          ? c.primary_skill
              .split(/[,;|/]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
    onChange({
      consultantId: c.id,
      consultantName: c.user?.full_name ?? c.user?.email ?? 'Consultant',
      resumeId: null,
      skills,
    });
  }
  function pickResume(rid: string) {
    if (!value) return;
    onChange({ ...value, resumeId: rid });
  }

  return (
    <div className="bg-brand-50 border border-brand-100 rounded-xl px-4 py-3 mb-3 flex items-center gap-3 flex-wrap">
      <span className="text-[10px] font-semibold tracking-widest text-brand-700 uppercase">
        Apply on behalf of
      </span>
      <select
        value={value?.consultantId ?? ''}
        onChange={(e) => {
          const c = consultants.find((x) => x.id === e.target.value) ?? null;
          pickConsultant(c);
        }}
        className="text-sm bg-white border border-slate-200 rounded-md px-2 py-1 min-w-[200px]"
      >
        <option value="">— Select consultant —</option>
        {consultants.map((c) => (
          <option key={c.id} value={c.id}>
            {c.user?.full_name ?? c.user?.email ?? 'Unnamed'}
          </option>
        ))}
      </select>

      {value && (
        <>
          <select
            value={value.resumeId ?? ''}
            onChange={(e) => pickResume(e.target.value)}
            className="text-sm bg-white border border-slate-200 rounded-md px-2 py-1 min-w-[180px]"
          >
            <option value="">— Select resume —</option>
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>
                v{r.version} · {r.file_name}
                {r.is_current ? ' (current)' : ''}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-600">
            {value.skills.length} skill{value.skills.length === 1 ? '' : 's'} on file
          </span>
          <button
            onClick={() => pickConsultant(null)}
            className="ml-auto text-xs text-slate-500 hover:text-slate-900"
          >
            Clear ×
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Did you apply?" confirmation modal — fires after Apply-Without-Customizing
// in recruiter mode so we can record the application.
// ---------------------------------------------------------------------------
function ApplyConfirmModal({
  job,
  onClose,
  onConfirm,
}: {
  job: JobRow;
  onClose: () => void;
  onConfirm: (yes: boolean) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-900 mb-1">Did you apply?</h2>
        <p className="text-sm text-slate-600 mb-4">
          We just opened the apply page for <strong>{job.title}</strong>
          {job.company_name ? (
            <>
              {' '}
              at <strong>{job.company_name}</strong>
            </>
          ) : null}
          . Confirm Yes to record this submission against the consultant.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => onConfirm(false)}
            className="border border-slate-200 text-slate-700 text-sm px-4 py-2 rounded-lg hover:bg-slate-50"
          >
            No, not yet
          </button>
          <button
            onClick={() => onConfirm(true)}
            className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            Yes, applied
          </button>
        </div>
      </div>
    </div>
  );
}

function PublisherBadge({ publisher }: { publisher: string }) {
  const tone = PUBLISHER_TONE[publisher] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span
      className={clsx(
        'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border',
        tone,
      )}
    >
      {publisher}
    </span>
  );
}

interface SourceCompany {
  id: string;
  source: 'remoteok' | 'greenhouse' | 'lever' | 'adzuna' | 'remotive' | 'arbeitnow';
  slug: string | null;
  display_name: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_jobs_count: number | null;
  last_sync_error: string | null;
}

interface SourceHealth {
  source: string;
  key_configured: boolean;
  needs_key: boolean;
  needs_slug: boolean;
  rows_total: number;
  rows_active: number;
  last_synced_at: string | null;
  last_sync_jobs_count: number;
  last_error: string | null;
  status: 'ok' | 'error' | 'missing_key' | 'no_rows';
}

function SourcesDrawer({ onClose, onAfterSync }: { onClose: () => void; onAfterSync: () => void }) {
  const [rows, setRows] = useState<SourceCompany[]>([]);
  const [health, setHealth] = useState<SourceHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSource, setNewSource] = useState<
    | 'greenhouse'
    | 'lever'
    | 'remoteok'
    | 'adzuna'
    | 'remotive'
    | 'arbeitnow'
    | 'jsearch'
    | 'ashby'
    | 'jooble'
    | 'usajobs'
    | 'serpapi'
    | 'searchapi'
    | 'linkedin'
    | 'monster'
  >('greenhouse');
  const [newSlug, setNewSlug] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [r, h] = await Promise.all([
        api.get('/jobs/sources'),
        api.get('/jobs/sources/health').catch(() => ({ data: [] })),
      ]);
      setRows(r.data ?? []);
      setHealth(h.data ?? []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function add() {
    if ((newSource === 'greenhouse' || newSource === 'lever') && !newSlug.trim()) {
      toast.error(`${newSource} needs a company slug (e.g. "stripe")`);
      return;
    }
    try {
      await api.post('/jobs/sources', {
        source: newSource,
        slug: newSource === 'remoteok' || newSource === 'adzuna' ? null : newSlug.trim(),
        display_name: newSlug.trim() || newSource,
      });
      setNewSlug('');
      toast.success('Source added');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to add');
    }
  }

  async function syncOne(id: string) {
    setBusy(id);
    try {
      const r = await api.post(`/jobs/sources/${id}/sync`);
      const rep = r.data;
      if (rep.error) toast.error(`Sync error: ${rep.error}`);
      else toast.success(`Pulled ${rep.jobs_pulled} jobs`);
      onAfterSync();
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Sync failed');
    } finally {
      setBusy(null);
    }
  }

  async function toggle(c: SourceCompany) {
    try {
      await api.patch(`/jobs/sources/${c.id}`, { is_active: !c.is_active });
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed');
    }
  }

  async function remove(c: SourceCompany) {
    if (!confirm(`Remove ${c.display_name ?? c.slug ?? c.source}?`)) return;
    try {
      await api.delete(`/jobs/sources/${c.id}`);
      toast.success('Removed');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed');
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/30 flex justify-end" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md h-full overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Live job sources</h2>
            <p className="text-xs text-slate-500">
              Pull real-time listings from legitimate public APIs.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Add new source */}
        <div className="p-5 border-b border-slate-100 bg-slate-50">
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Add a company / feed</h3>
          <div className="grid grid-cols-3 gap-2">
            <select
              value={newSource}
              onChange={(e) => setNewSource(e.target.value as any)}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
            >
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
              <option value="remoteok">RemoteOK</option>
              <option value="remotive">Remotive</option>
              <option value="arbeitnow">Arbeitnow</option>
              <option value="adzuna">Adzuna</option>
              <option value="jsearch">JSearch (Indeed / LinkedIn)</option>
              <option value="jooble">Jooble</option>
              <option value="usajobs">USAJobs</option>
              <option value="serpapi">SerpAPI Google Jobs</option>
              <option value="searchapi">SearchApi.io Google Jobs</option>
              <option value="linkedin">LinkedIn (Fantastic Jobs)</option>
              <option value="monster">Monster (RapidAPI)</option>
            </select>
            <input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder={
                newSource === 'greenhouse' || newSource === 'lever' || newSource === 'ashby'
                  ? 'e.g. stripe'
                  : newSource === 'linkedin'
                    ? 'e.g. Data Engineer (title filter)'
                    : newSource === 'monster'
                      ? 'e.g. python|New York|en_us'
                      : newSource === 'jsearch' ||
                          newSource === 'jooble' ||
                          newSource === 'serpapi' ||
                          newSource === 'searchapi' ||
                          newSource === 'usajobs'
                        ? 'optional: search query'
                        : '—'
              }
              disabled={
                newSource === 'remoteok' ||
                newSource === 'adzuna' ||
                newSource === 'remotive' ||
                newSource === 'arbeitnow'
              }
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm col-span-1 disabled:bg-slate-100"
            />
            <button
              onClick={add}
              className="bg-slate-900 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800"
            >
              + Add
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Greenhouse / Lever slugs come from the careers URL — e.g.{' '}
            <span className="font-mono">boards.greenhouse.io/stripe</span> → slug{' '}
            <span className="font-mono">stripe</span>.
          </p>
        </div>

        {/* Per-driver health summary */}
        {!loading && health.length > 0 && (
          <div className="p-5 border-b border-slate-100">
            <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-2">
              Driver health
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {health.map((h) => (
                <div key={h.source} className="flex items-center gap-2 text-xs">
                  <span
                    className={clsx(
                      'w-2 h-2 rounded-full shrink-0',
                      h.status === 'ok'
                        ? 'bg-emerald-500'
                        : h.status === 'missing_key'
                          ? 'bg-amber-500'
                          : h.status === 'no_rows'
                            ? 'bg-slate-300'
                            : 'bg-rose-500',
                    )}
                  />
                  <span className="font-medium text-slate-800 w-20 truncate">{h.source}</span>
                  <span className="text-slate-500">
                    {h.status === 'missing_key' && '⚠ API key missing'}
                    {h.status === 'no_rows' && 'no rows seeded'}
                    {h.status === 'error' && (h.last_error?.slice(0, 60) ?? 'error')}
                    {h.status === 'ok' &&
                      `${h.rows_active}/${h.rows_total} active · ${h.last_sync_jobs_count} jobs`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Existing sources */}
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading…</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <div className="p-6 text-sm text-slate-400 italic text-center">
                No sources configured yet.
              </div>
            )}
            {rows.map((c) => (
              <div key={c.id} className="p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <SourceBadge source={c.source} />
                    <span className="text-sm font-medium text-slate-900 truncate">
                      {c.display_name ?? c.slug ?? c.source}
                    </span>
                    {!c.is_active && (
                      <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                        Paused
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {c.slug && <span className="font-mono">{c.slug}</span>}
                    {c.last_synced_at ? (
                      <>
                        {' '}
                        · Last sync {new Date(c.last_synced_at).toLocaleString()} ·{' '}
                        {c.last_sync_jobs_count ?? 0} jobs
                      </>
                    ) : (
                      <> · Never synced</>
                    )}
                  </div>
                  {c.last_sync_error && (
                    <p className="text-[11px] text-red-600 mt-1 truncate" title={c.last_sync_error}>
                      ⚠ {c.last_sync_error}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => syncOne(c.id)}
                    disabled={busy === c.id}
                    className="text-xs border border-slate-200 rounded-md px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {busy === c.id ? '…' : 'Sync'}
                  </button>
                  <button
                    onClick={() => toggle(c)}
                    className="text-xs text-slate-500 hover:text-slate-900 px-1"
                  >
                    {c.is_active ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    onClick={() => remove(c)}
                    className="text-xs text-red-600 hover:underline px-1"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
