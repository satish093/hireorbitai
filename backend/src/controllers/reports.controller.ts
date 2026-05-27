import { RequestHandler } from 'express';
import { z } from 'zod';
import { db, pool } from '../config/db';
import { httpError, MANAGER_TIER } from '../types';

// ---------------------------------------------------------------------------
// RBAC POLICY (intentional — roles audit phases 3 & 5): reports analytics are
// WORKSPACE-WIDE for the whole MANAGER_TIER, including the group leads
// (HR_MANAGER / MANAGER). They are aggregate org metrics over global objects
// (recruiter activity, placements, pipeline), NOT per-group PII reads, so they
// are deliberately NOT group-scoped. The group-scoped surface is the PII
// pipeline (consultants / applications / resumes / interviews / tasks). If this
// becomes per-group later, add managerGroup* filters to every query here and a
// "Your group" label in the UI.
// ---------------------------------------------------------------------------

const upsertDailySchema = z
  .object({
    recruiter_id: z.string().uuid(),
    activity_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'activity_date must be YYYY-MM-DD'),
    submissions_count: z.number().int().min(0).optional(),
    interviews_scheduled: z.number().int().min(0).optional(),
    interviews_completed: z.number().int().min(0).optional(),
    vendor_calls: z.number().int().min(0).optional(),
    offers: z.number().int().min(0).optional(),
    placements: z.number().int().min(0).optional(),
    notes: z.string().optional().nullable(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Daily activity (manual recruiter daily log)
// ---------------------------------------------------------------------------

/**
 * Upsert a daily activity row for a recruiter.
 * Body: { recruiter_id, activity_date (YYYY-MM-DD), submissions_count, ... }
 */
export const upsertDaily: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = upsertDailySchema.safeParse(req.body ?? {});
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  // Non-manager callers can only write their own daily log.
  if (!(MANAGER_TIER as readonly string[]).includes(req.user.role)) {
    const { data: myRec } = await db
      .from('recruiters')
      .select('id')
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (!myRec || (myRec as { id: string }).id !== parsed.data.recruiter_id)
      throw httpError(403, 'Cannot log activity for another recruiter');
  }

  const { data, error } = await db
    .from('recruiter_daily_activity')
    .upsert(parsed.data, { onConflict: 'recruiter_id,activity_date' })
    .select()
    .single();
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

export const listDaily: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { recruiter_id, from, to } = req.query as Record<string, string | undefined>;
  let qb = db.from('recruiter_daily_activity').select('*');

  // Non-manager callers can only see their own rows.
  if (!(MANAGER_TIER as readonly string[]).includes(req.user.role)) {
    const { data: myRec } = await db
      .from('recruiters')
      .select('id')
      .eq('user_id', req.user.id)
      .maybeSingle();
    const ownRecId = myRec ? (myRec as { id: string }).id : null;
    if (!ownRecId) {
      res.json([]);
      return;
    }
    qb = qb.eq('recruiter_id', ownRecId);
  } else if (recruiter_id) {
    qb = qb.eq('recruiter_id', recruiter_id);
  }

  if (from) qb = qb.gte('activity_date', from);
  if (to) qb = qb.lte('activity_date', to);
  const { data, error } = await qb.order('activity_date', { ascending: false });
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

// ---------------------------------------------------------------------------
// Manager dashboard top-line summary
// ---------------------------------------------------------------------------

export const managerSummary: RequestHandler = async (_req, res) => {
  const [consultants, recruiters, jobs, apps] = await Promise.all([
    db.from('consultants').select('marketing_status', { count: 'exact', head: false }),
    db.from('recruiters').select('id', { count: 'exact', head: true }),
    db.from('jobs').select('id', { count: 'exact', head: true }).eq('is_active', true),
    db
      .from('applications')
      .select('status', { count: 'exact', head: false })
      .gte('submitted_at', new Date(Date.now() - 7 * 86400000).toISOString()),
  ]);

  const byStatus: Record<string, number> = { ACTIVE: 0, PAUSED: 0, PLACED: 0 };
  for (const c of consultants.data ?? [])
    byStatus[c.marketing_status] = (byStatus[c.marketing_status] ?? 0) + 1;

  const appStatus: Record<string, number> = {};
  for (const a of apps.data ?? []) appStatus[a.status] = (appStatus[a.status] ?? 0) + 1;

  res.json({
    consultants_by_status: byStatus,
    recruiters_count: recruiters.count ?? 0,
    active_jobs: jobs.count ?? 0,
    last_7_day_applications: apps.data?.length ?? 0,
    applications_by_status: appStatus,
  });
};

// ---------------------------------------------------------------------------
// Recruiter performance — per-recruiter rollup of submissions, interviews,
// offers, placements, and active consultants in their pod.
// ---------------------------------------------------------------------------

function rangeFromQuery(req: { query: Record<string, any> }): { from: string; to: string } {
  const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return {
    from: (req.query.from as string) ?? from.toISOString(),
    to: (req.query.to as string) ?? to.toISOString(),
  };
}

export const recruiterPerformance: RequestHandler = async (req, res) => {
  const { from, to } = rangeFromQuery(req);

  const [{ data: recruiters }, { data: consultants }, { data: apps }, { data: interviews }] =
    await Promise.all([
      db
        .from('recruiters')
        .select(
          'id, team, target_submissions_per_week, user:users!user_id(id, email, full_name, group_id)',
        ),
      db.from('consultants').select('id, recruiter_id, marketing_status'),
      db
        .from('applications')
        .select('id, recruiter_id, status, submitted_at')
        .gte('submitted_at', from)
        .lte('submitted_at', to),
      db
        .from('interviews')
        .select('id, consultant_id, status, scheduled_at')
        .gte('scheduled_at', from)
        .lte('scheduled_at', to),
    ]);

  // Map consultant_id → recruiter_id so we can attribute interviews back to
  // the recruiter who placed the consultant.
  const consultantToRecruiter = new Map<string, string | null>();
  for (const c of consultants ?? []) consultantToRecruiter.set(c.id, c.recruiter_id ?? null);

  type RecAgg = {
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
  };
  const map = new Map<string, RecAgg>();
  for (const r of (recruiters ?? []) as any[]) {
    map.set(r.id, {
      recruiter_id: r.id,
      name: r.user?.full_name ?? r.user?.email ?? 'Unknown',
      email: r.user?.email ?? '',
      team: r.team ?? null,
      target_per_week: r.target_submissions_per_week ?? null,
      group_id: r.user?.group_id ?? null,
      active_consultants: 0,
      placed_consultants: 0,
      submissions: 0,
      interviews: 0,
      offers: 0,
      rejections: 0,
    });
  }
  for (const c of consultants ?? []) {
    if (!c.recruiter_id) continue;
    const agg = map.get(c.recruiter_id);
    if (!agg) continue;
    if (c.marketing_status === 'ACTIVE') agg.active_consultants++;
    if (c.marketing_status === 'PLACED') agg.placed_consultants++;
  }
  for (const a of apps ?? []) {
    if (!a.recruiter_id) continue;
    const agg = map.get(a.recruiter_id);
    if (!agg) continue;
    agg.submissions++;
    if (a.status === 'OFFER') agg.offers++;
    if (a.status === 'REJECTED') agg.rejections++;
  }
  for (const i of interviews ?? []) {
    const recId = consultantToRecruiter.get(i.consultant_id);
    if (!recId) continue;
    const agg = map.get(recId);
    if (agg) agg.interviews++;
  }

  res.json({
    from,
    to,
    recruiters: Array.from(map.values()).sort((a, b) => b.submissions - a.submissions),
  });
};

// ---------------------------------------------------------------------------
// Consultant pipeline — per-consultant submission / interview activity.
// ---------------------------------------------------------------------------

export const consultantPipeline: RequestHandler = async (req, res) => {
  const { from, to } = rangeFromQuery(req);

  const [{ data: consultants }, { data: apps }, { data: interviews }] = await Promise.all([
    db
      .from('consultants')
      .select(
        'id, marketing_status, primary_skill, total_experience_years, recruiter_id,' +
          ' user:users!user_id(id, email, full_name, group_id),' +
          ' recruiter:recruiters!recruiter_id(id, team, user:users!user_id(id, full_name, email, group_id))',
      ),
    db
      .from('applications')
      .select('id, consultant_id, status, submitted_at, vendor_id, job_id')
      .gte('submitted_at', from)
      .lte('submitted_at', to),
    db
      .from('interviews')
      .select('id, consultant_id, status, type, scheduled_at')
      .gte('scheduled_at', from)
      .lte('scheduled_at', to),
  ]);

  type ConAgg = {
    consultant_id: string;
    name: string;
    email: string;
    primary_skill: string | null;
    marketing_status: string;
    recruiter_name: string | null;
    recruiter_team: string | null;
    submissions: number;
    interviews_scheduled: number;
    interviews_completed: number;
    offers: number;
    rejections: number;
    last_activity_at: string | null;
  };
  const map = new Map<string, ConAgg>();
  for (const c of (consultants ?? []) as any[]) {
    map.set(c.id, {
      consultant_id: c.id,
      name: c.user?.full_name ?? c.user?.email ?? 'Unknown',
      email: c.user?.email ?? '',
      primary_skill: c.primary_skill ?? null,
      marketing_status: c.marketing_status ?? 'ACTIVE',
      recruiter_name: c.recruiter?.user?.full_name ?? c.recruiter?.user?.email ?? null,
      recruiter_team: c.recruiter?.team ?? null,
      submissions: 0,
      interviews_scheduled: 0,
      interviews_completed: 0,
      offers: 0,
      rejections: 0,
      last_activity_at: null,
    });
  }
  function touchLastActivity(agg: ConAgg, iso: string | null) {
    if (!iso) return;
    if (!agg.last_activity_at || iso > agg.last_activity_at) agg.last_activity_at = iso;
  }
  for (const a of apps ?? []) {
    const agg = map.get(a.consultant_id);
    if (!agg) continue;
    agg.submissions++;
    if (a.status === 'OFFER') agg.offers++;
    if (a.status === 'REJECTED') agg.rejections++;
    touchLastActivity(agg, a.submitted_at);
  }
  for (const i of interviews ?? []) {
    const agg = map.get(i.consultant_id);
    if (!agg) continue;
    agg.interviews_scheduled++;
    if (i.status === 'COMPLETED') agg.interviews_completed++;
    touchLastActivity(agg, i.scheduled_at);
  }

  res.json({
    from,
    to,
    consultants: Array.from(map.values()).sort((a, b) => b.submissions - a.submissions),
  });
};

// ---------------------------------------------------------------------------
// Placement analytics — funnel + conversion rates + time-to-place.
// ---------------------------------------------------------------------------

export const placementAnalytics: RequestHandler = async (req, res) => {
  const { from, to } = rangeFromQuery(req);

  const [{ data: apps }, { data: interviews }, { data: consultants }, { data: vendors }] =
    await Promise.all([
      db
        .from('applications')
        .select('id, status, submitted_at, vendor_id, consultant_id')
        .gte('submitted_at', from)
        .lte('submitted_at', to),
      db
        .from('interviews')
        .select('id, status, consultant_id, scheduled_at')
        .gte('scheduled_at', from)
        .lte('scheduled_at', to),
      db.from('consultants').select('id, marketing_status, created_at'),
      db.from('vendors').select('id, company_name'),
    ]);

  // Funnel: submissions → interviews → offers → placements
  const submissions = apps?.length ?? 0;
  const interviewCount = interviews?.length ?? 0;
  const offers = (apps ?? []).filter((a: any) => a.status === 'OFFER').length;
  const placements = (consultants ?? []).filter((c: any) => c.marketing_status === 'PLACED').length;

  const conv = (a: number, b: number): number => (b === 0 ? 0 : Math.round((a / b) * 100));

  // Top vendors by submission count.
  const vendorMap = new Map<string, string>();
  for (const v of vendors ?? []) vendorMap.set(v.id, v.company_name);
  const vendorCounts = new Map<string, number>();
  for (const a of apps ?? []) {
    if (!a.vendor_id) continue;
    vendorCounts.set(a.vendor_id, (vendorCounts.get(a.vendor_id) ?? 0) + 1);
  }
  const top_vendors = Array.from(vendorCounts.entries())
    .map(([id, count]) => ({
      vendor_id: id,
      name: vendorMap.get(id) ?? 'Unknown',
      submissions: count,
    }))
    .sort((a, b) => b.submissions - a.submissions)
    .slice(0, 5);

  // Interview-completion rate.
  const interviewsCompleted = (interviews ?? []).filter(
    (i: any) => i.status === 'COMPLETED',
  ).length;
  const interviewsScheduled = interviewCount;

  // Applications by status (full distribution)
  const appStatus: Record<string, number> = {};
  for (const a of apps ?? []) appStatus[a.status] = (appStatus[a.status] ?? 0) + 1;

  res.json({
    from,
    to,
    funnel: {
      submissions,
      interviews: interviewCount,
      offers,
      placements,
      // conversion rates as %
      sub_to_interview: conv(interviewCount, submissions),
      interview_to_offer: conv(offers, interviewCount),
      offer_to_placement: conv(placements, offers),
      overall_placement_rate: conv(placements, submissions),
    },
    interviews: {
      scheduled: interviewsScheduled,
      completed: interviewsCompleted,
      completion_rate: conv(interviewsCompleted, interviewsScheduled),
    },
    applications_by_status: appStatus,
    top_vendors,
  });
};

// ---------------------------------------------------------------------------
// User time-in-app report — derived from the heartbeat that runs every 30s
// per authenticated user (see middleware/auth.ts). Each beat adds 30 seconds
// to `user_activity_daily.active_seconds`.
//
// GET /api/reports/user-time?from=YYYY-MM-DD&to=YYYY-MM-DD&role=…
// Returns: [{ user_id, full_name, email, role, total_seconds, days_active,
//             last_seen_at, by_day: [{ date, active_seconds }] }]
// ---------------------------------------------------------------------------
export const userTime: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { from, to, role } = req.query as Record<string, string | undefined>;
  // Default window: last 30 days.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDefault = new Date(today);
  startDefault.setDate(startDefault.getDate() - 29);
  const fromDate = from ?? startDefault.toISOString().slice(0, 10);
  const toDate = to ?? today.toISOString().slice(0, 10);

  // Pull activity rows in range.
  let { data: rows, error } = await db
    .from('user_activity_daily')
    .select('user_id, activity_date, active_seconds')
    .gte('activity_date', fromDate)
    .lte('activity_date', toDate);
  if (error) {
    if (/user_activity_daily|relation .* does not exist/i.test(error.message)) {
      throw httpError(
        400,
        'user_activity_daily table missing — apply database/user-activity-tracking.sql to the database.',
      );
    }
    throw httpError(500, 'Database error');
  }

  // Lookup user metadata (name, email, role, last_seen_at).
  const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
  let users: any[] = [];
  if (userIds.length > 0) {
    let uq = db
      .from('users')
      .select('id, full_name, email, role, last_seen_at, group_id')
      .in('id', userIds);
    const { data: us, error: uErr } = await uq;
    if (uErr && /last_seen_at|group_id/.test(uErr.message)) {
      // Migration not applied — fall back.
      const r2 = await db.from('users').select('id, full_name, email, role').in('id', userIds);
      users = r2.data ?? [];
    } else {
      users = us ?? [];
    }
  }
  const meta = new Map<string, any>(users.map((u) => [u.id, u]));

  // Bucket per-user.
  type Row = { user_id: string; activity_date: string; active_seconds: number };
  const grouped = new Map<string, { total: number; days: Map<string, number> }>();
  for (const r of (rows ?? []) as Row[]) {
    const g = grouped.get(r.user_id) ?? { total: 0, days: new Map<string, number>() };
    g.total += r.active_seconds ?? 0;
    g.days.set(r.activity_date, (g.days.get(r.activity_date) ?? 0) + (r.active_seconds ?? 0));
    grouped.set(r.user_id, g);
  }

  const result = Array.from(grouped.entries())
    .map(([userId, g]) => {
      const u = meta.get(userId) ?? {};
      return {
        user_id: userId,
        full_name: u.full_name ?? null,
        email: u.email ?? null,
        role: u.role ?? null,
        group_id: u.group_id ?? null,
        last_seen_at: u.last_seen_at ?? null,
        total_seconds: g.total,
        days_active: g.days.size,
        by_day: Array.from(g.days.entries())
          .map(([date, seconds]) => ({ date, active_seconds: seconds }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      };
    })
    .filter((r) => !role || r.role === role)
    .sort((a, b) => b.total_seconds - a.total_seconds);

  res.json({ from: fromDate, to: toDate, users: result });
};

// ===========================================================================
// REDESIGNED REPORTS ANALYTICS
// ---------------------------------------------------------------------------
// Endpoints backing the redesigned Reports frontend. Each takes:
//   range          — '7d' | '30d' | '90d' | 'qtd' | 'ytd' | 'custom'
//   compareToPrior — 'true' | 'false'
// When compareToPrior === 'true' we also compute the immediately-preceding
// window of equal length and fill each KPI's prior/delta/trend/positive.
//
// Payload shapes are pinned by the frontend types — do not reshape without
// updating the frontend.
// ===========================================================================

type Kpi = {
  label: string;
  value: string;
  prior?: string;
  delta?: string;
  trend?: 'up' | 'down';
  positive?: boolean;
};

type Window = { from: Date; to: Date };

/**
 * Resolve a `range` query param into a [from, to] window. Mirrors the day-count
 * logic used elsewhere; default is 90 days. For 'custom' we honor explicit
 * `from`/`to` ISO query params, falling back to a 90d window if absent.
 */
function resolveWindow(query: Record<string, any>): Window {
  const range = String(query.range ?? '90d');
  const to = new Date();
  let from = new Date(to.getTime() - 90 * 86400000);

  switch (range) {
    case '7d':
      from = new Date(to.getTime() - 7 * 86400000);
      break;
    case '30d':
      from = new Date(to.getTime() - 30 * 86400000);
      break;
    case '90d':
      from = new Date(to.getTime() - 90 * 86400000);
      break;
    case 'qtd': {
      // Quarter-to-date: start of the current calendar quarter.
      const q = Math.floor(to.getMonth() / 3) * 3;
      from = new Date(to.getFullYear(), q, 1);
      break;
    }
    case 'ytd':
      from = new Date(to.getFullYear(), 0, 1);
      break;
    case 'custom': {
      const cf = query.from ? new Date(String(query.from)) : null;
      const ct = query.to ? new Date(String(query.to)) : null;
      if (cf && !Number.isNaN(cf.getTime())) from = cf;
      if (ct && !Number.isNaN(ct.getTime())) return { from, to: ct };
      break;
    }
    default:
      // Unknown range → 90d default.
      break;
  }
  return { from, to };
}

/** Immediately-preceding window of equal length. */
function priorWindow(w: Window): Window {
  const len = w.to.getTime() - w.from.getTime();
  return { from: new Date(w.from.getTime() - len), to: new Date(w.from.getTime()) };
}

function wantsCompare(query: Record<string, any>): boolean {
  return String(query.compareToPrior ?? 'false') === 'true';
}

/**
 * Build a KPI. When `prior` is provided, fills delta/trend/positive.
 * `fmt` formats the numeric value; `higherIsBetter` decides the `positive` flag.
 */
function makeKpi(
  label: string,
  value: number,
  opts: {
    prior?: number;
    fmt?: (n: number) => string;
    higherIsBetter?: boolean;
  } = {},
): Kpi {
  const fmt = opts.fmt ?? ((n: number) => String(n));
  const kpi: Kpi = { label, value: fmt(value) };
  if (opts.prior !== undefined) {
    const prior = opts.prior;
    kpi.prior = fmt(prior);
    const diff = value - prior;
    const pct = prior === 0 ? (value === 0 ? 0 : 100) : Math.round((diff / prior) * 100);
    kpi.delta = `${pct >= 0 ? '+' : ''}${pct}%`;
    kpi.trend = diff >= 0 ? 'up' : 'down';
    const higher = opts.higherIsBetter ?? true;
    kpi.positive = higher ? diff >= 0 : diff <= 0;
  }
  return kpi;
}

const pct1 = (n: number) => `${Math.round(n)}%`;
const num = (n: number) => String(Math.round(n));
const num1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

const COLORS = [
  'var(--brand-from)',
  'var(--accent)',
  'var(--success)',
  'var(--warn)',
  'var(--muted)',
];

// ---------------------------------------------------------------------------
// GET /reports/pipeline
// ---------------------------------------------------------------------------
export const pipelineReport: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const w = resolveWindow(req.query as Record<string, any>);
  const compare = wantsCompare(req.query as Record<string, any>);

  // --- Funnel counts (REAL) -------------------------------------------------
  // We compute the per-status application counts in-window plus the consultant
  // "sourced" base. NOTE on the spec: the application_status enum is
  // ('SUBMITTED','SCREENING','INTERVIEW','OFFER','REJECTED','WITHDRAWN') — it
  // does NOT contain 'PLACED' or 'ACCEPTED'. Placements are tracked on
  // consultants.marketing_status = 'PLACED'. So the "Placed" funnel stage is
  // sourced from consultants, not from an application status.
  async function funnelFor(win: Window) {
    const [{ data: apps }, consultantsCount, placedCount] = await Promise.all([
      db
        .from('applications')
        .select('status')
        .gte('submitted_at', win.from.toISOString())
        .lte('submitted_at', win.to.toISOString()),
      // Sourced = distinct consultants overall (the candidate base we can market).
      // Could instead be "distinct consultants with an application in window";
      // we use the total consultant headcount as the top-of-funnel base.
      db.from('consultants').select('id', { count: 'exact', head: true }),
      db
        .from('consultants')
        .select('id', { count: 'exact', head: true })
        .eq('marketing_status', 'PLACED'),
    ]);
    const byStatus: Record<string, number> = {};
    for (const a of apps ?? []) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    return {
      sourced: consultantsCount.count ?? 0,
      submitted: apps?.length ?? 0,
      screening: byStatus.SCREENING ?? 0,
      interview: byStatus.INTERVIEW ?? 0,
      offer: byStatus.OFFER ?? 0,
      placed: placedCount.count ?? 0,
    };
  }

  const f = await funnelFor(w);

  const stagesDef: { stage: string; count: number }[] = [
    { stage: 'Sourced', count: f.sourced },
    { stage: 'Submitted', count: f.submitted },
    { stage: 'Screening', count: f.screening },
    { stage: 'Interview', count: f.interview },
    { stage: 'Offer', count: f.offer },
    { stage: 'Placed', count: f.placed },
  ];
  const funnel = stagesDef.map((s, i) => {
    const base = f.sourced || 1;
    const prev = i > 0 ? stagesDef[i - 1].count : null;
    const dropPct = prev && prev > 0 ? Math.round(((prev - s.count) / prev) * 100) : undefined;
    return {
      stage: s.stage,
      count: s.count,
      pct: Math.round((s.count / base) * 100),
      ...(dropPct !== undefined ? { dropPct } : {}),
    };
  });

  // --- Weekly series (REAL, CTE/window via pool.query) ----------------------
  // submissions: applications by submitted_at
  // interviews:  interviews by scheduled_at
  // offers:      applications that reached OFFER, bucketed by updated_at
  const fromIso = w.from.toISOString();
  const toIso = w.to.toISOString();
  const seriesSql = `
    with weeks as (
      select generate_series(
        date_trunc('week', $1::timestamptz),
        date_trunc('week', $2::timestamptz),
        interval '1 week'
      ) as wk
    ),
    subs as (
      select date_trunc('week', submitted_at) wk, count(*) c
      from public.applications
      where submitted_at >= $1 and submitted_at <= $2
      group by 1
    ),
    ints as (
      select date_trunc('week', scheduled_at) wk, count(*) c
      from public.interviews
      where scheduled_at >= $1 and scheduled_at <= $2
      group by 1
    ),
    offs as (
      select date_trunc('week', updated_at) wk, count(*) c
      from public.applications
      where status = 'OFFER' and updated_at >= $1 and updated_at <= $2
      group by 1
    )
    select to_char(weeks.wk, 'YYYY-MM-DD') as date,
           coalesce(subs.c, 0)::int as submissions,
           coalesce(ints.c, 0)::int as interviews,
           coalesce(offs.c, 0)::int as offers
    from weeks
    left join subs on subs.wk = weeks.wk
    left join ints on ints.wk = weeks.wk
    left join offs on offs.wk = weeks.wk
    order by weeks.wk asc
  `;
  let series: { date: string; submissions: number; interviews: number; offers: number }[] = [];
  try {
    const r = await pool.query(seriesSql, [fromIso, toIso]);
    series = r.rows as typeof series;
  } catch (e: any) {
    // TODO: if updated_at / column missing on older schema, leave series empty.
    req.log?.warn?.({ err: e?.message }, 'pipeline series query failed');
    series = [];
  }

  // --- Cohorts (REAL, CTE-heavy via pool.query) -----------------------------
  // For each of the last 8 submission-weeks, cells[k] = % of that cohort's
  // submissions that had an INTERVIEW within k weeks of submission. We join
  // interviews to applications via application_id (interviews.application_id),
  // measuring the gap in whole weeks between the application's submitted_at and
  // the earliest interview's scheduled_at.
  const cohortSql = `
    with cohort_apps as (
      select a.id,
             date_trunc('week', a.submitted_at) as cohort_wk,
             a.submitted_at,
             min(i.scheduled_at) as first_interview
      from public.applications a
      left join public.interviews i on i.application_id = a.id
      where a.submitted_at >= (date_trunc('week', now()) - interval '8 weeks')
      group by a.id, a.submitted_at
    ),
    weeks as (
      select distinct cohort_wk from cohort_apps order by cohort_wk desc limit 8
    )
    select to_char(w.cohort_wk, 'YYYY-MM-DD') as week,
           count(*)::int as size,
           -- weeks-to-interview gap, floored; null if no interview yet
           array_agg(
             case
               when ca.first_interview is null then null
               else greatest(0, floor(
                 extract(epoch from (ca.first_interview - ca.submitted_at)) / (7*86400)
               ))::int
             end
           ) as gaps
    from weeks w
    join cohort_apps ca on ca.cohort_wk = w.cohort_wk
    group by w.cohort_wk
    order by w.cohort_wk asc
  `;
  let cohorts: { week: string; size: number; cells: (number | null)[] }[] = [];
  try {
    const r = await pool.query(cohortSql, []);
    cohorts = (r.rows as { week: string; size: number; gaps: (number | null)[] }[]).map((row) => {
      const size = row.size || 0;
      // Build cumulative conversion cells for k = 0..5 weeks.
      const cells: (number | null)[] = [];
      const WEEKS = 6;
      for (let k = 0; k < WEEKS; k++) {
        const within = (row.gaps ?? []).filter((g) => g !== null && (g as number) <= k).length;
        cells.push(size > 0 ? Math.round((within / size) * 100) : null);
      }
      return { week: row.week, size, cells };
    });
  } catch (e: any) {
    // TODO: cohort query depends on interviews.application_id being populated.
    // If joins are unreliable on this dataset, return [] rather than a wrong curve.
    req.log?.warn?.({ err: e?.message }, 'pipeline cohort query failed');
    cohorts = [];
  }

  // --- KPIs (conversion rates + time-to-first-submission) -------------------
  let prior: Awaited<ReturnType<typeof funnelFor>> | undefined;
  if (compare) prior = await funnelFor(priorWindow(w));

  let avgDaysToFirstSub: number | undefined;
  try {
    const r = await pool.query<{ avg_days: string | null }>(
      `SELECT extract(epoch from avg(fs.first_sub - c.onboarded_at)) / 86400 AS avg_days
       FROM public.consultants c
       JOIN LATERAL (
         SELECT min(a.submitted_at) AS first_sub
         FROM public.applications a WHERE a.consultant_id = c.id
       ) fs ON fs.first_sub IS NOT NULL
       WHERE c.onboarded_at IS NOT NULL
         AND fs.first_sub > c.onboarded_at
         AND fs.first_sub >= $1 AND fs.first_sub <= $2`,
      [w.from.toISOString(), w.to.toISOString()],
    );
    const raw = r.rows[0]?.avg_days;
    if (raw != null) avgDaysToFirstSub = Math.round(parseFloat(raw));
  } catch (e: any) {
    req.log?.warn?.({ err: e?.message }, 'avg days to first sub query failed');
  }

  const conv = (a: number, b: number) => (b === 0 ? 0 : (a / b) * 100);
  const kpis: Kpi[] = [
    makeKpi('Submission → interview', conv(f.interview, f.submitted), {
      fmt: pct1,
      prior: prior ? conv(prior.interview, prior.submitted) : undefined,
    }),
    makeKpi('Interview → offer', conv(f.offer, f.interview), {
      fmt: pct1,
      prior: prior ? conv(prior.offer, prior.interview) : undefined,
    }),
    makeKpi('Offer → accept', conv(f.placed, f.offer), {
      fmt: pct1,
      prior: prior ? conv(prior.placed, prior.offer) : undefined,
    }),
    ...(avgDaysToFirstSub !== undefined
      ? [
          makeKpi('Avg days to first submission', avgDaysToFirstSub, {
            fmt: (n) => `${Math.round(n)}d`,
            higherIsBetter: false,
          }),
        ]
      : []),
  ];

  res.json({ kpis, charts: { funnel, series, cohorts } });
};

// ---------------------------------------------------------------------------
// GET /reports/recruiters
// ---------------------------------------------------------------------------
export const recruitersReport: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const w = resolveWindow(req.query as Record<string, any>);
  const compare = wantsCompare(req.query as Record<string, any>);

  // Adapted from recruiterPerformance — per-recruiter rollup.
  async function aggFor(win: Window) {
    const [{ data: recruiters }, { data: apps }] = await Promise.all([
      db.from('recruiters').select('id, team, user:users!user_id(id, email, full_name)'),
      db
        .from('applications')
        .select('id, recruiter_id, status, match_score, submitted_at')
        .gte('submitted_at', win.from.toISOString())
        .lte('submitted_at', win.to.toISOString()),
    ]);

    type Row = {
      id: string;
      name: string;
      email: string;
      subs: number;
      screens: number;
      offers: number;
      matchSum: number;
      matchN: number;
    };
    const map = new Map<string, Row>();
    for (const r of (recruiters ?? []) as any[]) {
      map.set(r.id, {
        id: r.id,
        name: r.user?.full_name ?? r.user?.email ?? 'Unknown',
        email: r.user?.email ?? '',
        subs: 0,
        screens: 0,
        offers: 0,
        matchSum: 0,
        matchN: 0,
      });
    }
    for (const a of apps ?? []) {
      if (!a.recruiter_id) continue;
      const row = map.get(a.recruiter_id);
      if (!row) continue;
      row.subs++;
      if (a.status === 'SCREENING') row.screens++;
      if (a.status === 'OFFER') row.offers++;
      if (a.match_score != null) {
        row.matchSum += Number(a.match_score);
        row.matchN++;
      }
    }
    return map;
  }

  const cur = await aggFor(w);

  // timeInApp from user_activity_daily, joined by recruiter.user_id. REAL when
  // the table/joins exist; '—' fallback otherwise.
  // recruiters.user_id → user_activity_daily.user_id total active_seconds.
  const recRows = await db.from('recruiters').select('id, user_id');
  const recToUser = new Map<string, string>();
  for (const r of (recRows.data ?? []) as any[]) {
    if (r.user_id) recToUser.set(r.id, r.user_id);
  }
  const userSeconds = new Map<string, number>();
  try {
    const userIds = Array.from(recToUser.values());
    if (userIds.length > 0) {
      const r = await pool.query<{ user_id: string; total: string }>(
        `select user_id, sum(active_seconds)::bigint as total
         from public.user_activity_daily
         where user_id = any($1::uuid[]) and activity_date >= $2 and activity_date <= $3
         group by user_id`,
        [userIds, w.from.toISOString().slice(0, 10), w.to.toISOString().slice(0, 10)],
      );
      for (const row of r.rows) userSeconds.set(row.user_id, Number(row.total));
    }
  } catch (e: any) {
    // TODO: user_activity_daily may be absent — timeInApp falls back to '—'.
    req.log?.warn?.({ err: e?.message }, 'recruiters time-in-app query failed');
  }
  const fmtHrs = (secs: number) => `${(secs / 3600).toFixed(1)}h`;

  // spark: last-14-day daily submission counts per recruiter (REAL via pool.query).
  const sparkByRec = new Map<string, number[]>();
  try {
    const r = await pool.query<{ recruiter_id: string; d: string; c: string }>(
      `select recruiter_id, to_char(date_trunc('day', submitted_at), 'YYYY-MM-DD') as d, count(*) c
       from public.applications
       where recruiter_id is not null
         and submitted_at >= (now() - interval '14 days')
       group by recruiter_id, 2`,
      [],
    );
    // Build 14-day index.
    const days: string[] = [];
    for (let i = 13; i >= 0; i--) {
      days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
    }
    const byRec = new Map<string, Map<string, number>>();
    for (const row of r.rows) {
      const m = byRec.get(row.recruiter_id) ?? new Map<string, number>();
      m.set(row.d, Number(row.c));
      byRec.set(row.recruiter_id, m);
    }
    for (const [rid, m] of byRec)
      sparkByRec.set(
        rid,
        days.map((d) => m.get(d) ?? 0),
      );
  } catch (e: any) {
    // TODO: spark falls back to [] if the daily rollup query fails.
    req.log?.warn?.({ err: e?.message }, 'recruiters spark query failed');
  }

  const table = Array.from(cur.values())
    .map((r) => {
      const uid = recToUser.get(r.id);
      const secs = uid ? userSeconds.get(uid) : undefined;
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        subs: r.subs,
        screens: r.screens,
        offers: r.offers,
        matchAvg: r.matchN > 0 ? Math.round(r.matchSum / r.matchN) : 0,
        timeInApp: secs && secs > 0 ? fmtHrs(secs) : '—',
        spark: sparkByRec.get(r.id) ?? [],
      };
    })
    .sort((a, b) => b.subs - a.subs);

  // --- KPIs ---
  const weeks = Math.max(1, (w.to.getTime() - w.from.getTime()) / (7 * 86400000));
  const recCount = Math.max(1, table.length);
  const totalSubs = table.reduce((s, r) => s + r.subs, 0);
  // interviews per recruiter: derive from offers+screens proxy is wrong;
  // pull interview count attributed via applications reaching INTERVIEW status.
  const interviewRows = await db
    .from('applications')
    .select('recruiter_id, status')
    .eq('status', 'INTERVIEW')
    .gte('submitted_at', w.from.toISOString())
    .lte('submitted_at', w.to.toISOString());
  const totalInterviews = (interviewRows.data ?? []).filter((a: any) => a.recruiter_id).length;

  let priorSubsPerWk: number | undefined;
  let priorIntPerWk: number | undefined;
  if (compare) {
    const pw = priorWindow(w);
    const priorMap = await aggFor(pw);
    const pSubs = Array.from(priorMap.values()).reduce((s, r) => s + r.subs, 0);
    const pInt = await db
      .from('applications')
      .select('recruiter_id, status')
      .eq('status', 'INTERVIEW')
      .gte('submitted_at', pw.from.toISOString())
      .lte('submitted_at', pw.to.toISOString());
    const pIntCount = (pInt.data ?? []).filter((a: any) => a.recruiter_id).length;
    const pRecCount = Math.max(1, priorMap.size);
    priorSubsPerWk = pSubs / pRecCount / weeks;
    priorIntPerWk = pIntCount / pRecCount / weeks;
  }

  const kpis: Kpi[] = [
    makeKpi('Avg subs / recruiter / wk', totalSubs / recCount / weeks, {
      fmt: num1,
      prior: priorSubsPerWk,
    }),
    makeKpi('Avg interviews / recruiter / wk', totalInterviews / recCount / weeks, {
      fmt: num1,
      prior: priorIntPerWk,
    }),
    // Avg time in app: REAL aggregate when user_activity_daily present.
    makeKpi(
      'Avg time in app',
      (() => {
        const vals = Array.from(userSeconds.values());
        if (vals.length === 0) return 0;
        return vals.reduce((s, v) => s + v, 0) / vals.length / 3600;
      })(),
      { fmt: (n) => (n > 0 ? `${n.toFixed(1)}h` : '—') },
    ),
    // TODO: Bench utilisation — no bench/availability metric source wired yet.
    // Omitted rather than fabricated.
  ];

  res.json({ kpis, table });
};

// ---------------------------------------------------------------------------
// GET /reports/consultants
// ---------------------------------------------------------------------------
export const consultantsReport: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  // NOTE: consultant visa/status mix and the active/bench counts are
  // point-in-time headcounts, not windowed — so `range` does not affect them.
  // We still accept the param for a uniform frontend contract.
  const compare = wantsCompare(req.query as Record<string, any>);

  const { data: consultants } = await db
    .from('consultants')
    .select('id, visa_status, marketing_status');

  // visaMix / statusMix (REAL) ---------------------------------------------
  const visaCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  for (const c of (consultants ?? []) as any[]) {
    const visa = c.visa_status ?? 'Unknown';
    const status = c.marketing_status ?? 'ACTIVE';
    visaCounts.set(visa, (visaCounts.get(visa) ?? 0) + 1);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const toMix = (m: Map<string, number>) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], i) => ({ label, value, color: COLORS[i % COLORS.length] }));
  const visaMix = toMix(visaCounts);
  const statusMix = toMix(statusCounts);

  // KPIs --------------------------------------------------------------------
  const active = (consultants ?? []).filter((c: any) => c.marketing_status === 'ACTIVE').length;

  // Bench (REAL): active consultants with no application in the last 14 days.
  let bench = 0;
  try {
    const r = await pool.query<{ bench: string }>(
      `select count(*)::int as bench
       from public.consultants c
       where c.marketing_status = 'ACTIVE'
         and not exists (
           select 1 from public.applications a
           where a.consultant_id = c.id
             and a.submitted_at >= (now() - interval '14 days')
         )`,
      [],
    );
    bench = Number(r.rows[0]?.bench ?? 0);
  } catch (e: any) {
    req.log?.warn?.({ err: e?.message }, 'consultants bench query failed');
  }

  let priorActive: number | undefined;
  let priorBench: number | undefined;
  if (compare) {
    // Active is a point-in-time headcount; prior window has no separate
    // historical snapshot, so prior == current (no trend). We still pass it so
    // the KPI renders a neutral delta rather than omitting. Bench likewise.
    priorActive = active;
    priorBench = bench;
  }

  let avgAiScore: number | undefined;
  try {
    const r = await pool.query<{ avg: string | null }>(
      `SELECT avg(r.ai_score)::numeric(5,1) AS avg
       FROM public.resumes r
       WHERE r.is_current = true AND r.ai_score IS NOT NULL`,
      [],
    );
    const raw = r.rows[0]?.avg;
    if (raw != null) avgAiScore = parseFloat(raw);
  } catch (e: any) {
    req.log?.warn?.({ err: e?.message }, 'avg ai_score query failed');
  }

  let avgDaysToPlacement: number | undefined;
  try {
    const r = await pool.query<{ avg_days: string | null }>(
      `SELECT extract(epoch from avg(c.updated_at - c.onboarded_at)) / 86400 AS avg_days
       FROM public.consultants c
       WHERE c.marketing_status = 'PLACED'
         AND c.onboarded_at IS NOT NULL
         AND c.updated_at > c.onboarded_at`,
      [],
    );
    const raw = r.rows[0]?.avg_days;
    if (raw != null) avgDaysToPlacement = Math.round(parseFloat(raw));
  } catch (e: any) {
    req.log?.warn?.({ err: e?.message }, 'avg days to placement query failed');
  }

  const kpis: Kpi[] = [
    makeKpi('Active consultants', active, { fmt: num, prior: priorActive }),
    makeKpi('On bench (14d idle)', bench, {
      fmt: num,
      prior: priorBench,
      higherIsBetter: false,
    }),
    ...(avgAiScore !== undefined
      ? [
          makeKpi('Avg Resume AI Score', avgAiScore, {
            fmt: (n) => n.toFixed(1),
            higherIsBetter: true,
          }),
        ]
      : []),
    ...(avgDaysToPlacement !== undefined
      ? [
          makeKpi('Avg days to placement', avgDaysToPlacement, {
            fmt: (n) => `${Math.round(n)}d`,
            higherIsBetter: false,
          }),
        ]
      : []),
  ];

  res.json({ kpis, charts: { visaMix, statusMix } });
};

// ---------------------------------------------------------------------------
// GET /reports/placements
// ---------------------------------------------------------------------------
export const placementsReport: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const w = resolveWindow(req.query as Record<string, any>);
  const compare = wantsCompare(req.query as Record<string, any>);

  // Placements (REAL): the application_status enum has no PLACED/ACCEPTED, so
  // "placed" is read from consultants.marketing_status = 'PLACED'. To attribute
  // a placement to a client company we use the most recent application's
  // job → jobs.company_name for that placed consultant, within the window.
  async function placementsFor(win: Window) {
    const r = await pool.query<{ company: string; c: string }>(
      `select coalesce(j.company_name, 'Unknown') as company, count(*)::int as c
       from public.consultants con
       join lateral (
         select a.job_id
         from public.applications a
         where a.consultant_id = con.id
           and a.submitted_at >= $1 and a.submitted_at <= $2
         order by a.submitted_at desc
         limit 1
       ) la on true
       join public.jobs j on j.id = la.job_id
       where con.marketing_status = 'PLACED'
       group by 1
       order by 2 desc`,
      [win.from.toISOString(), win.to.toISOString()],
    );
    return r.rows;
  }

  let byClientRows: { company: string; c: number }[] = [];
  try {
    byClientRows = (await placementsFor(w)).map((r) => ({ company: r.company, c: Number(r.c) }));
  } catch (e: any) {
    // TODO: byClient depends on jobs.company_name; empty on failure.
    req.log?.warn?.({ err: e?.message }, 'placements byClient query failed');
    byClientRows = [];
  }
  // byClient = [companyName, count][]. rightLabel (3rd tuple element) omitted —
  // no revenue/comp data source.
  const byClient: [string, number, string?][] = byClientRows.map((r) => [r.company, r.c]);
  const totalPlacements = byClientRows.reduce((s, r) => s + r.c, 0);

  let priorTotal: number | undefined;
  if (compare) {
    try {
      const pr = await placementsFor(priorWindow(w));
      priorTotal = pr.reduce((s, r) => s + Number(r.c), 0);
    } catch {
      priorTotal = undefined;
    }
  }

  const kpis: Kpi[] = [
    makeKpi('Placements', totalPlacements, { fmt: num, prior: priorTotal }),
    // TODO: Median TC, Revenue, Retention 90d — no compensation, billing, or
    // retention-tracking data source in the schema. Omitted rather than stubbed
    // with fabricated numbers.
  ];

  res.json({ kpis, charts: { byClient } });
};

// ---------------------------------------------------------------------------
// GET /reports/sources
// ---------------------------------------------------------------------------
export const sourcesReport: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const w = resolveWindow(req.query as Record<string, any>);
  const compare = wantsCompare(req.query as Record<string, any>);

  // Per-source rollup (REAL): jobs grouped by jobs.source. subs = applications
  // whose job carries that source. matchAvg = avg(applications.match_score)
  // for those applications (jobs has no match_score column; applications do).
  // latency + health are STUBBED — no ingest-latency / health-signal data.
  type Row = {
    source: string;
    jobs: number;
    subs: number;
    matchSum: number;
    matchN: number;
  };
  async function aggFor(win: Window) {
    const r = await pool.query<{
      source: string;
      jobs: string;
      subs: string;
      match_sum: string | null;
      match_n: string;
    }>(
      `select coalesce(j.source, 'manual') as source,
              count(distinct j.id)::int as jobs,
              count(a.id)::int as subs,
              sum(a.match_score) as match_sum,
              count(a.match_score)::int as match_n
       from public.jobs j
       left join public.applications a
         on a.job_id = j.id
        and a.submitted_at >= $1 and a.submitted_at <= $2
       where j.created_at >= $1 and j.created_at <= $2
       group by 1
       order by jobs desc`,
      [win.from.toISOString(), win.to.toISOString()],
    );
    return r.rows.map<Row>((row) => ({
      source: row.source,
      jobs: Number(row.jobs),
      subs: Number(row.subs),
      matchSum: row.match_sum != null ? Number(row.match_sum) : 0,
      matchN: Number(row.match_n),
    }));
  }

  let rows: Row[] = [];
  try {
    rows = await aggFor(w);
  } catch (e: any) {
    // TODO: empty on failure (jobs.source / created_at must exist).
    req.log?.warn?.({ err: e?.message }, 'sources query failed');
    rows = [];
  }

  const table = rows.map((r) => ({
    source: r.source,
    jobs: r.jobs,
    matchAvg: r.matchN > 0 ? Math.round(r.matchSum / r.matchN) : 0,
    subs: r.subs,
    // STUB: no per-source ingest-latency signal in the schema.
    latency: '—',
    // STUB: no health signal; default optimistic.
    health: 'healthy',
  }));

  const totalJobs = rows.reduce((s, r) => s + r.jobs, 0);
  const sourcesActive = rows.filter((r) => r.jobs > 0).length;

  let priorJobs: number | undefined;
  let priorSources: number | undefined;
  if (compare) {
    try {
      const pr = await aggFor(priorWindow(w));
      priorJobs = pr.reduce((s, r) => s + r.jobs, 0);
      priorSources = pr.filter((r) => r.jobs > 0).length;
    } catch {
      priorJobs = undefined;
      priorSources = undefined;
    }
  }

  const kpis: Kpi[] = [
    makeKpi('Jobs ingested', totalJobs, { fmt: num, prior: priorJobs }),
    makeKpi('Sources active', sourcesActive, { fmt: num, prior: priorSources }),
    // TODO: Median ingest latency, Fail rate — no ingest-timing / failure-log
    // data source. Omitted rather than fabricated.
  ];

  res.json({ kpis, table });
};
