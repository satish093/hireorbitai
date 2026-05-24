import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env } from './env';

/** Generation transport: 'api' (key), 'oauth' (subscription token), or 'stub'. */
export const AI_PROVIDER = env.anthropic.provider;

/**
 * Attempt to read the Claude Code CLI credentials file as a fallback token
 * source. The Claude Code CLI stores credentials at ~/.claude/credentials.json
 * after `claude login`. This lets the server use a Claude.ai subscription
 * without manually copying the token into .env — running `setup-claude-auth.sh`
 * is the canonical flow, but this fallback means a restarted server works even
 * if the .env write step was skipped.
 *
 * Returns an empty string if the file is absent, unreadable, or has no token.
 */
function readClaudeCliToken(): string {
  try {
    const credsPath =
      process.env.CLAUDE_CREDS_FILE ?? path.join(os.homedir(), '.claude', 'credentials.json');
    if (!fs.existsSync(credsPath)) return '';
    const raw = fs.readFileSync(credsPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const tok =
      (parsed.oauthToken as string | undefined) ||
      (parsed.accessToken as string | undefined) ||
      ((parsed.claudeAiOAuth as Record<string, unknown> | undefined)?.accessToken as
        | string
        | undefined) ||
      ((parsed.oauth as Record<string, unknown> | undefined)?.accessToken as string | undefined) ||
      '';
    return typeof tok === 'string' ? tok : '';
  } catch {
    return '';
  }
}

/**
 * Resolve the effective OAuth token.
 * Priority: ANTHROPIC_OAUTH_TOKEN in .env  →  ~/.claude/credentials.json
 */
function resolveOAuthToken(): string {
  const envToken = env.anthropic.oauthToken;
  if (envToken.length > 10) return envToken;
  const cliToken = readClaudeCliToken();
  return cliToken;
}

const effectiveOAuthToken = AI_PROVIDER === 'oauth' ? resolveOAuthToken() : '';

// Build the Anthropic client once at startup.
// - 'api'   mode: authenticate with ANTHROPIC_API_KEY (pay-per-token).
// - 'oauth' mode: authenticate with ANTHROPIC_OAUTH_TOKEN / CLI credentials (Claude.ai subscription).
// - 'stub'  mode: client is constructed but never called (AI_AVAILABLE = false).
export const anthropic = new Anthropic(
  AI_PROVIDER === 'oauth'
    ? {
        authToken: effectiveOAuthToken,
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
  AI_PROVIDER === 'oauth' ? effectiveOAuthToken.length > 0 : env.anthropic.apiKey.length > 0;

/** Whether a real model is reachable for generation. */
export const AI_AVAILABLE = AI_PROVIDER !== 'stub' && ANTHROPIC_ENABLED;
