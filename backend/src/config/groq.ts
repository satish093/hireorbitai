import Groq from 'groq-sdk';
import { env } from './env';

export const GROQ_ENABLED = Boolean(env.groq.apiKey);

export const groqClient = GROQ_ENABLED
  ? new Groq({ apiKey: env.groq.apiKey, maxRetries: 0 })
  : null;

// For resume tailoring and structured extraction — best instruction following.
export const GROQ_MODEL = 'llama-3.3-70b-versatile';

// For conversational copilot Q&A — fastest response.
export const GROQ_FAST_MODEL = 'llama-3.1-8b-instant';
