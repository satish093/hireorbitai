import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from './env';

export const genai = new GoogleGenerativeAI(env.google.apiKey);
export const GEMINI_MODEL = env.google.model;

/** Same model for all tiers — Gemini Flash handles everything. */
export const TRAINING_CONTENT_MODEL = env.google.model;

/** Token-cost controls (reuse existing env vars). */
export const AI_MAX_INPUT_CHARS = env.anthropic.maxInputChars;
export const AI_MAX_JOB_DESC_CHARS = env.anthropic.maxJobDescChars;

/** Generation transport: 'api' (live key) or 'stub'. */
export const AI_PROVIDER = env.anthropic.provider;

export const GEMINI_ENABLED = env.google.apiKey.length > 0;

/** True when a real model is reachable for generation. */
export const AI_AVAILABLE = AI_PROVIDER === 'api' && GEMINI_ENABLED;
