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

/** Generation transport: 'api' (key) or 'stub'. */
export const AI_PROVIDER = env.anthropic.provider;

/** True when an API key is configured. */
export const ANTHROPIC_ENABLED = env.anthropic.apiKey.length > 0;

/** Whether a real model is reachable for generation. */
export const AI_AVAILABLE = AI_PROVIDER === 'api' && ANTHROPIC_ENABLED;
