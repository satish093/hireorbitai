/**
 * Super-Admin DEV test panel API.
 *
 * A place to store/edit test integration configs (API keys, SMTP, scraper,
 * experimental flags) in the DEVELOPMENT database, so a super-admin can trial
 * settings without editing .env or touching production. Persisted in the
 * dev-only `dev_settings` table.
 *
 * Every route is gated by requireDevTools (404 unless env.devTools, which is
 * force-off in production) AND requireRole(SUPER_ADMIN) — see devTools.routes.
 * Values entered here are read back via `getDevSetting()` and are intended to
 * be consumed by dev integration code paths only.
 */

import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError } from '../types';

// Allow-listed config namespaces the panel can edit. Keeps the store tidy and
// makes it easy to add future testing surfaces.
const KNOWN_KEYS = [
  'ai_keys', // { openai?, anthropic?, gemini? }
  'smtp', // { host?, port?, user?, pass?, from? }
  'scraper', // { rapidApiKey?, jsearchKey?, sources?: string[] }
  'integrations', // arbitrary third-party toggles
  'experimental', // experimental feature flags / settings
] as const;
type KnownKey = (typeof KNOWN_KEYS)[number];

interface DevSettingRow {
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
}

// GET /dev/integrations — all stored test configs, keyed by namespace.
export const getIntegrations: RequestHandler = async (_req, res) => {
  const { data, error } = await db.from('dev_settings').select('key, value, updated_at');
  if (error) throw httpError(500, error.message);
  const rows = (data as DevSettingRow[]) ?? [];
  const out: Record<string, unknown> = {};
  for (const k of KNOWN_KEYS) out[k] = rows.find((r) => r.key === k)?.value ?? {};
  res.json(out);
};

const putSchema = z
  .object({
    key: z.enum(KNOWN_KEYS),
    value: z.record(z.string(), z.unknown()),
  })
  .strict();

// PUT /dev/integrations { key, value } — upsert one config namespace.
export const putIntegration: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = putSchema.safeParse(req.body);
  if (parsed.success === false) throw httpError(400, 'Invalid config', parsed.error.flatten());

  const { error } = await db.from('dev_settings').upsert(
    {
      key: parsed.data.key as KnownKey,
      value: parsed.data.value,
      updated_by: req.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};

/**
 * Read a stored dev config namespace (e.g. 'ai_keys'). For use by dev-only
 * integration code paths to override env at runtime. Returns {} if unset or if
 * dev tooling is off. Never call this on a hot production path — it's a
 * dev-environment convenience.
 */
export async function getDevSetting<T = Record<string, unknown>>(key: KnownKey): Promise<T> {
  const { data } = await db.from('dev_settings').select('value').eq('key', key).maybeSingle();
  return ((data as { value: T } | null)?.value ?? ({} as T)) as T;
}
