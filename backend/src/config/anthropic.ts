import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';

/** Generation transport: 'api' (key), 'oauth' (subscription token), or 'stub'. */
export const AI_PROVIDER = env.anthropic.provider;

// Build the Anthropic client once at startup.
// - 'api'   mode: authenticate with ANTHROPIC_API_KEY (pay-per-token).
// - 'oauth' mode: authenticate with ANTHROPIC_OAUTH_TOKEN (Claude.ai subscription).
// - 'stub'  mode: client is constructed but never called (AI_AVAILABLE = false).
export const anthropic = new Anthropic(
  AI_PROVIDER === 'oauth'
    ? {
        authToken: env.anthropic.oauthToken,
        // Don't let the SDK sleep-retry on 429s — callers handle failure themselves.
        maxRetries: 0,
      }
    : {
        apiKey: env.anthropic.apiKey,
        maxRetries: 0,
      },
);

export const ANTHROPIC_MODEL = env.anthropic.model;
/** Heavier model used for long-form training content (lesson bodies, capstone). */
export const TRAINING_CONTENT_MODEL = env.anthropic.contentModel;

/** Token-cost controls. Free-text inputs are clipped to these budgets before
 *  being sent to the model — input tokens dominate cost on the hot paths.
 *  Tunable via AI_MAX_INPUT_CHARS / AI_MAX_JOB_DESC_CHARS. */
export const AI_MAX_INPUT_CHARS = env.anthropic.maxInputChars;
export const AI_MAX_JOB_DESC_CHARS = env.anthropic.maxJobDescChars;

/** True when a credential is present for the configured provider. */
export const ANTHROPIC_ENABLED =
  AI_PROVIDER === 'oauth' ? env.anthropic.oauthToken.length > 0 : env.anthropic.apiKey.length > 0;

/** Whether a real model is reachable for generation. */
export const AI_AVAILABLE = AI_PROVIDER !== 'stub' && ANTHROPIC_ENABLED;
