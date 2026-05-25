import { RequestHandler } from 'express';
import { pool } from '../config/db';
import { httpError } from '../types';

const PROVIDER_SQL = `
  CASE
    WHEN model LIKE 'claude-%' THEN 'anthropic'
    WHEN model LIKE 'gemini-%' THEN 'gemini'
    ELSE 'groq'
  END`;

/** GET /ai-usage/summary?days=30 */
export const summary: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const days = Math.min(parseInt(String(req.query.days ?? '30'), 10) || 30, 365);

  const [
    totals,
    byCall,
    byModel,
    byDay,
    paidTotals,
    paidByCall,
    freeTotals,
    freeByCall,
    freeByModel,
  ] = await Promise.all([
    // ── All providers ──────────────────────────────────────────────────────
    pool.query(
      `SELECT COUNT(*)::int                              AS calls,
                COALESCE(SUM(input_tokens),0)::int         AS input_tokens,
                COALESCE(SUM(output_tokens),0)::int        AS output_tokens,
                COALESCE(SUM(cache_read_tokens),0)::int    AS cache_tokens,
                COALESCE(SUM(cost_usd),0)::numeric         AS cost_usd
         FROM ai_usage_logs
         WHERE created_at >= NOW() - ($1 || ' days')::interval`,
      [days],
    ),
    pool.query(
      `SELECT call_name,
                COUNT(*)::int                              AS calls,
                COALESCE(SUM(input_tokens),0)::int         AS input_tokens,
                COALESCE(SUM(output_tokens),0)::int        AS output_tokens,
                COALESCE(SUM(cost_usd),0)::numeric         AS cost_usd
         FROM ai_usage_logs
         WHERE created_at >= NOW() - ($1 || ' days')::interval
         GROUP BY call_name
         ORDER BY cost_usd DESC`,
      [days],
    ),
    pool.query(
      `SELECT model,
                COUNT(*)::int                                          AS calls,
                COALESCE(SUM(input_tokens + output_tokens),0)::int    AS total_tokens,
                COALESCE(SUM(cost_usd),0)::numeric                    AS cost_usd
         FROM ai_usage_logs
         WHERE created_at >= NOW() - ($1 || ' days')::interval
         GROUP BY model
         ORDER BY cost_usd DESC`,
      [days],
    ),
    pool.query(
      `SELECT DATE(created_at AT TIME ZONE 'UTC')                   AS day,
                COUNT(*)::int                                          AS calls,
                COALESCE(SUM(input_tokens + output_tokens),0)::int    AS total_tokens,
                COALESCE(SUM(cost_usd),0)::numeric                    AS cost_usd
         FROM ai_usage_logs
         WHERE created_at >= NOW() - ($1 || ' days')::interval
         GROUP BY day
         ORDER BY day ASC`,
      [days],
    ),

    // ── Paid (Anthropic claude-*) ──────────────────────────────────────────
    pool.query(
      `SELECT COUNT(*)::int                              AS calls,
                COALESCE(SUM(input_tokens),0)::int         AS input_tokens,
                COALESCE(SUM(output_tokens),0)::int        AS output_tokens,
                COALESCE(SUM(cache_read_tokens),0)::int    AS cache_tokens,
                COALESCE(SUM(cost_usd),0)::numeric         AS cost_usd
         FROM ai_usage_logs
         WHERE created_at >= NOW() - ($1 || ' days')::interval
           AND model LIKE 'claude-%'`,
      [days],
    ),
    pool.query(
      `SELECT call_name,
                COUNT(*)::int                              AS calls,
                COALESCE(SUM(input_tokens),0)::int         AS input_tokens,
                COALESCE(SUM(output_tokens),0)::int        AS output_tokens,
                COALESCE(SUM(cost_usd),0)::numeric         AS cost_usd
         FROM ai_usage_logs
         WHERE created_at >= NOW() - ($1 || ' days')::interval
           AND model LIKE 'claude-%'
         GROUP BY call_name
         ORDER BY cost_usd DESC`,
      [days],
    ),

    // ── Free (Groq + Gemini) ───────────────────────────────────────────────
    pool.query(
      `SELECT COUNT(*)::int                              AS calls,
                COALESCE(SUM(input_tokens),0)::int         AS input_tokens,
                COALESCE(SUM(output_tokens),0)::int        AS output_tokens,
                COALESCE(SUM(cost_usd),0)::numeric         AS cost_usd
         FROM ai_usage_logs
         WHERE created_at >= NOW() - ($1 || ' days')::interval
           AND model NOT LIKE 'claude-%'`,
      [days],
    ),
    pool.query(
      `SELECT call_name,
                ${PROVIDER_SQL}                            AS provider,
                COUNT(*)::int                              AS calls,
                COALESCE(SUM(input_tokens),0)::int         AS input_tokens,
                COALESCE(SUM(output_tokens),0)::int        AS output_tokens
         FROM ai_usage_logs
         WHERE created_at >= NOW() - ($1 || ' days')::interval
           AND model NOT LIKE 'claude-%'
         GROUP BY call_name, provider
         ORDER BY calls DESC`,
      [days],
    ),
    pool.query(
      `SELECT model,
                ${PROVIDER_SQL}                                        AS provider,
                COUNT(*)::int                                          AS calls,
                COALESCE(SUM(input_tokens + output_tokens),0)::int    AS total_tokens
         FROM ai_usage_logs
         WHERE created_at >= NOW() - ($1 || ' days')::interval
           AND model NOT LIKE 'claude-%'
         GROUP BY model, provider
         ORDER BY calls DESC`,
      [days],
    ),
  ]);

  res.json({
    days,
    totals: totals.rows[0],
    by_call: byCall.rows,
    by_model: byModel.rows,
    by_day: byDay.rows,
    paid: {
      totals: paidTotals.rows[0],
      by_call: paidByCall.rows,
    },
    free: {
      totals: freeTotals.rows[0],
      by_call: freeByCall.rows,
      by_model: freeByModel.rows,
    },
  });
};

/** GET /ai-usage/logs?limit=100&offset=0&call=&model=&provider=paid|free */
export const logs: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 500);
  const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;
  const callFilter = String(req.query.call ?? '').trim();
  const modelFilter = String(req.query.model ?? '').trim();
  const providerFilter = String(req.query.provider ?? '').trim();

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (callFilter) {
    params.push(callFilter);
    conditions.push(`call_name = $${params.length}`);
  }
  if (modelFilter) {
    params.push(modelFilter);
    conditions.push(`model = $${params.length}`);
  }
  if (providerFilter === 'paid') {
    conditions.push(`model LIKE 'claude-%'`);
  } else if (providerFilter === 'free') {
    conditions.push(`model NOT LIKE 'claude-%'`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT id, call_name, model,
            ${PROVIDER_SQL} AS provider,
            input_tokens, output_tokens, cache_read_tokens,
            cost_usd, created_at
     FROM ai_usage_logs
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json(rows);
};
