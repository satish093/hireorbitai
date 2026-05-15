import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError } from '../types';

const SELECT_WITH_JOINS =
  '*, user:users!user_id(id, email, full_name), ' +
  'manager:users!manager_id(id, email, full_name), ' +
  'managers:recruiter_managers(is_primary, assigned_at, manager:users!manager_id(id, email, full_name, role))';

const onboardingSchema = z.object({
  // Personal details — write through to public.users on the same row.
  full_name: z.string().min(1).optional(),
  phone: z.string().optional(),
  // Recruiter-row fields.
  team: z.string().optional(),
  target_submissions_per_week: z.number().int().min(0).optional(),
  manager_id: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export const list: RequestHandler = async (_req, res) => {
  const { data, error } = await db
    .from('recruiters')
    .select(SELECT_WITH_JOINS)
    .order('created_at', { ascending: false });
  // The new `recruiter_managers` table may not exist yet — degrade gracefully
  // by retrying with the simpler embed.
  if (error && /recruiter_managers/i.test(error.message)) {
    const fallback = await db
      .from('recruiters')
      .select(
        '*, user:users!user_id(id, email, full_name), manager:users!manager_id(id, email, full_name)',
      )
      .order('created_at', { ascending: false });
    if (fallback.error) throw httpError(500, fallback.error.message);
    res.json(fallback.data);
    return;
  }
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const get: RequestHandler = async (req, res) => {
  const { data, error } = await db
    .from('recruiters')
    .select(SELECT_WITH_JOINS + ', phone, avatar_url')
    .eq('id', req.params.id)
    .single();
  if (error && /recruiter_managers/i.test(error.message)) {
    const fb = await db
      .from('recruiters')
      .select(
        '*, user:users!user_id(id, email, full_name, phone, avatar_url), manager:users!manager_id(id, email, full_name)',
      )
      .eq('id', req.params.id)
      .single();
    if (fb.error) throw httpError(404, fb.error.message);
    res.json(fb.data);
    return;
  }
  if (error) throw httpError(404, error.message);
  res.json(data);
};

export const onboard: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const { full_name, phone, ...recruiterRow } = parsed.data;

  const userPatch: Record<string, unknown> = {};
  if (full_name !== undefined) userPatch.full_name = full_name;
  if (phone !== undefined) userPatch.phone = phone;
  if (Object.keys(userPatch).length > 0) {
    const { error: uErr } = await db.from('users').update(userPatch).eq('id', req.user.id);
    if (uErr) throw httpError(500, uErr.message);
  }

  const { data, error } = await db
    .from('recruiters')
    .upsert({ user_id: req.user.id, ...recruiterRow }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

// ---------------------------------------------------------------------------
// Manager assignments — many-to-many via recruiter_managers (with fallback)
// ---------------------------------------------------------------------------

/**
 * Detect the "schema cache" / "relation does not exist" error from PostgREST
 * that fires when the recruiter_managers migration hasn't been applied yet.
 */
function junctionMissing(message: string | undefined): boolean {
  if (!message) return false;
  return (
    /recruiter_managers/i.test(message) &&
    /schema cache|relation .* does not exist|column/i.test(message)
  );
}

export const addManager: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({
    manager_id: z.string().uuid(),
    is_primary: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const recruiterId = req.params.id;

  const { data: rec } = await db
    .from('recruiters')
    .select('id')
    .eq('id', recruiterId)
    .maybeSingle();
  if (!rec) throw httpError(404, 'Recruiter not found');

  const { data: target } = await db
    .from('users')
    .select('id, role')
    .eq('id', parsed.data.manager_id)
    .maybeSingle();
  if (!target) throw httpError(404, 'Manager user not found');

  // Probe whether the junction table exists.
  const { data: existing, error: existErr } = await db
    .from('recruiter_managers')
    .select('manager_id, is_primary')
    .eq('recruiter_id', recruiterId);

  if (junctionMissing(existErr?.message)) {
    // Pre-migration fallback: single-manager only — overwrite recruiters.manager_id.
    const { data, error } = await db
      .from('recruiters')
      .update({ manager_id: parsed.data.manager_id })
      .eq('id', recruiterId)
      .select()
      .single();
    if (error) throw httpError(500, error.message);
    res.status(201).json({
      ...data,
      _degraded:
        'recruiter_managers table not migrated — one supervisor at a time. Run database/recruiter-managers.sql for multi-manager support.',
    });
    return;
  }
  if (existErr) throw httpError(500, existErr.message);

  const wantPrimary = parsed.data.is_primary === true || (existing ?? []).length === 0;
  if (wantPrimary) {
    await db
      .from('recruiter_managers')
      .update({ is_primary: false })
      .eq('recruiter_id', recruiterId);
  }

  const { data, error } = await db
    .from('recruiter_managers')
    .upsert(
      {
        recruiter_id: recruiterId,
        manager_id: parsed.data.manager_id,
        is_primary: wantPrimary,
        assigned_by: req.user.id,
      },
      { onConflict: 'recruiter_id,manager_id' },
    )
    .select()
    .single();
  if (error) throw httpError(500, error.message);

  if (wantPrimary) {
    await db
      .from('recruiters')
      .update({ manager_id: parsed.data.manager_id })
      .eq('id', recruiterId);
  }
  res.status(201).json(data);
};

export const removeManager: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const recruiterId = req.params.id;
  const managerId = req.params.managerId;

  const { data: removed, error: lookupErr } = await db
    .from('recruiter_managers')
    .select('is_primary')
    .eq('recruiter_id', recruiterId)
    .eq('manager_id', managerId)
    .maybeSingle();

  if (junctionMissing(lookupErr?.message)) {
    // Pre-migration fallback — clear recruiters.manager_id only if it matches.
    await db
      .from('recruiters')
      .update({ manager_id: null })
      .eq('id', recruiterId)
      .eq('manager_id', managerId);
    res.json({ ok: true, _degraded: true });
    return;
  }

  const { error } = await db
    .from('recruiter_managers')
    .delete()
    .eq('recruiter_id', recruiterId)
    .eq('manager_id', managerId);
  if (error) throw httpError(500, error.message);

  if (removed?.is_primary) {
    const { data: next } = await db
      .from('recruiter_managers')
      .select('manager_id')
      .eq('recruiter_id', recruiterId)
      .order('assigned_at')
      .limit(1)
      .maybeSingle();
    if (next?.manager_id) {
      await db
        .from('recruiter_managers')
        .update({ is_primary: true })
        .eq('recruiter_id', recruiterId)
        .eq('manager_id', next.manager_id);
      await db.from('recruiters').update({ manager_id: next.manager_id }).eq('id', recruiterId);
    } else {
      await db.from('recruiters').update({ manager_id: null }).eq('id', recruiterId);
    }
  }
  res.json({ ok: true });
};

export const setPrimaryManager: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const recruiterId = req.params.id;
  const managerId = req.params.managerId;

  const { data: existing, error: lookupErr } = await db
    .from('recruiter_managers')
    .select('manager_id')
    .eq('recruiter_id', recruiterId)
    .eq('manager_id', managerId)
    .maybeSingle();

  if (junctionMissing(lookupErr?.message)) {
    // Pre-migration fallback — set the single column directly.
    const { error } = await db
      .from('recruiters')
      .update({ manager_id: managerId })
      .eq('id', recruiterId);
    if (error) throw httpError(500, error.message);
    res.json({ ok: true, _degraded: true });
    return;
  }
  if (!existing) throw httpError(404, 'Assignment not found');

  await db.from('recruiter_managers').update({ is_primary: false }).eq('recruiter_id', recruiterId);
  await db
    .from('recruiter_managers')
    .update({ is_primary: true })
    .eq('recruiter_id', recruiterId)
    .eq('manager_id', managerId);
  await db.from('recruiters').update({ manager_id: managerId }).eq('id', recruiterId);
  res.json({ ok: true });
};
