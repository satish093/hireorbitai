import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { ApplyInterceptModal, shouldShowApplyIntercept } from '../components/ApplyInterceptModal';
import { CustomizeResumeWizard } from '../components/CustomizeResumeWizard';
import { DuplicateSubmissionModal } from '../components/DuplicateSubmissionModal';
import { invalidate } from '../hooks/useInvalidate';
import { SkeletonCard } from '../components/Skeleton';
import { Button } from '../components/Button';
import { ButtonGroup, ButtonGroupItem } from '../components/ButtonGroup';
import toast from 'react-hot-toast';
import { TABS } from '../components/jobs/types';
import type { AppliedSubTab, ApplyTarget, JobRow, TabKey } from '../components/jobs/types';
import { daysAgoISO, filteredRows, resolveApplyUrl } from '../components/jobs/helpers';
import { JobCard } from '../components/jobs/JobCard';
import { PillSelect } from '../components/jobs/PillSelect';
import { EmptyState } from '../components/jobs/EmptyState';
import { MatchModeChip } from '../components/jobs/MatchModeChip';
import { AppliedSubTabs } from '../components/jobs/AppliedSubTabs';
import { AlertsToggle } from '../components/jobs/AlertsToggle';
import { SkillsPicker } from '../components/jobs/SkillsPicker';
import { SourceBreakdown } from '../components/jobs/SourceBreakdown';
import { RecruiterTargetingBar } from '../components/jobs/RecruiterTargetingBar';
import { ApplyConfirmModal } from '../components/jobs/ApplyConfirmModal';
import { SourcesDrawer } from '../components/jobs/SourcesDrawer';

export function JobSearch() {
  const { profile } = useAuth();
  const isManager = profile?.role === 'SUPER_ADMIN' || profile?.role === 'MANAGER';
  const isConsultant = profile?.role === 'CONSULTANT';
  /** True for everyone who can apply on behalf of a consultant — recruiters
   *  and the manager tier all qualify. */
  const isRecruiterMode = !!profile && profile.role !== 'CONSULTANT';
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('recommended');
  const [rows, setRows] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
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
  // No default location — user picks if they want to narrow. Empty string
  // means "no location filter applied" both in the UI pill ("Anywhere")
  // and in the backend (no WHERE clause).
  const [location, setLocation] = useState('');
  const [remote, setRemote] = useState<'' | 'true' | 'false'>('');
  /** Stable values for the Posted pill: '' (any), or a day count like '1' / '7' / '30'.
   *  Default empty — show every job regardless of age. User narrows with the
   *  pill if they want only fresh listings. */
  const [postedAfter, setPostedAfter] = useState<string>('');
  const [yearsMin, setYearsMin] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [publisherFilter, setPublisherFilter] = useState<string>('');
  const [jobFunction, setJobFunction] = useState<string>('');
  const [appliedSub, setAppliedSub] = useState<AppliedSubTab>('applied');
  /** Diagnostic from the recommended endpoint — tells us whether scoring used
   *  a resume, skills only, or didn't run at all. */
  const [matchMode, setMatchMode] = useState<string | null>(null);

  // Pagination — applies to the Recommended tab. Liked/Applied are usually
  // short user-scoped lists; the backend doesn't paginate them and the
  // frontend just shows them all.
  const PER_PAGE = 40;
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  // Sentinel for infinite scroll — when it enters the viewport we load the
  // next page (which the reload effect appends).
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

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
        // Recruiter mode: rank/score against the targeted consultant AND filter
        // the feed down to jobs that actually match them (Fair match and up).
        if (target?.consultantId) {
          params.consultant_id = target.consultantId;
          params.min_match = '50';
        }
        // Pagination — recommended is the only paginated tab.
        params.page = String(page);
        params.per_page = String(PER_PAGE);
      }
      // The Applied tab is consultant-scoped — pass through the targeted
      // consultant so recruiters can see what they've submitted on their behalf.
      if (currentTab === 'applied' && target?.consultantId) {
        params.consultant_id = target.consultantId;
      }
      const r = await api.get(url, { params, signal });
      if (signal?.aborted) return;
      // Recommended endpoint returns { rows, page, per_page, total, total_pages }.
      // Liked/Applied return a plain array. Handle both shapes.
      if (
        currentTab === 'recommended' &&
        r.data &&
        typeof r.data === 'object' &&
        Array.isArray(r.data.rows)
      ) {
        // Infinite scroll: append when fetching a later page, replace on page 1
        // (a fresh filter/tab load). Dedupe by id so a shifting feed can't
        // double-list a job.
        setRows((prev) => {
          if (page <= 1) return r.data.rows;
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...r.data.rows.filter((x: JobRow) => !seen.has(x.id))];
        });
        setTotalPages(Math.max(1, Number(r.data.total_pages) || 1));
        setTotalRows(Number(r.data.total) || r.data.rows.length);
      } else {
        setRows(Array.isArray(r.data) ? r.data : (r.data?.rows ?? []));
        setTotalPages(1);
        setTotalRows(Array.isArray(r.data) ? r.data.length : 0);
      }
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

  // Reload whenever the tab, the targeted consultant, any auto-apply filter,
  // OR the page number changes. Manual filters (`q`, `location`, `remote`,
  // `yearsMin`, `sourceFilter`) only fire on Apply click. Abort previous
  // in-flight request so a slow earlier load can't clobber a newer one.
  useEffect(() => {
    const controller = new AbortController();
    load(tab, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line
  }, [tab, target?.consultantId, postedAfter, publisherFilter, jobFunction, page]);

  // Infinite scroll — bump the page when the sentinel scrolls into view (only
  // on the recommended feed, when there's more to load and we're idle).
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading && tab === 'recommended' && page < totalPages) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: '600px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, tab, page, totalPages]);

  // Whenever a filter changes (NOT page), snap back to page 1 so the user
  // sees the top of the freshly-filtered feed instead of an empty page-50.
  useEffect(() => {
    setPage(1);
  }, [
    tab,
    target?.consultantId,
    postedAfter,
    publisherFilter,
    jobFunction,
    q,
    location,
    remote,
    yearsMin,
  ]);

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
      {/* Consumer hero — search-forward, shown on the main feed */}
      {tab === 'recommended' && (
        <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-indigo-600 text-white p-6 sm:p-8 mb-6 shadow-sm">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Find your next role</h1>
          <p className="text-white/85 text-sm mt-1">
            {totalRows > 0
              ? `${totalRows.toLocaleString()} live openings`
              : 'Search thousands of live openings'}
          </p>
          <div className="mt-4 flex flex-col sm:flex-row gap-2 bg-surface rounded-xl p-2 shadow-lg max-w-2xl">
            <div className="relative flex-1 min-w-0">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">⌕</span>
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') load();
                }}
                placeholder="Job title, company, or skill"
                className="w-full h-10 pl-9 pr-3 rounded-lg text-sm text-ink placeholder:text-muted focus:outline-none"
              />
            </div>
            <Button
              variant="primary"
              size="md"
              onClick={() => load()}
              className="h-10 px-6 shrink-0"
            >
              Search
            </Button>
          </div>
          {isConsultant && (
            <div className="mt-3">
              <AlertsToggle />
            </div>
          )}
        </div>
      )}

      {/* Tabs + (staff) actions */}
      <div className="flex items-center gap-4 mb-5">
        <ButtonGroup>
          {TABS.map((t) => (
            <ButtonGroupItem key={t.key} pressed={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
        {isManager && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              pill
              onClick={() => setSourcesOpen(true)}
              title="Manage live job sources"
            >
              Sources
            </Button>
            <Button
              variant="outline"
              size="sm"
              pill
              onClick={enrichNow}
              disabled={syncing}
              title="Run AI to extract requirements, seniority, work model, etc."
            >
              ✦ Enrich
            </Button>
            <Button
              variant="primary"
              size="sm"
              pill
              onClick={syncNow}
              disabled={syncing}
              loading={syncing}
              title="Pull fresh jobs from all sources"
              leftIcon={<span className={syncing ? 'inline-block animate-spin' : ''}>↻</span>}
            >
              {syncing ? 'Working…' : 'Sync now'}
            </Button>
          </div>
        )}
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
            placeholder="Pick a location"
            onChange={(v) => {
              setLocation(v);
            }}
            options={[
              { value: 'United States', label: 'United States' },
              { value: 'Remote', label: 'Remote' },
              { value: 'New York', label: 'New York' },
              { value: 'San Francisco', label: 'San Francisco' },
              { value: 'Seattle', label: 'Seattle' },
              { value: 'Austin', label: 'Austin' },
              { value: 'Los Angeles', label: 'Los Angeles' },
              { value: 'Boston', label: 'Boston' },
              { value: 'Chicago', label: 'Chicago' },
              { value: 'London', label: 'London' },
              { value: 'Europe', label: 'Europe' },
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
          <Button variant="ghost" size="sm" pill onClick={() => load()} className="ml-1">
            Apply
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ('');
              setLocation('');
              setRemote('');
              setPostedAfter('');
              setYearsMin('');
              setSourceFilter('');
              setPublisherFilter('');
              setJobFunction('');
            }}
            className="ml-1"
          >
            Reset
          </Button>
        </div>
      )}

      {/* Match-mode chip — single-line, replaces the two verbose banners
          we used to render. The match-mode header set by /jobs/recommended
          tells us why scores are partial / missing. */}
      {!loading && tab === 'recommended' && matchMode && matchMode !== 'resume+skills' && (
        <div className="mb-3">
          <MatchModeChip mode={matchMode} isRecruiterMode={isRecruiterMode} />
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
        if (loading) {
          // Skeleton cards mimic the job-card layout so the loading state feels
          // intentional rather than a blank screen with a stray "Loading…".
          return (
            <div className="space-y-3" aria-label="Loading jobs">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonCard key={i} lines={4} />
              ))}
            </div>
          );
        }
        if (filtered.length === 0)
          return <EmptyState tab={tab} onSync={isManager ? syncNow : undefined} />;
        return (
          <div className="space-y-3">
            {tab === 'recommended' && totalRows > 0 && (
              <div className="text-xs text-muted px-1">
                Showing {filtered.length} of {totalRows.toLocaleString()} jobs
              </div>
            )}
            {filtered.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                isConsultant={isConsultant}
                onToggleLike={() => toggleLike(j)}
                onOpenInsight={() => navigate(`/jobs/${j.id}`)}
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
            {/* Infinite scroll sentinel — entering view loads the next page. */}
            {tab === 'recommended' && page < totalPages && (
              <div ref={loadMoreRef} className="py-6 text-center text-xs text-muted">
                {loading ? 'Loading more…' : 'Scroll for more'}
              </div>
            )}
          </div>
        );
      })()}

      {sourcesOpen && (
        <SourcesDrawer onClose={() => setSourcesOpen(false)} onAfterSync={() => load(tab)} />
      )}
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
              navigate(`/jobs/${j.id}`);
            } else {
              navigate(`/jobs/${j.id}`);
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
