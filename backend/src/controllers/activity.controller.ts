import { RequestHandler } from 'express';
import { db } from '../config/db';
import { httpError, MANAGER_TIER } from '../types';

// Aggregated recruiter activity feed. Fans out across the data the caller is
// allowed to see — scoped exactly like applications.list (managers: all;
// recruiter: own pipeline; consultant: own) — plus the caller's own tasks.
// Read-only; no new tables. Powers the dashboard ActivityStream.

type Tone = 'success' | 'danger' | 'warning' | 'accent' | 'neutral';
type Verb =
  | 'submitted'
  | 'scored'
  | 'received'
  | 'commented'
  | 'archived'
  | 'updated'
  | 'reached'
  | 'synced';
type Icon = 'send' | 'star' | 'sparkles' | 'inbox' | 'trash' | 'doc' | 'video' | 'download';

interface ActivityEvent {
  id: string;
  ts: string;
  actor: { name: string } | 'system';
  verb: Verb;
  object: { label: string; href?: string };
  context?: { label: string; href?: string };
  tone: Tone;
  icon: Icon;
}

const isManagerTier = (role?: string) => !!role && (MANAGER_TIER as string[]).includes(role);
const HOUR = 3_600_000;
const MISSING = /schema cache|relation .* does not exist|column .* does not exist/i;

async function recruiterRowId(userId: string): Promise<string | null> {
  const { data } = await db.from('recruiters').select('id').eq('user_id', userId).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}
async function consultantRowId(userId: string): Promise<string | null> {
  const { data } = await db.from('consultants').select('id').eq('user_id', userId).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

interface AppRow {
  id: string;
  status?: string | null;
  submitted_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  job?: { title?: string | null } | null;
  consultant?: { user?: { full_name?: string | null } | null } | null;
}

function appToEvent(a: AppRow): ActivityEvent {
  const status = String(a.status ?? '').toUpperCase();
  const consultantName = a.consultant?.user?.full_name ?? null;
  let verb: Verb = 'submitted';
  let tone: Tone = 'accent';
  let icon: Icon = 'send';
  if (['REJECTED', 'WITHDRAWN', 'ARCHIVED'].includes(status)) {
    verb = 'archived';
    tone = 'danger';
    icon = 'trash';
  } else if (status === 'OFFER') {
    verb = 'received';
    tone = 'success';
    icon = 'inbox';
  } else if (['PLACED', 'ACCEPTED'].includes(status)) {
    verb = 'received';
    tone = 'success';
    icon = 'star';
  } else if (status === 'INTERVIEW') {
    verb = 'reached';
    tone = 'warning';
    icon = 'video';
  }
  return {
    id: `app-${a.id}`,
    ts: a.updated_at ?? a.submitted_at ?? a.created_at ?? new Date().toISOString(),
    actor: consultantName ? { name: consultantName } : 'system',
    verb,
    tone,
    icon,
    object: { label: a.job?.title ?? 'a role', href: '/applications' },
    context: consultantName ? { label: consultantName } : undefined,
  };
}

export const feed: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const scope = req.query.scope === 'team' ? 'team' : 'mine';
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
  const role = req.user.role;

  // Applications, scoped to what the caller may see (mirrors applications.list).
  let appsAllowed = true;
  let q = db
    .from('applications')
    .select(
      'id, status, submitted_at, updated_at, created_at, job:jobs(title), consultant:consultants(user:users!user_id(full_name))',
    )
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (isManagerTier(role)) {
    // Team view = everything; mine = narrow to the caller's own recruiter
    // pipeline when they also carry a recruiter row.
    if (scope === 'mine') {
      const rec = await recruiterRowId(req.user.id);
      if (rec) q = q.eq('recruiter_id', rec);
    }
  } else if (role === 'RECRUITER') {
    const rec = await recruiterRowId(req.user.id);
    if (!rec) appsAllowed = false;
    else q = q.eq('recruiter_id', rec); // recruiters can't see beyond their own
  } else if (role === 'CONSULTANT') {
    const cons = await consultantRowId(req.user.id);
    if (!cons) appsAllowed = false;
    else q = q.eq('consultant_id', cons);
  } else {
    appsAllowed = false;
  }

  const events: ActivityEvent[] = [];
  if (appsAllowed) {
    const { data, error } = await q;
    if (error) throw httpError(500, 'Database error');
    for (const a of (data ?? []) as AppRow[]) events.push(appToEvent(a));
  }

  // The caller's own tasks (always "mine").
  const { data: tasks } = await db
    .from('tasks')
    .select('id, title, updated_at, created_at')
    .eq('assignee_id', req.user.id)
    .order('updated_at', { ascending: false })
    .limit(limit);
  for (const t of (tasks ?? []) as {
    id?: string;
    title?: string;
    updated_at?: string;
    created_at?: string;
  }[]) {
    if (!t.id || !t.title) continue;
    events.push({
      id: `task-${t.id}`,
      ts: t.updated_at ?? t.created_at ?? new Date().toISOString(),
      actor: 'system',
      verb: 'updated',
      object: { label: t.title, href: '/tasks' },
      tone: 'neutral',
      icon: 'doc',
    });
  }

  events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  res.json(events.slice(0, limit));
};

// ---------------------------------------------------------------------------
// Urgent signals for the dashboard UrgentRibbon: interviews starting within 4h,
// offers expiring within 36h, and submissions stuck in SCREENING > 7 days — all
// scoped to the consultants the caller may see. (Unread-DM signal is still
// TODO: it needs per-consultant message rollups.) Returns plain data; the
// frontend hook shapes it into ribbon items.
// ---------------------------------------------------------------------------

interface IvRow {
  id: string;
  scheduled_at: string;
  type?: string | null;
  interviewer?: string | null;
  consultant?: { user?: { full_name?: string | null } | null } | null;
}
interface OfferRow {
  id: string;
  offer_expires_at?: string | null;
  job?: { title?: string | null } | null;
  consultant?: { user?: { full_name?: string | null } | null } | null;
}

const EMPTY = { interviews: [], offersExpiring: [], screeningStuck: 0, unreadDms: 0 };

export const urgent: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const role = req.user.role;
  const now = Date.now();

  // Consultant ids the caller may see (null = all, for managers). For the
  // unread-DM signal we also collect the user_ids of the caller's ACTIVE
  // consultants (recruiter scope) so we can match message senders.
  let consultantIds: string[] | null = null;
  let activeUserIds: string[] = [];
  if (isManagerTier(role)) {
    consultantIds = null;
  } else if (role === 'RECRUITER') {
    const rec = await recruiterRowId(req.user.id);
    if (!rec) {
      res.json(EMPTY);
      return;
    }
    const { data } = await db
      .from('consultants')
      .select('id, user_id, marketing_status')
      .eq('recruiter_id', rec);
    const rows = (data ?? []) as { id: string; user_id?: string; marketing_status?: string }[];
    consultantIds = rows.map((c) => c.id);
    activeUserIds = rows
      .filter((c) => (c.marketing_status ?? '').toUpperCase() === 'ACTIVE' && c.user_id)
      .map((c) => c.user_id as string);
  } else if (role === 'CONSULTANT') {
    const cons = await consultantRowId(req.user.id);
    consultantIds = cons ? [cons] : [];
  } else {
    res.json(EMPTY);
    return;
  }

  if (consultantIds !== null && consultantIds.length === 0) {
    res.json(EMPTY);
    return;
  }

  // 1) Interviews within the next 4h.
  let ivq = db
    .from('interviews')
    .select(
      'id, scheduled_at, type, interviewer, consultant:consultants(user:users!user_id(full_name))',
    )
    .gte('scheduled_at', new Date(now).toISOString())
    .lte('scheduled_at', new Date(now + 4 * HOUR).toISOString())
    .eq('status', 'SCHEDULED')
    .order('scheduled_at', { ascending: true })
    .limit(10);
  if (consultantIds) ivq = ivq.in('consultant_id', consultantIds);
  const ivRes = await ivq;
  if (ivRes.error && !MISSING.test(ivRes.error.message)) throw httpError(500, ivRes.error.message);
  const interviews = ((ivRes.data ?? []) as IvRow[]).map((iv) => ({
    id: iv.id,
    consultantName: iv.consultant?.user?.full_name ?? null,
    type: iv.type ?? null,
    interviewer: iv.interviewer ?? null,
    scheduled_at: iv.scheduled_at,
  }));

  // 2) Offers expiring within 36h (skipped gracefully if column not migrated).
  let oq = db
    .from('applications')
    .select(
      'id, offer_expires_at, job:jobs(title), consultant:consultants(user:users!user_id(full_name))',
    )
    .eq('status', 'OFFER')
    .gte('offer_expires_at', new Date(now).toISOString())
    .lte('offer_expires_at', new Date(now + 36 * HOUR).toISOString())
    .order('offer_expires_at', { ascending: true })
    .limit(10);
  if (consultantIds) oq = oq.in('consultant_id', consultantIds);
  const oRes = await oq;
  if (oRes.error && !MISSING.test(oRes.error.message)) throw httpError(500, oRes.error.message);
  const offersExpiring = ((oRes.data ?? []) as OfferRow[]).map((a) => ({
    id: a.id,
    consultantName: a.consultant?.user?.full_name ?? null,
    jobTitle: a.job?.title ?? null,
    expires_at: a.offer_expires_at ?? null,
  }));

  // 3) Submissions stuck in SCREENING > 7 days.
  let sq = db
    .from('applications')
    .select('id')
    .eq('status', 'SCREENING')
    .lt('submitted_at', new Date(now - 7 * 24 * HOUR).toISOString())
    .limit(100);
  if (consultantIds) sq = sq.in('consultant_id', consultantIds);
  const sRes = await sq;
  if (sRes.error && !MISSING.test(sRes.error.message)) throw httpError(500, sRes.error.message);
  const screeningStuck = (sRes.data ?? []).length;

  // 4) Unread DMs to the caller, older than 24h. For recruiters, restricted to
  // messages from their ACTIVE consultants; managers see any unread > 24h to
  // them. (Consultants don't get this signal.) Degrades to 0 if the messages
  // table/columns aren't present.
  let unreadDms = 0;
  const dmAllowed = isManagerTier(role) || role === 'RECRUITER';
  if (dmAllowed && !(role === 'RECRUITER' && activeUserIds.length === 0)) {
    let dq = db
      .from('messages')
      .select('id')
      .eq('recipient_id', req.user.id)
      .is('read_at', null)
      .is('deleted_at', null)
      .lt('created_at', new Date(now - 24 * HOUR).toISOString())
      .limit(100);
    if (role === 'RECRUITER') dq = dq.in('sender_id', activeUserIds);
    const dRes = await dq;
    if (dRes.error && !MISSING.test(dRes.error.message)) throw httpError(500, dRes.error.message);
    unreadDms = (dRes.data ?? []).length;
  }

  res.json({ interviews, offersExpiring, screeningStuck, unreadDms });
};
