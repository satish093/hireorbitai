import { RequestHandler } from 'express';
import { db } from '../config/db';
import { httpError } from '../types';

// ---------------------------------------------------------------------------
// Daily activity (manual recruiter daily log)
// ---------------------------------------------------------------------------

/**
 * Upsert a daily activity row for a recruiter.
 * Body: { recruiter_id, activity_date (YYYY-MM-DD), submissions_count, ... }
 */
export const upsertDaily: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const body = req.body ?? {};
  if (!body.recruiter_id || !body.activity_date) {
    throw httpError(400, 'recruiter_id and activity_date required');
  }
  const { data, error } = await db
    .from('recruiter_daily_activity')
    .upsert(body, { onConflict: 'recruiter_id,activity_date' })
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const listDaily: RequestHandler = async (req, res) => {
  const { recruiter_id, from, to } = req.query as Record<string, string | undefined>;
  let qb = db.from('recruiter_daily_activity').select('*');
  if (recruiter_id) qb = qb.eq('recruiter_id', recruiter_id);
  if (from) qb = qb.gte('activity_date', from);
  if (to) qb = qb.lte('activity_date', to);
  const { data, error } = await qb.order('activity_date', { ascending: false });
  if (error) throw httpError(500, error.message);
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
        .select('id, team, target_submissions_per_week, user:users!user_id(id, email, full_name)'),
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
          ' user:users!user_id(id, email, full_name),' +
          ' recruiter:recruiters!recruiter_id(id, team, user:users!user_id(id, full_name, email))',
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
    throw httpError(500, error.message);
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
