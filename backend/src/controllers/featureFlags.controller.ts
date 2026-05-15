import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError } from '../types';

// In-memory cache so we don't hammer the DB on every request. Invalidated
// synchronously on PATCH and on group-override change. 5-second hard TTL
// as a safety net — short enough that even a missed invalidation in a
// multi-process deploy reconciles quickly. Single-process deploys see
// changes immediately because the same module instance owns the cache.
let cache: { fetchedAt: number; flags: Record<string, boolean> } | null = null;
let groupCache: { fetchedAt: number; overrides: Map<string, Record<string, boolean>> } | null =
  null;
const TTL_MS = 5_000;

export async function loadFlags(): Promise<Record<string, boolean>> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.flags;
  const { data, error } = await db.from('feature_flags').select('key, enabled');
  if (error) return {};
  const flags: Record<string, boolean> = {};
  for (const r of data ?? []) flags[r.key] = r.enabled;
  cache = { fetchedAt: Date.now(), flags };
  return flags;
}

/** Per-group overrides keyed by group_id → { flag_key → enabled }. */
async function loadGroupOverrides(): Promise<Map<string, Record<string, boolean>>> {
  if (groupCache && Date.now() - groupCache.fetchedAt < TTL_MS) return groupCache.overrides;
  const out = new Map<string, Record<string, boolean>>();
  const { data, error } = await db.from('group_feature_flags').select('group_id, key, enabled');
  if (!error) {
    for (const r of data ?? []) {
      const m = out.get(r.group_id) ?? {};
      m[r.key] = r.enabled;
      out.set(r.group_id, m);
    }
  }
  groupCache = { fetchedAt: Date.now(), overrides: out };
  return out;
}

/** Effective per-user flags: global flag merged with group override (if any). */
export async function effectiveFlagsForUser(
  groupId: string | null | undefined,
): Promise<Record<string, boolean>> {
  const flags = { ...(await loadFlags()) };
  if (!groupId) return flags;
  const overrides = await loadGroupOverrides();
  const groupOverride = overrides.get(groupId);
  if (groupOverride) Object.assign(flags, groupOverride);
  return flags;
}

function invalidateCache() {
  cache = null;
  groupCache = null;
}

/** Public-to-auth-users — every signed-in user can read flags so the UI can gate. */
export const list: RequestHandler = async (_req, res) => {
  const { data, error } = await db.from('feature_flags').select('*').order('key');
  if (error) {
    // Table missing — return an empty list so the page renders fine.
    if (/feature_flags/i.test(error.message)) {
      res.json([]);
      return;
    }
    throw httpError(500, error.message);
  }
  res.json(data ?? []);
};

/** PATCH /:key  body: { enabled: boolean } */
export const setFlag: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({ enabled: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'enabled (boolean) required');

  const { data, error } = await db
    .from('feature_flags')
    .update({
      enabled: parsed.data.enabled,
      updated_at: new Date().toISOString(),
      updated_by: req.user.id,
    })
    .eq('key', req.params.key)
    .select()
    .single();
  if (error || !data) throw httpError(404, error?.message ?? 'Flag not found');
  invalidateCache();
  res.json(data);
};

/** GET /feature-flags/me — effective flags for the calling user (global +
 *  group overrides). The sidebar polls this to gate modules. */
export const myFlags: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  res.json(await effectiveFlagsForUser(req.user.group_id ?? null));
};

/** GET /feature-flags/overrides — every group_feature_flags row, keyed by
 *  group_id. Used by the admin page to render the matrix. */
export const listOverrides: RequestHandler = async (_req, res) => {
  const { data, error } = await db.from('group_feature_flags').select('group_id, key, enabled');
  if (error) {
    if (/group_feature_flags/i.test(error.message)) {
      res.json([]);
      return;
    }
    throw httpError(500, error.message);
  }
  res.json(data ?? []);
};

/** PUT /feature-flags/groups/:groupId/:key  body: { enabled: boolean | null }
 *  Setting enabled to null clears the override (inherit global). */
export const setGroupOverride: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({ enabled: z.boolean().nullable() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'enabled (boolean | null) required');

  const { groupId, key } = req.params;
  if (parsed.data.enabled === null) {
    const { error } = await db
      .from('group_feature_flags')
      .delete()
      .eq('group_id', groupId)
      .eq('key', key);
    if (error) throw httpError(500, error.message);
  } else {
    const { error } = await db
      .from('group_feature_flags')
      .upsert(
        {
          group_id: groupId,
          key,
          enabled: parsed.data.enabled,
          updated_at: new Date().toISOString(),
          updated_by: req.user.id,
        },
        { onConflict: 'group_id,key' },
      );
    if (error) throw httpError(500, error.message);
  }
  invalidateCache();
  res.json({ ok: true });
};
