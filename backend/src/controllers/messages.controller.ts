import { RequestHandler } from 'express';
import { z } from 'zod';
import { db, pool } from '../config/db';
import { httpError, OPERATOR_TIER } from '../types';
import {
  canMessageUser,
  canViewConversation,
  getAccessibleUserIds,
} from '../services/permission.service';
import { audit } from '../services/audit.service';
import { publishToUser } from '../services/realtime.service';
import { sendPushToUser } from '../services/push.service';
import {
  attachAttachments,
  claimAttachmentsForMessage,
  resolveReplyParents,
} from './messageAttachments.controller';

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

  // Single source of truth — the permission engine resolves who this user is
  // permitted to reach (admin-tier sees all active users; manager/HR sees their
  // recruiters + those recruiters' consultants; recruiter sees their assigned
  // managers + consultants; consultant sees only their assigned recruiter + that
  // recruiter's managers). Scope is STRICT assignment-only — there is no
  // reports-to fallback and no "we already have a thread so it's allowed" carve-
  // out. The directory and the per-endpoint canMessageUser() checks read the
  // same engine, so they can't drift.
  const peerIds = await getAccessibleUserIds({
    id: me.id,
    role: me.role,
    group_id: me.group_id ?? null,
  });
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
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

// ---------------------------------------------------------------------------
// Conversations — one row per other party (last message + unread count)
// ---------------------------------------------------------------------------

/** GET /messages/conversations */
export const conversations: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user.id;

  // Pull every NON-DELETED message I'm part of, newest first, then bucket
  // by other party. soft-deleted rows stay in the table for audit but
  // never reach the API.
  let { data, error } = await db
    .from('messages')
    .select(msgSelect())
    .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error && isSchemaError(error)) {
    downgrade();
    ({ data, error } = await db
      .from('messages')
      .select(msgSelect())
      .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
      .order('created_at', { ascending: false }));
  }
  if (error) throw httpError(500, 'Database error');

  const buckets = new Map<
    string,
    {
      peer: any;
      last_message: any;
      unread_count: number;
    }
  >();
  // SECURITY: a consultant never sees internal notes — skip them so they can't
  // surface as a last-message preview or bump the unread count. Robust to the
  // pre-migration state (is_internal undefined → not skipped → no notes exist).
  const hideInternal = req.user.role === 'CONSULTANT';
  for (const m of (data ?? []) as any[]) {
    if (hideInternal && m.is_internal) continue;
    const iAmSender = m.sender_id === me;
    const peer = iAmSender ? m.recipient : m.sender;
    if (!peer?.id) continue;
    if (!buckets.has(peer.id)) {
      buckets.set(peer.id, { peer, last_message: m, unread_count: 0 });
    }
    const b = buckets.get(peer.id)!;
    if (!iAmSender && !m.read_at) b.unread_count++;
  }
  // Embed attachments on each conversation's last_message so the
  // conversation list can render "📎 file.pdf" previews next to the body.
  const rows = Array.from(buckets.values()) as Array<{
    peer: { id: string };
    last_message: { id: string; created_at?: string };
    pinned?: boolean;
    archived?: boolean;
  }>;
  const lastMessages = rows.map((r) => r.last_message as { id: string });
  const withAtt = await attachAttachments(lastMessages);
  rows.forEach((r, i) => {
    r.last_message = withAtt[i] as { id: string; created_at?: string };
  });

  // Attach the caller's personal pin/archive state. Robust to the pre-migration
  // state: if conversation_states doesn't exist yet, everything is unpinned /
  // unarchived (the query errors → empty map → defaults).
  const byPeer = new Map<string, { pinned: boolean; archived: boolean }>();
  try {
    const { data: states, error: stErr } = await db
      .from('conversation_states')
      .select('peer_id, pinned, archived')
      .eq('user_id', me);
    if (!stErr) {
      for (const s of (states ?? []) as Array<{
        peer_id: string;
        pinned: boolean;
        archived: boolean;
      }>) {
        byPeer.set(s.peer_id, { pinned: !!s.pinned, archived: !!s.archived });
      }
    }
  } catch {
    /* table not migrated yet — leave all defaults */
  }
  for (const r of rows) {
    const st = byPeer.get(r.peer.id);
    r.pinned = st?.pinned ?? false;
    r.archived = st?.archived ?? false;
  }
  // Pinned conversations float to the top; within each group keep recency order.
  rows.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    const at = new Date(a.last_message?.created_at ?? 0).getTime();
    const bt = new Date(b.last_message?.created_at ?? 0).getTime();
    return bt - at;
  });
  res.json(rows);
};

/**
 * PATCH /messages/with/:userId/state — set the caller's personal pin/archive
 * state for a conversation. Self-scoped (user_id = caller); no data exposure,
 * so no canMessage gate. A partial PATCH merges onto the existing row.
 * Pre-migration the table is absent → silently no-ops so the UI never errors.
 */
export const setConversationState: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user.id;
  const peer = req.params.userId;
  if (!z.string().uuid().safeParse(peer).success || peer === me) {
    throw httpError(400, 'Invalid peer id');
  }
  const schema = z
    .object({ pinned: z.boolean().optional(), archived: z.boolean().optional() })
    .strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  try {
    const { rows: existing } = await pool.query(
      'select pinned, archived from public.conversation_states where user_id = $1 and peer_id = $2',
      [me, peer],
    );
    const cur = existing[0] ?? { pinned: false, archived: false };
    const pinned = parsed.data.pinned ?? cur.pinned;
    const archived = parsed.data.archived ?? cur.archived;
    await pool.query(
      `insert into public.conversation_states (user_id, peer_id, pinned, archived, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (user_id, peer_id) do update set pinned = $3, archived = $4, updated_at = now()`,
      [me, peer, pinned, archived],
    );
    res.json({ ok: true, pinned, archived });
  } catch {
    // Table not migrated yet — no-op so the inbox stays usable.
    res.json({
      ok: true,
      pinned: parsed.data.pinned ?? false,
      archived: parsed.data.archived ?? false,
    });
  }
};

/** GET /messages/unread-count */
export const unreadCount: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  // Exclude soft-deleted rows from the unread count so a retracted DM
  // doesn't leave a phantom badge on the recipient's nav. A consultant must
  // also never have an internal note counted — filter is_internal=false for
  // them, with a retry that drops the filter pre-migration (when the column
  // doesn't exist yet there are no internal notes, so the count is still right).
  const meId = req.user.id;
  const hideInternal = req.user.role === 'CONSULTANT';
  const base = () =>
    db
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_id', meId)
      .is('read_at', null)
      .is('deleted_at', null);
  let q = base();
  if (hideInternal) q = q.eq('is_internal', false);
  let { count, error } = await q;
  if (error && /is_internal|schema cache|column/i.test(error.message ?? '')) {
    ({ count, error } = await base());
  }
  if (error) throw httpError(500, 'Database error');
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
  // any thread by walking UUIDs (the original IDOR). canViewConversation is an
  // alias for canMessageUser — the SAME strict current-assignment rule as the
  // directory. There is no prior-thread carve-out: if a reassignment removes the
  // relationship, the in-flight thread is no longer readable (fail-closed).
  const allowed = await canViewConversation(
    { id: me, role: req.user.role, group_id: req.user.group_id ?? null },
    other,
  );
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
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error && isSchemaError(error)) {
    downgrade();
    ({ data, error } = await db
      .from('messages')
      .select(msgSelect())
      .or(filter)
      .is('deleted_at', null)
      .order('created_at', { ascending: true }));
  }
  if (error) throw httpError(500, 'Database error');
  // SECURITY: a consultant must never see an internal note. Filter server-side
  // (JS, not SQL) so it stays correct even before the is_internal column exists
  // — pre-migration `is_internal` is undefined → falsy → kept (no internal
  // notes exist yet anyway). Applied before attachment/reply resolution so an
  // internal note never even gets enriched for a consultant.
  let rows = (data ?? []) as Array<{ id: string; is_internal?: boolean }>;
  if (req.user.role === 'CONSULTANT') rows = rows.filter((m) => !m.is_internal);
  const withAttachments = await attachAttachments(rows as { id: string }[]);
  const withReplies = await resolveReplyParents(
    withAttachments as Array<{ id: string; reply_to_message_id?: string | null }>,
  );
  res.json(withReplies);
};

/**
 * GET /messages/with/:userId/context — lightweight peer context for the
 * conversation panel. Gated by canViewConversation (the SAME rule as the
 * thread), so a viewer only ever sees context for a peer they may message.
 * Returns the peer's most-recent application (with job + vendor) when the peer
 * is a consultant; { application: null } for a staff peer or when none exists.
 * Read-only and answer-narrow — no recruiter-side internal fields are exposed.
 */
export const conversationContext: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user.id;
  const other = req.params.userId;
  if (me === other) {
    res.json({ application: null });
    return;
  }
  const allowed = await canViewConversation(
    { id: me, role: req.user.role, group_id: req.user.group_id ?? null },
    other,
  );
  if (!allowed) throw httpError(403, 'You cannot view this conversation.');

  // Related work exposes application / job / company data. Restrict it to
  // OPERATOR_TIER viewers who can already see that data elsewhere — a DEVELOPER
  // can chat with everyone but has no business-data access by default, so it
  // must not leak the consultant roster's pipeline through this endpoint.
  if (!(OPERATOR_TIER as readonly string[]).includes(req.user.role)) {
    res.json({ application: null });
    return;
  }

  // Peer → consultant row (staff peers have none → no related work).
  const { data: consultant } = await db
    .from('consultants')
    .select('id')
    .eq('user_id', other)
    .maybeSingle();
  const consId = (consultant as { id?: string } | null)?.id;
  if (!consId) {
    res.json({ application: null });
    return;
  }

  // Latest application for that consultant — narrow, consultant-safe projection
  // (no recruiter_id / ats_score / internal notes).
  const { data, error } = await db
    .from('applications')
    .select(
      'id, status, submitted_at, job:jobs(id, title, company_name), vendor:vendors(id, company_name)',
    )
    .eq('consultant_id', consId)
    .order('submitted_at', { ascending: false })
    .limit(1);
  if (error) {
    res.json({ application: null });
    return;
  }
  res.json({ application: ((data ?? []) as unknown[])[0] ?? null });
};

/**
 * POST /messages/with/:userId/typing — emit a transient "the caller is
 * typing" SSE event to the peer. Fire-and-forget; no DB write, no audit.
 *
 * Authorization mirrors messages.send — without it any signed-in user could
 * spam typing indicators at arbitrary peers (effectively a low-grade
 * harassment + side-channel that reveals the peer is online).
 *
 * Client throttles itself (one POST per few seconds while text is being
 * entered); the recipient's UI auto-clears the indicator after a short
 * timeout, so a dropped "stop typing" never leaves the bubble stuck.
 */
export const typing: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const other = req.params.userId;
  if (other === req.user.id) {
    res.json({ ok: true });
    return;
  }
  const allowed = await canMessageUser(
    { id: req.user.id, role: req.user.role, group_id: req.user.group_id ?? null },
    other,
  );
  if (!allowed) throw httpError(403, 'You cannot message this user.');
  void publishToUser(other, 'message:typing', { from_user_id: req.user.id });
  res.json({ ok: true });
};

/** POST /messages/with/:userId/read — mark all messages FROM :userId as read */
export const markRead: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user.id;
  const other = req.params.userId;

  // A self-conversation can't exist (send blocks self), so marking your own
  // thread read is a clean no-op. Short-circuit before the permission engine —
  // canViewConversation returns false for self, which would otherwise yield a
  // spurious 403 + a misleading messages_permission_denied audit row. Mirrors
  // the self-guards in thread / typing / conversationContext.
  if (other === me) {
    res.json({ ok: true, read: 0 });
    return;
  }

  // Authorize. Closes the IDOR where any user could call this with any UUID
  // and silently mark the victim's outgoing messages as "read" on the
  // caller's inbox — a social-engineering vector even though the data
  // returned is empty.
  const allowed = await canViewConversation(
    { id: me, role: req.user.role, group_id: req.user.group_id ?? null },
    other,
  );
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

  // Atomically flip read_at on every previously-unread message FROM the
  // peer TO me. Returning the affected ids lets us push a precise
  // `message:read` SSE event to the peer so their sent-tick (✓✓ blue)
  // updates instantly instead of waiting for the next 60s poll.
  const readAt = new Date().toISOString();
  // A CONSULTANT must not mark internal notes read — they can't see them, and
  // doing so would flash a false "Read" tick to the staff sender. Exclude
  // is_internal for consultant markers, with a retry that drops the filter
  // pre-migration (when the column doesn't exist there are no internal notes).
  const hideInternal = req.user.role === 'CONSULTANT';
  const runMarkRead = (withInternalFilter: boolean) => {
    let u = db
      .from('messages')
      .update({ read_at: readAt })
      .eq('recipient_id', me)
      .eq('sender_id', other)
      .is('read_at', null)
      .is('deleted_at', null);
    if (withInternalFilter) u = u.neq('is_internal', true);
    return u.select('id');
  };
  let { data: affected, error } = await runMarkRead(hideInternal);
  if (error && hideInternal && /is_internal|schema cache|column/i.test(error.message ?? '')) {
    ({ data: affected, error } = await runMarkRead(false));
  }
  if (error) throw httpError(500, 'Database error');
  const affectedIds = (affected ?? []).map((r: { id: string }) => r.id).filter(Boolean);
  if (affectedIds.length > 0) {
    // Fan out to the PEER only — the marker (me) doesn't need its own
    // event since the markRead call itself is the local trigger.
    void publishToUser(other, 'message:read', {
      conversation_with: me,
      read_at: readAt,
      message_ids: affectedIds,
    });
  }
  res.json({ ok: true, read: affectedIds.length });
};

// ---------------------------------------------------------------------------
// Send a message
// ---------------------------------------------------------------------------

/** POST /messages — body: { recipient_id, body, attachment_ids? } */
export const send: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  // body may be empty when the message is purely an attachment, but we
  // need AT LEAST one of body / attachment_ids to be non-empty so the
  // composer can't submit a blank.
  const schema = z
    .object({
      recipient_id: z.string().uuid(),
      body: z.string().max(8000).optional().default(''),
      attachment_ids: z.array(z.string().uuid()).max(10).optional().default([]),
      // Optional parent for reply quoting. Must reference a message that
      // belongs to THIS pair (sender ↔ recipient) — enforced server-side
      // below, so a forged id from another conversation can't be quoted.
      reply_to_message_id: z.string().uuid().optional().nullable(),
      // Internal note: a staff-only annotation. Honoured only for non-consultant
      // senders (forced false below for a CONSULTANT) and never delivered to a
      // consultant recipient on any read path.
      is_internal: z.boolean().optional().default(false),
    })
    .refine((d) => d.body.trim().length > 0 || d.attachment_ids.length > 0, {
      message: 'Message body or at least one attachment is required',
    });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  if (parsed.data.recipient_id === req.user.id) {
    throw httpError(400, "Can't message yourself");
  }

  // Recipient must exist in public.users.
  const { data: recipient } = await db
    .from('users')
    .select('id, is_active, role')
    .eq('id', parsed.data.recipient_id)
    .maybeSingle();
  if (!recipient) throw httpError(404, 'Recipient not found');
  if (recipient.is_active === false) throw httpError(400, 'Recipient is inactive');

  // Internal note: staff-only. A CONSULTANT may never CREATE one (forced
  // false) and a CONSULTANT recipient may never RECEIVE one (the realtime
  // push below is suppressed; every read path filters them out server-side).
  const isInternal = parsed.data.is_internal === true && req.user.role !== 'CONSULTANT';
  const recipientIsConsultant = (recipient as { role?: string }).role === 'CONSULTANT';

  // Hierarchy-aware send authorization. Without this, any signed-in user
  // could POST a message to any other user (the original IDOR). The check
  // is server-side only — frontend filtering of the directory does NOT
  // protect against direct API calls.
  const allowed = await canMessageUser(
    { id: req.user.id, role: req.user.role, group_id: req.user.group_id ?? null },
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

  // Validate reply parent — it must exist in THIS conversation, otherwise
  // a forged id from another thread could be quoted (information leak via
  // the embedded sender/body in the reply preview). null/undefined means
  // "no reply" which is the common case.
  let replyToId: string | null = null;
  if (parsed.data.reply_to_message_id) {
    const filter =
      `and(sender_id.eq.${req.user.id},recipient_id.eq.${parsed.data.recipient_id}),` +
      `and(sender_id.eq.${parsed.data.recipient_id},recipient_id.eq.${req.user.id})`;
    const { data: parent } = await db
      .from('messages')
      .select('id')
      .eq('id', parsed.data.reply_to_message_id)
      .or(filter)
      .maybeSingle();
    if (!parent) throw httpError(400, 'reply_to_message_id is not in this conversation');
    replyToId = parsed.data.reply_to_message_id;
  }

  // Insert first (no embed) so we get the row id, then fetch with the embed.
  // Two-step avoids the failure mode where the embed errors and we lose the
  // insert's returning id.
  const insertRow: Record<string, unknown> = {
    sender_id: req.user.id,
    recipient_id: parsed.data.recipient_id,
    body: parsed.data.body.trim(),
  };
  if (replyToId) insertRow.reply_to_message_id = replyToId;
  if (isInternal) insertRow.is_internal = true;
  let { data: inserted, error: insErr } = await db
    .from('messages')
    .insert(insertRow)
    .select('id')
    .single();
  // Schema lag: reply_to_message_id (1754000000000) or is_internal
  // (1755000000000) may not exist on a DB that hasn't run those migrations
  // yet. Strip the late-arrival columns and retry so a body-only send still
  // works before the migration lands.
  if (insErr && /reply_to_message_id|is_internal|schema cache/i.test(insErr.message ?? '')) {
    // SECURITY: never silently downgrade an internal note destined for a
    // consultant into a plain, consultant-visible DM (the deploy-ahead-of-
    // migration window). Reject so the staff user isn't misled by the amber
    // "only staff will see this" composer.
    if (isInternal && recipientIsConsultant) {
      throw httpError(
        503,
        'Internal notes are temporarily unavailable — please try again shortly.',
      );
    }
    delete insertRow.reply_to_message_id;
    delete insertRow.is_internal;
    ({ data: inserted, error: insErr } = await db
      .from('messages')
      .insert(insertRow)
      .select('id')
      .single());
  }
  if (insErr || !inserted) throw httpError(500, insErr?.message ?? 'Insert failed');

  // Claim any pre-uploaded attachments by linking them to this new message.
  // claimAttachmentsForMessage is permission-checked (uploaded_by + recipient
  // + still-orphan), so a forged id can't smuggle someone else's file onto
  // this thread. Failures here are silently swallowed inside the helper —
  // we'd rather ship the message body than fail the whole send because
  // one attachment id was bogus.
  if (parsed.data.attachment_ids.length > 0) {
    await claimAttachmentsForMessage({
      attachmentIds: parsed.data.attachment_ids,
      messageId: inserted.id,
      senderId: req.user.id,
      recipientId: parsed.data.recipient_id,
    });
  }

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
  if (error) throw httpError(500, 'Database error');

  // Embed attachments + reply-parent preview on the returned message
  // so the SSE payload + the POST response both carry the renderable
  // shape the frontend bubble expects.
  const [withAtt] = await attachAttachments([data as { id: string }]);
  const [withReply] = await resolveReplyParents([
    withAtt as { id: string; reply_to_message_id?: string | null },
  ]);

  // Fan out to both ends. Recipient gets the message:new event for inbox /
  // active-thread updates; sender gets it too so a second tab on the
  // sender's side mirrors the new message without a poll cycle.
  //
  // SECURITY: an internal note must never reach a consultant — suppress the
  // recipient push when the note is internal and the recipient is a consultant
  // (mirrors the read-path filtering). The staff sender still gets the echo.
  if (!(isInternal && recipientIsConsultant)) {
    void publishToUser(parsed.data.recipient_id, 'message:new', withReply);
    // Hard push to the recipient's devices. Same internal-note guard as above.
    const senderName =
      (withReply as { sender?: { full_name?: string } }).sender?.full_name ?? 'New message';
    void sendPushToUser(parsed.data.recipient_id, {
      title: senderName,
      body: parsed.data.body.trim().slice(0, 140) || 'Sent an attachment',
      data: { type: 'message', peer_id: req.user!.id },
    });
  }
  void publishToUser(req.user.id, 'message:new', withReply);
  res.status(201).json(withReply);
};

// ---------------------------------------------------------------------------
// Sender-initiated retract + edit. Both gated to the sender of the message
// being modified — other roles 403. Soft-delete sets deleted_at; the row
// stays in the table for compliance, but every API surface filters it out.
// ---------------------------------------------------------------------------

/** DELETE /messages/:id — sender retracts. */
export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { id } = req.params;

  // Only the sender can retract. We check this server-side and use a
  // composite WHERE so a race condition (or a forged id) can't flip a
  // message we don't own.
  const { data: updated, error } = await db
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('sender_id', req.user.id)
    .is('deleted_at', null)
    .select('id, sender_id, recipient_id')
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');
  if (!updated) {
    // Either the row doesn't exist, isn't ours, or was already deleted.
    // All three should look identical to a caller to avoid an oracle.
    throw httpError(404, 'Message not found');
  }
  // Fan out the delete event to both parties so the message disappears
  // from every open tab instantly — no 60s poll wait.
  const u = updated as { id: string; sender_id: string; recipient_id: string };
  void publishToUser(u.recipient_id, 'message:deleted', { id: u.id });
  void publishToUser(u.sender_id, 'message:deleted', { id: u.id });
  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// Contacts allowed — permission-filtered contact list with relationship labels
// ---------------------------------------------------------------------------

/**
 * GET /messages/contacts/allowed?q=
 *
 * Returns users this caller is permitted to message, optionally filtered by a
 * search string, each annotated with a human-readable `relationship` label
 * ("Your assigned consultant", "Your manager", "Peer recruiter", etc.).
 *
 * Used by the contact picker so the UI never shows users the caller can't reach.
 * The server enforces the same check on POST /messages — this endpoint is purely
 * for pre-filtering the UI and must never be trusted as the sole auth gate.
 */
export const contactsAllowed: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user;
  const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase().trim() : '';

  const peerIds = await getAccessibleUserIds({
    id: me.id,
    role: me.role,
    group_id: me.group_id ?? null,
  });
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
  if (error) throw httpError(500, 'Database error');

  const users = (data ?? []) as Array<{
    id: string;
    email: string;
    full_name?: string | null;
    role?: string | null;
    last_seen_at?: string | null;
    group_id?: string | null;
  }>;

  // Apply search filter
  const filtered = q
    ? users.filter((u) => {
        const name = (u.full_name ?? u.email ?? '').toLowerCase();
        return name.includes(q);
      })
    : users;

  // Annotate with relationship label based on role pairing (lightweight, no DB join)
  const result = filtered.map((u) => ({
    ...u,
    relationship: relationshipLabel(me.role, u.role ?? ''),
  }));

  res.json(result);
};

/** Map (callerRole, targetRole) → a human-readable relationship hint. */
function relationshipLabel(callerRole: string, targetRole: string): string {
  if (targetRole === 'DEVELOPER') return 'Support & Engineering';
  if (callerRole === 'CONSULTANT') return 'Your recruiter';
  if (callerRole === 'RECRUITER') {
    if (targetRole === 'CONSULTANT') return 'Your assigned consultant';
    if (['MANAGER', 'HR_MANAGER', 'DIRECTOR', 'CTO', 'CEO', 'SUPER_ADMIN'].includes(targetRole))
      return 'Your manager';
    if (targetRole === 'RECRUITER') return 'Peer recruiter';
  }
  if (['MANAGER', 'HR_MANAGER'].includes(callerRole)) {
    if (targetRole === 'CONSULTANT') return 'Group consultant';
    if (targetRole === 'RECRUITER') return 'Your recruiter';
    if (['MANAGER', 'HR_MANAGER', 'DIRECTOR', 'CTO', 'CEO'].includes(targetRole))
      return 'Peer manager';
  }
  if (['DIRECTOR', 'CTO', 'CEO', 'SUPER_ADMIN'].includes(callerRole)) return 'Team member';
  return 'Contact';
}

/** PATCH /messages/:id — sender edits the body. */
export const edit: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({ body: z.string().min(1).max(8000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const { data, error } = await db
    .from('messages')
    .update({
      body: parsed.data.body.trim(),
      edited_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('sender_id', req.user.id)
    .is('deleted_at', null)
    .select(msgSelect())
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');
  if (!data) throw httpError(404, 'Message not found');
  // Push the edited body to both ends so live tabs reflect the update.
  // SECURITY: mirror send() — never push an internal note to a consultant
  // recipient (the SSE payload carries the note body + is_internal). The staff
  // sender's echo is unaffected.
  const m = data as {
    recipient_id: string;
    sender_id: string;
    is_internal?: boolean;
    recipient?: { role?: string } | null;
  };
  if (!(m.is_internal && m.recipient?.role === 'CONSULTANT')) {
    void publishToUser(m.recipient_id, 'message:edited', data);
  }
  void publishToUser(m.sender_id, 'message:edited', data);
  res.json(data);
};
