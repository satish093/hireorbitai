import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from './env';

export const GEMINI_ENABLED = Boolean(env.gemini?.apiKey);
export const GEMINI_MODEL = env.gemini?.model ?? 'gemini-2.5-flash';

export const geminiClient = GEMINI_ENABLED ? new GoogleGenerativeAI(env.gemini!.apiKey!) : null;

const GEMINI_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

/** Retry a Gemini API call up to 3 times on 429 TooManyRequests with exponential backoff.
 *  All other errors are re-thrown immediately. */
export async function withGeminiRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i <= GEMINI_RETRY_DELAYS_MS.length; i++) {
    try {
      return await fn();
    } catch (err) {
      const is429 =
        (err as { status?: number }).status === 429 || (err as Error).message?.includes('429');
      if (!is429 || i === GEMINI_RETRY_DELAYS_MS.length) throw err;
      await new Promise<void>((r) => setTimeout(r, GEMINI_RETRY_DELAYS_MS[i]!));
    }
  }
  throw new Error('unreachable');
}
