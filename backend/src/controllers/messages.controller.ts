import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError, MANAGER_TIER } from '../types';
import { canMessageUser, canViewConversation } from '../services/permission.service';
import { audit } from '../services/audit.service';

// Build the SELECT lazily so we can downgrade to a legacy column set the first
// time we see "column doesn't exist" — that way the endpoints work both before
// and after database/user-groups-and-presence.sql has been applied.
const PARTY_COLS_FULL = 'id, email, full_name, role, last_seen_at, group_id';
const PARTY_COLS_LEGACY = 'id, email, full_name, role';
let partyCols: string = PARTY_COLS_FULL;
function partySelect(): string {
  return partyCols;
}
function msgSelect(): string {
  return (
    '*, sender:users!sender_id(' + partyCols + '), recipient:users!recipient_id(' + partyCols + ')'
  );
}
function isSchemaError(err: { message?: string } | null | undefined): boolean {
  if (!err?.message) return false;
  return /last_seen_at|group_id/.test(err.message) && /schema cache|column/i.test(err.message);
}
function downgrade() {
  partyCols = PARTY_COLS_LEGACY;
}

function isManagerTier(role: string | undefined): boolean {
  return !!role && (MANAGER_TIER as string[]).includes(role);
}

// ---------------------------------------------------------------------------
// Chat directory — who the calling user should see as suggested contacts
// ---------------------------------------------------------------------------

/**
 * GET /messages/directory
 *
 * Returns the set of users the caller would typically want to chat with based
 * on their org relationships. Used to populate the "Start new chat" picker.
 */
export const directory: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user;

  // Manager-tier sees everyone in the workspace.
  if (isManagerTier(me.role)) {
    let { data, error } = await db
      .from('users')
      .select(partySelect())
      .neq('id', me.id)
      .order('full_name');
    if (error && isSchemaError(error)) {
      downgrade();
      ({ data, error } = await db
        .from('users')
        .select(partySelect())
        .neq('id', me.id)
        .order('full_name'));
    }
    if (error) throw httpError(500, error.message);
    res.json(data);
    return;
  }

  const peerIds = new Set<string>();

  // Consultant → their recruiter (consultant.recruiter_id → recruiters.user_id).
  // Recruiter → their consultants + their manager.
  const { data: myConsultant } = await db
    .from('consultants')
    .select('recruiter_id')
    .eq('user_id', me.id)
    .maybeSingle();
  if (myConsultant?.recruiter_id) {
    const { data: rec } = await db
      .from('recruiters')
      .select('user_id')
      .eq('id', myConsultant.recruiter_id)
      .maybeSingle();
    if (rec?.user_id) peerIds.add(rec.user_id);
  }

  const { data: myRecruiter } = await db
    .from('recruiters')
    .select('id, manager_id')
    .eq('user_id', me.id)
    .maybeSingle();
  if (myRecruiter) {
    if (myRecruiter.manager_id) peerIds.add(myRecruiter.manager_id);
    const { data: cons } = await db
      .from('consultants')
      .select('user_id')
      .eq('recruiter_id', myRecruiter.id);
    for (const c of cons ?? []) if (c.user_id) peerIds.add(c.user_id);
  }

  // Reports-to chain (either direction).
  const { data: meUser } = await db
    .from('users')
    .select('reports_to')
    .eq('id', me.id)
    .maybeSingle();
  if (meUser?.reports_to) peerIds.add(meUser.reports_to);
  const { data: directReports } = await db.from('users').select('id').eq('reports_to', me.id);
  for (const u of directReports ?? []) peerIds.add(u.id);

  // Always include anyone the caller has already messaged with.
  const { data: existing } = await db
    .from('messages')
    .select('sender_id, recipient_id')
    .or(`sender_id.eq.${me.id},recipient_id.eq.${me.id}`);
  for (const m of existing ?? []) {
    if (m.sender_id !== me.id) peerIds.add(m.sender_id);
    if (m.recipient_id !== me.id) peerIds.add(m.recipient_id);
  }

  if (peerIds.size === 0) {
    res.json([]);
    return;
  }
  let { data, error } = await db
    .from('users')
    .select(partySelect())
    .in('id', Array.from(peerIds))
    .order('full_name');
  if (error && isSchemaError(error)) {
    downgrade();
    ({ data, error } = await db
      .from('users')
      .select(partySelect())
      .in('id', Array.from(peerIds))
      .order('full_name'));
  }
  if (error) throw httpError(500, error.message);
  res.json(data);
};

// ---------------------------------------------------------------------------
// Conversations — one row per other party (last message + unread count)
// ---------------------------------------------------------------------------

/** GET /messages/conversations */
export const conversations: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user.id;

  // Pull every message I'm part of, newest first, then bucket by other party.
  let { data, error } = await db
    .from('messages')
    .select(msgSelect())
    .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
    .order('created_at', { ascending: false });
  if (error && isSchemaError(error)) {
    downgrade();
    ({ data, error } = await db
      .from('messages')
      .select(msgSelect())
      .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
      .order('created_at', { ascending: false }));
  }
  if (error) throw httpError(500, error.message);

  const buckets = new Map<
    string,
    {
      peer: any;
      last_message: any;
      unread_count: number;
    }
  >();
  for (const m of (data ?? []) as any[]) {
    const iAmSender = m.sender_id === me;
    const peer = iAmSender ? m.recipient : m.sender;
    if (!peer?.id) continue;
    if (!buckets.has(peer.id)) {
      buckets.set(peer.id, { peer, last_message: m, unread_count: 0 });
    }
    const b = buckets.get(peer.id)!;
    if (!iAmSender && !m.read_at) b.unread_count++;
  }
  res.json(Array.from(buckets.values()));
};

/** GET /messages/unread-count */
export const unreadCount: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { count, error } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('recipient_id', req.user.id)
    .is('read_at', null);
  if (error) throw httpError(500, error.message);
  res.json({ unread: count ?? 0 });
};

// ---------------------------------------------------------------------------
// Single thread between caller and :userId
// ---------------------------------------------------------------------------

/** GET /messages/with/:userId */
export const thread: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user.id;
  const other = req.params.userId;
  if (me === other) throw httpError(400, "Can't chat with yourself");

  // Authorize the thread fetch. Without this, any signed-in user could read
  // any thread by walking UUIDs (the original IDOR). canViewConversation
  // applies the same hierarchy rules as the directory + lets prior-thread
  // legitimacy carry over so reassignments don't kill in-flight chats.
  const allowed = await canViewConversation({ id: me, role: req.user.role }, other);
  if (!allowed) {
    audit({
      action: 'messages_permission_denied',
      user_id: me,
      email: req.user.email ?? null,
      req,
      metadata: { route: 'thread', peer: other },
    });
    throw httpError(403, 'You cannot view this conversation.');
  }

  const filter =
    `and(sender_id.eq.${me},recipient_id.eq.${other}),` +
    `and(sender_id.eq.${other},recipient_id.eq.${me})`;
  let { data, error } = await db
    .from('messages')
    .select(msgSelect())
    .or(filter)
    .order('created_at', { ascending: true });
  if (error && isSchemaError(error)) {
    downgrade();
    ({ data, error } = await db
      .from('messages')
      .select(msgSelect())
      .or(filter)
      .order('created_at', { ascending: true }));
  }
  if (error) throw httpError(500, error.message);
  res.json(data ?? []);
};

/** POST /messages/with/:userId/read — mark all messages FROM :userId as read */
export const markRead: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user.id;
  const other = req.params.userId;

  // Authorize. Closes the IDOR where any user could call this with any UUID
  // and silently mark the victim's outgoing messages as "read" on the
  // caller's inbox — a social-engineering vector even though the data
  // returned is empty.
  const allowed = await canViewConversation({ id: me, role: req.user.role }, other);
  if (!allowed) {
    audit({
      action: 'messages_permission_denied',
      user_id: me,
      email: req.user.email ?? null,
      req,
      metadata: { route: 'markRead', peer: other },
    });
    throw httpError(403, 'You cannot mark this conversation as read.');
  }

  const { error } = await db
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', me)
    .eq('sender_id', other)
    .is('read_at', null);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// Send a message
// ---------------------------------------------------------------------------

/** POST /messages — body: { recipient_id, body } */
export const send: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({
    recipient_id: z.string().uuid(),
    body: z.string().min(1).max(8000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  if (parsed.data.recipient_id === req.user.id) {
    throw httpError(400, "Can't message yourself");
  }

  // Recipient must exist in public.users.
  const { data: recipient } = await db
    .from('users')
    .select('id, is_active')
    .eq('id', parsed.data.recipient_id)
    .maybeSingle();
  if (!recipient) throw httpError(404, 'Recipient not found');
  if (recipient.is_active === false) throw httpError(400, 'Recipient is inactive');

  // Hierarchy-aware send authorization. Without this, any signed-in user
  // could POST a message to any other user (the original IDOR). The check
  // is server-side only — frontend filtering of the directory does NOT
  // protect against direct API calls.
  const allowed = await canMessageUser(
    { id: req.user.id, role: req.user.role },
    parsed.data.recipient_id,
  );
  if (!allowed) {
    audit({
      action: 'messages_permission_denied',
      user_id: req.user.id,
      email: req.user.email ?? null,
      req,
      metadata: { route: 'send', recipient: parsed.data.recipient_id },
    });
    throw httpError(403, 'You cannot message this user.');
  }

  // Insert first (no embed) so we get the row id, then fetch with the embed.
  // Two-step avoids the failure mode where the embed errors and we lose the
  // insert's returning id.
  const { data: inserted, error: insErr } = await db
    .from('messages')
    .insert({
      sender_id: req.user.id,
      recipient_id: parsed.data.recipient_id,
      body: parsed.data.body.trim(),
    })
    .select('id')
    .single();
  if (insErr || !inserted) throw httpError(500, insErr?.message ?? 'Insert failed');

  let { data, error } = await db
    .from('messages')
    .select(msgSelect())
    .eq('id', inserted.id)
    .single();
  if (error && isSchemaError(error)) {
    downgrade();
    ({ data, error } = await db
      .from('messages')
      .select(msgSelect())
      .eq('id', inserted.id)
      .single());
  }
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};
