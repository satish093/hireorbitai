import { logger } from '../config/logger';
import { pool } from '../config/db';
import { estimateCostUsd, type AnthropicUsage } from './aiPricing';

/**
 * Log one structured `ai.usage` line per Anthropic call so ACTUAL spend is
 * observable instead of guessed — grep/aggregate by `ai_usage.call` and
 * `ai_usage.model`, e.g.:
 *
 *   pm2 logs hireorbitai-api | grep ai.usage
 *   # sum a day's cost (JSON logs in prod):
 *   grep '"ai_usage"' app.log | jq '[.ai_usage.cost_usd] | add'
 *
 * Lightweight: no external calls, no persistent state. `cost_usd` is an
 * estimate from aiPricing (prices are hardcoded; treat as a guide, not billing).
 */
/** Log one LlamaParse PDF extraction (1 call = 1 PDF job, no token concept). */
export function logLlamaParseUsage(call: string, pages = 1): void {
  logger.info(
    { ai_usage: { call, model: 'llamaparse', pages } },
    `ai.usage ${call} llamaparse ${pages}p`,
  );
  pool
    .query(
      `INSERT INTO ai_usage_logs (call_name, model, input_tokens, output_tokens, cache_read_tokens, cost_usd)
       VALUES ($1, 'llamaparse', $2, 0, 0, 0)`,
      [call, pages],
    )
    .catch(() => {});
}

export function logAiUsage(call: string, model: string, usage: AnthropicUsage | undefined): void {
  if (!usage) return;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const costUsd = estimateCostUsd(model, usage);
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  logger.info(
    {
      ai_usage: {
        call,
        model,
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cacheRead,
        cost_usd: Number(costUsd.toFixed(6)),
      },
    },
    `ai.usage ${call} ${input}in/${output}out ~$${costUsd.toFixed(4)}`,
  );

  // Persist for the AI Usage dashboard — fire-and-forget, never throws.
  pool
    .query(
      `INSERT INTO ai_usage_logs (call_name, model, input_tokens, output_tokens, cache_read_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [call, model, input, output, cacheRead, Number(costUsd.toFixed(6))],
    )
    .catch(() => {
      /* DB unavailable — logging already captured above */
    });
}
