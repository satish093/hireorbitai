import { env } from './env';

export const LLAMAPARSE_ENABLED = Boolean(env.llamaCloud?.apiKey);
export const LLAMAPARSE_API_KEY = env.llamaCloud?.apiKey ?? '';
export const LLAMAPARSE_BASE_URL = 'https://api.cloud.llamaindex.ai/api/parsing';
