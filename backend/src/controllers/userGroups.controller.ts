import { RequestHandler } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { httpError } from '../types';

/** Translate Postgres errors that hint the migration is missing into a clear
 *  4xx instead of a bare 500 message. */
function migrationHint(err: { message?: string } | null | undefined) {
  if (!err?.message) return null;
  if (/user_groups|schema cache|relation .* does not exist|column .*group_id/i.test(err.message)) {
    return httpError(400, 'user_groups schema not found — apply database/user-groups-and-presence.sql in Supabase first.');
  }
  return null;
}

/** GET /user-groups/diag — quick health check. Tells you which migration
 *  bits exist according to PostgREST right now. Useful when "Failed to
 *  create" keeps appearing after running the migration. */
export const diag: RequestHandler = async (_req, res) => {
  const tableProbe = await supabaseAdmin.from('user_groups').select('id', { count: 'exact', head: true });
  const columnProbe = await supabaseAdmin.from('users').select('group_id', { head: true }).limit(1);
  const flagsProbe = await supabaseAdmin.from('group_feature_flags').select('group_id', { count: 'exact', head: true });
  res.json({
    user_groups_table: tableProbe.error ? { ok: false, error: tableProbe.error.message } : { ok: true, count: tableProbe.count },
    users_group_id_column: columnProbe.error ? { ok: false, error: columnProbe.error.message } : { ok: true },
    group_feature_flags_table: flagsProbe.error ? { ok: false, error: flagsProbe.error.message } : { ok: true, count: flagsProbe.count },
  });
};

/** GET /user-groups — list, with member count. Available to any signed-in user. */
export const list: RequestHandler = async (_req, res) => {
  const { data: groups, error } = await supabaseAdmin
    .from('user_groups').select('*').order('name');
  if (error) {
    // Migration not applied yet — return empty list rather than 500 so the
    // admin page can show a "run the migration" hint instead of a hard error.
    if (/user_groups|schema cache|relation/i.test(error.message)) { res.json([]); return; }
    throw httpError(500, error.message);
  }
  // Member counts in a single query — guarded against the migration not yet
  // having added users.group_id (also non-fatal, counts just stay zero).
  const counts = new Map<string, number>();
  const { data: users, error: uErr } = await supabaseAdmin
    .from('users').select('group_id').not('group_id', 'is', null);
  if (!uErr) {
    for (const u of users ?? []) counts.set(u.group_id, (counts.get(u.group_id) ?? 0) + 1);
  }
  res.json((groups ?? []).map((g: any) => ({ ...g, member_count: counts.get(g.id) ?? 0 })));
};

/** POST /user-groups — manager+ only. */
export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({
    name: z.string().min(1).max(80),
    slug: z.string().regex(/^[a-z0-9-]+$/i, 'lowercase letters, numbers and dashes').min(1).max(64),
    description: z.string().max(500).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const { data, error } = await supabaseAdmin
    .from('user_groups')
    .insert({ ...parsed.data, slug: parsed.data.slug.toLowerCase(), created_by: req.user.id })
    .select().single();
  if (error) {
    // Log the raw error server-side so we can diagnose if the front-end
    // toast still doesn't make the cause obvious.
    // eslint-disable-next-line no-console
    console.error('[user_groups.create] supabase error:', error);
    if (/duplicate key|unique/i.test(error.message)) {
      throw httpError(409, `A group with slug "${parsed.data.slug.toLowerCase()}" already exists.`);
    }
    if (/user_groups|schema cache|relation .* does not exist/i.test(error.message)) {
      throw httpError(400, 'user_groups table not found in PostgREST schema cache. Apply database/user-groups-and-presence.sql in Supabase (it ends with NOTIFY pgrst, \'reload schema\') and try again.');
    }
    // Surface the exact Postgres message — easier to diagnose than a fallback.
    throw httpError(500, `Supabase error: ${error.message} (code ${(error as any).code ?? '?'})`);
  }
  res.status(201).json(data);
};

/** PATCH /user-groups/:id — rename / toggle. */
export const update: RequestHandler = async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(500).optional(),
    is_active: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { data, error } = await supabaseAdmin
    .from('user_groups').update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) {
    const hint = migrationHint(error);
    if (hint) throw hint;
    throw httpError(404, error.message);
  }
  if (!data) throw httpError(404, 'Group not found');
  res.json(data);
};

/** DELETE /user-groups/:id — members fall back to null group via ON DELETE SET NULL. */
export const remove: RequestHandler = async (req, res) => {
  const { error } = await supabaseAdmin.from('user_groups').delete().eq('id', req.params.id);
  if (error) {
    const hint = migrationHint(error);
    throw hint ?? httpError(500, error.message);
  }
  res.json({ ok: true });
};

/** PUT /user-groups/assign  body: { user_id, group_id }
 *  Assigns a single user to a group (or clears their group when group_id is null). */
export const assignOne: RequestHandler = async (req, res) => {
  const schema = z.object({
    user_id: z.string().uuid(),
    group_id: z.string().uuid().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { error, data } = await supabaseAdmin
    .from('users').update({ group_id: parsed.data.group_id })
    .eq('id', parsed.data.user_id).select('id, group_id').single();
  if (error) {
    const hint = migrationHint(error);
    throw hint ?? httpError(500, error.message);
  }
  res.json(data);
};

/** PATCH /user-groups/:id/members  body: { user_ids: string[] }
 *  Bulk-assigns the listed users to this group (replacing any prior group). */
export const setMembers: RequestHandler = async (req, res) => {
  const schema = z.object({ user_ids: z.array(z.string().uuid()) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  if (parsed.data.user_ids.length === 0) { res.json({ updated: 0 }); return; }
  const { error, count } = await supabaseAdmin
    .from('users').update({ group_id: req.params.id }, { count: 'exact' })
    .in('id', parsed.data.user_ids);
  if (error) {
    const hint = migrationHint(error);
    throw hint ?? httpError(500, error.message);
  }
  res.json({ updated: count ?? parsed.data.user_ids.length });
};
