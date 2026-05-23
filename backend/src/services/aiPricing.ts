/**
 * Anthropic token pricing + per-call cost estimation.
 *
 * PURE — no imports — so it can be unit-tested without loading config/env
 * (which fail-fasts on a bare test environment). Prices are USD per 1M tokens;
 * keep in sync with https://docs.anthropic.com/en/docs/about-claude/pricing.
 */

export interface AnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

interface Price {
  input: number; // $ / 1M input tokens
  output: number; // $ / 1M output tokens
}

// Matched by LONGEST model-id prefix, so dated ids (…-4-5-20251001) and point
// releases (…-4-6) resolve to their family without an entry each.
const PRICES: Record<string, Price> = {
  // --- Anthropic ---
  'claude-haiku-4': { input: 1, output: 5 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-opus-4': { input: 15, output: 75 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  // --- Google Gemini (paid tier; free tier bills $0 up to quota limits) ---
  'gemini-2.0-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash-lite': { input: 0.075, output: 0.3 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.0-pro': { input: 0.5, output: 1.5 },
};

// Unknown model → assume Haiku-class so we never under-warn on cost.
const FALLBACK: Price = { input: 1, output: 5 };

export function priceFor(model: string): Price {
  let best: Price | undefined;
  let bestLen = -1;
  for (const [key, p] of Object.entries(PRICES)) {
    if (model.startsWith(key) && key.length > bestLen) {
      best = p;
      bestLen = key.length;
    }
  }
  return best ?? FALLBACK;
}

/** Estimate USD cost for a single Anthropic call from its usage block. */
export function estimateCostUsd(model: string, usage: AnthropicUsage): number {
  const p = priceFor(model);
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  // Cached reads bill ~10% of input; 5-min cache writes ~125%. Both are zero on
  // our current paths (we don't use prompt caching) but counted if ever present.
  const cost =
    input * p.input +
    output * p.output +
    cacheRead * (p.input * 0.1) +
    cacheWrite * (p.input * 1.25);
  return cost / 1_000_000;
}
