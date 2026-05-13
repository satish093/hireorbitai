import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';

export const anthropic = new Anthropic({ apiKey: env.anthropic.apiKey });
export const ANTHROPIC_MODEL = env.anthropic.model;
