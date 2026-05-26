import Groq from 'groq-sdk';
import { env } from './env';

export const GROQ_ENABLED = Boolean(env.groq.apiKey);

export const groqClient = GROQ_ENABLED
  ? new Groq({ apiKey: env.groq.apiKey, maxRetries: 0 })
  : null;

// Primary structured model — most AI features.
// Limit: 1K RPD / 30K TPM / 500K TPD (free tier)
export const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

// Heavy rewrite tasks (resume tailoring) — larger model for better instruction following.
// Limit: 1K RPD / 12K TPM / 100K TPD (free tier) — use sparingly.
export const GROQ_LARGE_MODEL = 'llama-3.3-70b-versatile';

// Conversational copilot Q&A — fastest response.
// Limit: 14.4K RPD / 6K TPM / 500K TPD (free tier)
export const GROQ_FAST_MODEL = 'llama-3.1-8b-instant';
