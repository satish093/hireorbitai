import { logger } from '../config/logger';
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
export function logAiUsage(call: string, model: string, usage: AnthropicUsage | undefined): void {
  if (!usage) return;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const costUsd = estimateCostUsd(model, usage);
  logger.info(
    {
      ai_usage: {
        call,
        model,
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: usage.cache_read_input_tokens ?? 0,
        cost_usd: Number(costUsd.toFixed(6)),
      },
    },
    `ai.usage ${call} ${input}in/${output}out ~$${costUsd.toFixed(4)}`,
  );
}
