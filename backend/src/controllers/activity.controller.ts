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
    if (error) throw httpError(500, error.message);
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
