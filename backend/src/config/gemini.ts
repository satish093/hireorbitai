import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from './env';

export const GEMINI_ENABLED = Boolean(env.gemini?.apiKey);
export const GEMINI_MODEL = env.gemini?.model ?? 'gemini-2.0-flash';

export const geminiClient = GEMINI_ENABLED ? new GoogleGenerativeAI(env.gemini!.apiKey!) : null;
