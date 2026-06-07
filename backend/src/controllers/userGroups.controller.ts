import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError, ADMIN_TIER, canAssignRole, type Role } from '../types';
import { logger } from '../config/logger';
import { audit } from '../services/audit.service';

/**
 * Can the caller move/alter the target user's group?
 *
 *   SUPER_ADMIN              → anyone (absolute).
 *   Anyone → SUPER_ADMIN     → never (no one else may touch a SUPER_ADMIN).
 *   DEVELOPER + user_groups  → any user NOT in ADMIN_TIER and NOT DEVELOPER
 *                              (so HR_MANAGER, MANAGER, RECRUITER, CONSULTANT).
 *   CEO / CTO / DIRECTOR     → users they STRICTLY outrank and never a
 *                              SA-only role — exactly what canAssignRole encodes.
 *
 * The route gate already ensures the caller is ADMIN_TIER OR DEVELOPER+cap;
 * this is the per-target rank check the spec required.
 */
function canMoveUser(caller: { role: Role }, target: { role: Role }): boolean {
  if (caller.role === 'SUPER_ADMIN') return true;
  if (target.role === 'SUPER_ADMIN') return false;
  if (caller.role === 'DEVELOPER') {
    return !(ADMIN_TIER as Role[]).includes(target.role) && target.role !== 'DEVELOPER';
  }
  return canAssignRole(caller.role, target.role);
}

// 7-char hex color (e.g. "#6366F1"). Empty/missing is accepted and falls
// back to the column's server-side default at insert time.
const HEX_COLOR = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a 6-digit hex like #6366F1');

// Group logos live on the filesystem (storage shim). We persist only the storage
// PATH in user_groups.logo_path; the signed download URL is short-lived and
// minted per response by withLogoUrl. 24h TTL comfortably outlives any session
// (the frontend useUserGroups cache is per-session and the <img src> uses the
// URL for the life of the page).
const GROUP_LOGO_BUCKET = 'group-logos';
const LOGO_URL_TTL_SECONDS = 24 * 60 * 60;

/** True when a Postgres error means the logo_path column isn't migrated yet. */
function isLogoColumnMissing(message?: string): boolean {
  return !!message && /logo_path|schema cache|column .* does not exist/i.test(message);
}

/** Attach a fresh signed `logo_url` to a group row (null when it has no logo or
 *  signing fails). Mirrors messageAttachments' withSignedUrl. */
async function withLogoUrl<T extends { logo_path?: string | null }>(
  row: T,
): Promise<T & { logo_url: string | null }> {
  if (!row?.logo_path) return { ...row, logo_url: null };
  const { data } = await db.storage
    .from(GROUP_LOGO_BUCKET)
    .createSignedUrl(row.logo_path, LOGO_URL_TTL_SECONDS);
  return { ...row, logo_url: data?.signedUrl ?? null };
}

/** Translate Postgres errors that hint the migration is missing into a clear
 *  4xx instead of a bare 500 message. */
function migrationHint(err: { message?: string } | null | undefined) {
  if (!err?.message) return null;
  if (/user_groups|schema cache|relation .* does not exist|column .*group_id/i.test(err.message)) {
    return httpError(
      400,
      'user_groups schema not found — apply database/user-groups-and-presence.sql against the database first.',
    );
  }
  return null;
}

/** GET /user-groups/diag — quick health check. Tells you which migration
 *  bits exist according to PostgREST right now. Useful when "Failed to
 *  create" keeps appearing after running the migration. */
export const diag: RequestHandler = async (_req, res) => {
  const tableProbe = await db.from('user_groups').select('id', { count: 'exact', head: true });
  const columnProbe = await db.from('users').select('group_id', { head: true }).limit(1);
  const flagsProbe = await db
    .from('group_feature_flags')
    .select('group_id', { count: 'exact', head: true });
  res.json({
    user_groups_table: tableProbe.error
      ? { ok: false, error: tableProbe.error.message }
      : { ok: true, count: tableProbe.count },
    users_group_id_column: columnProbe.error
      ? { ok: false, error: columnProbe.error.message }
      : { ok: true },
    group_feature_flags_table: flagsProbe.error
      ? { ok: false, error: flagsProbe.error.message }
      : { ok: true, count: flagsProbe.count },
  });
};

/** GET /user-groups — list, with member count. Available to any signed-in user. */
export const list: RequestHandler = async (_req, res) => {
  const { data: groups, error } = await db.from('user_groups').select('*').order('name');
  if (error) {
    // Migration not applied yet — return empty list rather than 500 so the
    // admin page can show a "run the migration" hint instead of a hard error.
    if (/user_groups|schema cache|relation/i.test(error.message)) {
      res.json([]);
      return;
    }
    throw httpError(500, 'Database error');
  }
  // Member counts in a single query — guarded against the migration not yet
  // having added users.group_id (also non-fatal, counts just stay zero).
  const counts = new Map<string, number>();
  const { data: users, error: uErr } = await db
    .from('users')
    .select('group_id')
    .not('group_id', 'is', null);
  if (!uErr) {
    for (const u of users ?? []) counts.set(u.group_id, (counts.get(u.group_id) ?? 0) + 1);
  }
  // Mint a signed logo_url per group (parallel; best-effort). Groups without a
  // logo_path get logo_url: null and the badge falls back to the color dot.
  const withCounts = (groups ?? []).map((g: any) => ({
    ...g,
    member_count: counts.get(g.id) ?? 0,
  }));
  res.json(await Promise.all(withCounts.map((g: { logo_path?: string | null }) => withLogoUrl(g))));
};

/** POST /user-groups — manager+ only. */
export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({
    name: z.string().min(1).max(80),
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/i, 'lowercase letters, numbers and dashes')
      .min(1)
      .max(64),
    description: z.string().max(500).optional(),
    color: HEX_COLOR.optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  // Prevent duplicate names too (case-insensitive). Slug uniqueness is
  // enforced by the DB; this is a friendlier pre-check for the name.
  const { data: existingName } = await db
    .from('user_groups')
    .select('id')
    .ilike('name', parsed.data.name)
    .maybeSingle();
  if (existingName) {
    throw httpError(409, `A group named "${parsed.data.name}" already exists.`);
  }

  const { data, error } = await db
    .from('user_groups')
    .insert({ ...parsed.data, slug: parsed.data.slug.toLowerCase(), created_by: req.user.id })
    .select()
    .single();
  if (error) {
    // Log the raw error server-side so we can diagnose if the front-end
    // toast still doesn't make the cause obvious.

    logger.error({ err: error }, '[user_groups.create] database error');
    if (/duplicate key|unique/i.test(error.message)) {
      throw httpError(409, `A group with slug "${parsed.data.slug.toLowerCase()}" already exists.`);
    }
    if (/user_groups|schema cache|relation .* does not exist/i.test(error.message)) {
      throw httpError(
        400,
        'user_groups table not found. Apply database/user-groups-and-presence.sql against the database and try again.',
      );
    }
    // Surface the exact Postgres message — easier to diagnose than a fallback.
    throw httpError(500, `Database error: ${error.message} (code ${(error as any).code ?? '?'})`);
  }
  audit({
    action: 'group_created',
    user_id: req.user.id,
    email: req.user.email ?? null,
    req,
    metadata: {
      group_id: data.id,
      unique_group_id: data.unique_group_id,
      name: data.name,
      slug: data.slug,
    },
  });
  res.status(201).json(await withLogoUrl(data));
};

/** PATCH /user-groups/:id — rename / recolor / toggle. */
export const update: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(500).optional(),
    color: HEX_COLOR.optional(),
    is_active: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { data, error } = await db
    .from('user_groups')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) {
    const hint = migrationHint(error);
    if (hint) throw hint;
    throw httpError(404, error.message);
  }
  if (!data) throw httpError(404, 'Group not found');
  audit({
    action: 'group_updated',
    user_id: req.user.id,
    email: req.user.email ?? null,
    req,
    metadata: { group_id: data.id, changes: parsed.data },
  });
  res.json(await withLogoUrl(data));
};

/** DELETE /user-groups/:id — members fall back to null group via ON DELETE SET NULL. */
export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  // Snapshot for the audit row before we lose the data.
  const { data: before } = await db
    .from('user_groups')
    .select('id, unique_group_id, name')
    .eq('id', req.params.id)
    .maybeSingle();
  const { error } = await db.from('user_groups').delete().eq('id', req.params.id);
  if (error) {
    const hint = migrationHint(error);
    throw hint ?? httpError(500, 'Database error');
  }
  if (before) {
    audit({
      action: 'group_deleted',
      user_id: req.user.id,
      email: req.user.email ?? null,
      req,
      metadata: {
        group_id: before.id,
        unique_group_id: before.unique_group_id,
        name: before.name,
      },
    });
  }
  res.json({ ok: true });
};

/** PUT /user-groups/assign  body: { user_id, group_id }
 *  Assigns a single user to a group (or clears their group when group_id is null). */
export const assignOne: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({
    user_id: z.string().uuid(),
    group_id: z.string().uuid().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  // Pre-read so the audit row can record the transition direction AND so we
  // can rank-check the target. Rank check is critical: the route gate only
  // verifies the CALLER's tier — it doesn't stop a DIRECTOR from moving a
  // SUPER_ADMIN out of their group (which would be a privilege-escalation
  // surface via group-scoped overrides on flags, etc.).
  const { data: before } = await db
    .from('users')
    .select('id, email, role, group_id')
    .eq('id', parsed.data.user_id)
    .maybeSingle();
  if (!before) throw httpError(404, 'User not found');
  const target = before as {
    id: string;
    email: string | null;
    role: Role;
    group_id: string | null;
  };
  if (!canMoveUser(req.user, { role: target.role })) {
    throw httpError(403, `You cannot move a user with role ${target.role}.`);
  }

  // Validate the target group exists when one is supplied. Clearing a user's
  // group (group_id = null) skips this check by design.
  if (parsed.data.group_id) {
    const { data: grp } = await db
      .from('user_groups')
      .select('id')
      .eq('id', parsed.data.group_id)
      .maybeSingle();
    if (!grp) throw httpError(404, 'Target group not found');
  }

  const { error, data } = await db
    .from('users')
    .update({ group_id: parsed.data.group_id })
    .eq('id', parsed.data.user_id)
    .select('id, group_id')
    .single();
  if (error) {
    const hint = migrationHint(error);
    throw hint ?? httpError(500, 'Database error');
  }

  // Pick the action verb that best describes the transition:
  //   NULL    → group: assigned
  //   group   → NULL:  removed
  //   groupA  → groupB: moved
  //   same           : no-op (still log as assigned for forensics)
  const from = before?.group_id ?? null;
  const to = parsed.data.group_id;
  const action: 'group_user_assigned' | 'group_user_removed' | 'group_user_moved' =
    from === null && to !== null
      ? 'group_user_assigned'
      : from !== null && to === null
        ? 'group_user_removed'
        : 'group_user_moved';
  audit({
    action,
    user_id: parsed.data.user_id,
    email: before?.email ?? null,
    req,
    metadata: { from, to, by: req.user.id },
  });

  res.json(data);
};

/** PATCH /user-groups/:id/members  body: { user_ids: string[] }
 *  Bulk-assigns the listed users to this group (replacing any prior group). */
export const setMembers: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({ user_ids: z.array(z.string().uuid()) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  if (parsed.data.user_ids.length === 0) {
    res.json({ updated: 0 });
    return;
  }

  // Validate the target group exists. ("members" is a UI concept; the column
  // is users.group_id, so we need a real group id to write.)
  const { data: grp } = await db
    .from('user_groups')
    .select('id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!grp) throw httpError(404, 'Target group not found');

  // Per-user rank check. Load every target's role once and reject the whole
  // batch on the first violation — partial application would silently drop
  // SUPER_ADMIN protection from the others. Same canMoveUser used by assignOne.
  const { data: targets } = await db
    .from('users')
    .select('id, role')
    .in('id', parsed.data.user_ids);
  const rows = (targets ?? []) as { id: string; role: Role }[];
  if (rows.length !== parsed.data.user_ids.length) {
    throw httpError(404, 'One or more user_ids do not exist');
  }
  for (const t of rows) {
    if (!canMoveUser(req.user, { role: t.role })) {
      throw httpError(403, `You cannot move a user with role ${t.role}.`);
    }
  }

  const { error, count } = await db
    .from('users')
    .update({ group_id: req.params.id }, { count: 'exact' })
    .in('id', parsed.data.user_ids);
  if (error) {
    const hint = migrationHint(error);
    throw hint ?? httpError(500, 'Database error');
  }
  // One audit row per user — the activity log on each user's detail page
  // can then surface the bulk move alongside the rest of their history.
  for (const userId of parsed.data.user_ids) {
    audit({
      action: 'group_user_assigned',
      user_id: userId,
      req,
      metadata: { group_id: req.params.id, via: 'bulk_set_members', by: req.user.id },
    });
  }
  res.json({ updated: count ?? parsed.data.user_ids.length });
};

/** POST /user-groups/:id/logo — multipart { file }. Replaces any existing logo.
 *  Same admin gate as the other mutations (applied at the route). */
export const uploadLogo: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const groupId = req.params.id;

  const { data: grp, error: readErr } = await db
    .from('user_groups')
    .select('id, logo_path')
    .eq('id', groupId)
    .maybeSingle();
  if (readErr && isLogoColumnMissing(readErr.message)) {
    throw httpError(503, 'Logo storage not migrated yet — apply the user_groups_logo migration.');
  }
  if (!grp) throw httpError(404, 'Group not found');

  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) throw httpError(400, 'Missing file');

  // Remove the previous logo first (best-effort) so disk doesn't accumulate orphans.
  const prevPath = (grp as { logo_path?: string | null }).logo_path;
  if (prevPath) {
    await db.storage
      .from(GROUP_LOGO_BUCKET)
      .remove([prevPath])
      .catch(() => {});
  }

  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${groupId}/${Date.now()}-${safeName}`;
  const { error: upErr } = await db.storage
    .from(GROUP_LOGO_BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
  if (upErr) throw httpError(500, `Storage upload failed: ${upErr.message}`);

  const { data, error } = await db
    .from('user_groups')
    .update({ logo_path: path, updated_at: new Date().toISOString() })
    .eq('id', groupId)
    .select()
    .single();
  if (error || !data) {
    // Don't leave the just-uploaded file orphaned if the DB write failed.
    await db.storage
      .from(GROUP_LOGO_BUCKET)
      .remove([path])
      .catch(() => {});
    if (error && isLogoColumnMissing(error.message)) {
      throw httpError(503, 'Logo storage not migrated yet — apply the user_groups_logo migration.');
    }
    throw httpError(500, 'Database error');
  }

  audit({
    action: 'group_logo_updated',
    user_id: req.user.id,
    email: req.user.email ?? null,
    req,
    metadata: { group_id: groupId, op: 'set', file: file.originalname, size: file.buffer.length },
  });
  res.json(await withLogoUrl(data));
};

/** DELETE /user-groups/:id/logo — clears the logo (group reverts to its color dot). */
export const removeLogo: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const groupId = req.params.id;

  const { data: grp, error: readErr } = await db
    .from('user_groups')
    .select('id, logo_path')
    .eq('id', groupId)
    .maybeSingle();
  if (readErr && isLogoColumnMissing(readErr.message)) {
    throw httpError(503, 'Logo storage not migrated yet — apply the user_groups_logo migration.');
  }
  if (!grp) throw httpError(404, 'Group not found');

  const prevPath = (grp as { logo_path?: string | null }).logo_path;
  if (prevPath) {
    await db.storage
      .from(GROUP_LOGO_BUCKET)
      .remove([prevPath])
      .catch(() => {});
  }

  const { data, error } = await db
    .from('user_groups')
    .update({ logo_path: null, updated_at: new Date().toISOString() })
    .eq('id', groupId)
    .select()
    .single();
  if (error) {
    if (isLogoColumnMissing(error.message)) {
      throw httpError(503, 'Logo storage not migrated yet — apply the user_groups_logo migration.');
    }
    throw httpError(500, 'Database error');
  }

  audit({
    action: 'group_logo_updated',
    user_id: req.user.id,
    email: req.user.email ?? null,
    req,
    metadata: { group_id: groupId, op: 'remove' },
  });
  res.json(await withLogoUrl(data));
};
