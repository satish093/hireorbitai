import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';

export const anthropic = new Anthropic({ apiKey: env.anthropic.apiKey });
export const ANTHROPIC_MODEL = env.anthropic.model;
/** Heavier model used for long-form training content (lesson bodies, capstone). */
export const TRAINING_CONTENT_MODEL = env.anthropic.contentModel;

/** Token-cost controls. Free-text inputs are clipped to these budgets before
 *  being sent to the model — input tokens dominate cost on the hot paths.
 *  Tunable via AI_MAX_INPUT_CHARS / AI_MAX_JOB_DESC_CHARS. */
export const AI_MAX_INPUT_CHARS = env.anthropic.maxInputChars;
export const AI_MAX_JOB_DESC_CHARS = env.anthropic.maxJobDescChars;

/** Generation transport: 'subscription' (claude CLI), 'api' (key), or 'stub'. */
export const AI_PROVIDER = env.anthropic.provider;
export const CLAUDE_CLI_PATH = env.anthropic.cliPath;
export const CLAUDE_OAUTH_TOKEN = env.anthropic.oauthToken;

/** True when an API key is configured (only meaningful for the 'api' provider). */
export const ANTHROPIC_ENABLED = env.anthropic.apiKey.length > 0;

/**
 * Whether a real model is reachable for generation. For 'subscription' we
 * assume the CLI can authenticate (interactive login or CLAUDE_CODE_OAUTH_TOKEN);
 * if it can't at call time, the generators degrade to stubs via safeGenerate.
 */
export const AI_AVAILABLE =
  AI_PROVIDER === 'subscription' || (AI_PROVIDER === 'api' && ANTHROPIC_ENABLED);
