import { RequestHandler } from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { httpError } from '../types';
import { logger } from '../config/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENV_PATH = path.resolve(__dirname, '../../.env');

/** Find the `claude` CLI binary. Installed globally via npm. */
function claudeBin(): string {
  const candidates = [
    process.env.CLAUDE_BIN,
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.nvm', 'versions', 'node', process.version, 'bin', 'claude'),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return 'claude';
}

/** Run `claude setup-token` and return the generated token. */
function runSetupToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = '';
    const proc = spawn(claudeBin(), ['setup-token'], { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (d: Buffer) => {
      out += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      out += d.toString();
    });
    proc.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`claude setup-token exited ${code}: ${out.slice(0, 300)}`));
        return;
      }
      const m = out.match(/sk-ant-oat01-[A-Za-z0-9_-]+/);
      if (!m) {
        reject(new Error('Token not found in claude setup-token output'));
        return;
      }
      resolve(m[0]);
    });
    proc.on('error', (e) => reject(e));
    setTimeout(() => {
      proc.kill();
      reject(new Error('claude setup-token timed out'));
    }, 30_000);
  });
}

/** Persist the OAuth token to backend/.env and flip provider to oauth. */
function saveToken(token: string) {
  let content = '';
  try {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  } catch {
    content = '';
  }
  const lines = content
    .split('\n')
    .filter(
      (l) =>
        !l.startsWith('ANTHROPIC_OAUTH_TOKEN=') &&
        !l.startsWith('TRAINING_AI_PROVIDER=') &&
        l !== '',
    );
  lines.push('TRAINING_AI_PROVIDER=oauth', `ANTHROPIC_OAUTH_TOKEN=${token}`);
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n');
}

/** Restart the PM2 process after the HTTP response is sent. */
function schedulePm2Restart(delayMs = 400) {
  setTimeout(() => {
    const pm2Name = process.env.PM2_NAME ?? 'hireorbitai-api';
    spawn('pm2', ['restart', pm2Name, '--update-env'], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  }, delayMs);
}

// ---------------------------------------------------------------------------
// Login-session store (module-level — single PM2 fork; cleared on restart)
// ---------------------------------------------------------------------------

interface LoginSession {
  proc: ReturnType<typeof spawn>;
  expireTimer: NodeJS.Timeout;
  status: 'pending' | 'complete' | 'failed';
  error?: string;
}

const loginSessions = new Map<string, LoginSession>();

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Fast path — run `claude setup-token` directly.
 * Works as long as the Claude CLI is already authenticated on this VPS.
 * Saves the new 1-year token to .env and queues a PM2 restart.
 */
export const refreshClaudeToken: RequestHandler = async (_req, res) => {
  let token: string;
  try {
    token = await runSetupToken();
  } catch (err: any) {
    throw httpError(
      502,
      `Could not refresh token — the Claude CLI may need to re-authenticate. ` +
        `Error: ${err?.message ?? String(err)}`,
    );
  }
  saveToken(token);
  logger.info({ action: 'claude_token_refreshed' }, 'admin: Claude OAuth token refreshed');
  res.json({ ok: true, hint: 'Server will restart in ~1 s to apply the new token.' });
  schedulePm2Restart();
};

/**
 * Spawn `claude auth login`, capture the auth URL, and return it.
 * The spawned process stays alive; poll GET /:sessionId/status to wait for
 * the user to approve in their browser.  The server auto-cleans after 10 min.
 */
export const startClaudeLogin: RequestHandler = (req, res) => {
  const sessionId = randomUUID();

  const proc = spawn(claudeBin(), ['auth', 'login'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: 'dumb', FORCE_COLOR: '0' },
  });

  let responded = false;
  let urlFound = false;

  const session: LoginSession = {
    proc,
    expireTimer: setTimeout(() => {
      proc.kill();
      loginSessions.delete(sessionId);
    }, 10 * 60_000),
    status: 'pending',
  };
  loginSessions.set(sessionId, session);

  const tryUrl = (text: string) => {
    if (urlFound) return;
    const m = text.match(/https:\/\/claude\.com\/cai\/oauth\/authorize\?[^\s\n]+/);
    if (m) {
      urlFound = true;
      if (!responded) {
        responded = true;
        res.json({ sessionId, url: m[0] });
      }
    }
  };

  proc.stdout!.on('data', (d: Buffer) => tryUrl(d.toString()));
  proc.stderr!.on('data', (d: Buffer) => tryUrl(d.toString()));

  proc.on('exit', async (code) => {
    clearTimeout(session.expireTimer);
    if (code === 0) {
      try {
        const token = await runSetupToken();
        saveToken(token);
        session.status = 'complete';
        logger.info({ action: 'claude_reauth_complete' }, 'admin: Claude re-auth complete');
        schedulePm2Restart();
      } catch (err: any) {
        session.status = 'failed';
        session.error = `Login succeeded but setup-token failed: ${err?.message}`;
      }
    } else {
      session.status = 'failed';
      session.error = `claude auth login exited with code ${code}`;
    }
  });

  proc.on('error', (err) => {
    session.status = 'failed';
    session.error = err.message;
    if (!responded) {
      responded = true;
      res.status(502).json({ error: `Failed to start claude: ${err.message}` });
    }
  });

  // Give up if no URL appears within 20 s
  setTimeout(() => {
    if (!responded) {
      responded = true;
      proc.kill();
      loginSessions.delete(sessionId);
      res.status(504).json({ error: 'Timed out waiting for auth URL from claude CLI' });
    }
  }, 20_000);
};

/**
 * Poll the status of a pending claude auth login session.
 * Returns { status: 'pending' | 'complete' | 'failed', error? }
 */
export const getLoginStatus: RequestHandler = (req, res) => {
  const session = loginSessions.get(req.params.sessionId);
  if (!session) return void res.json({ status: 'not_found' });
  res.json({ status: session.status, error: session.error });
};

/**
 * Feed the browser-issued authorization code to the waiting `claude auth login`
 * process. Claude's OAuth login is the manual code-paste flow: after the user
 * approves the authorize URL, claude.com returns a code that must be written to
 * the CLI's stdin. Writing it unblocks the process, which then exits 0 and the
 * `proc.on('exit')` handler (setup-token → save → PM2 restart) takes over.
 * Body: { code: string }
 */
const submitCodeSchema = z.object({ code: z.string().min(8).max(2048) }).strict();

export const submitClaudeCode: RequestHandler = (req, res) => {
  const parsed = submitCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw httpError(400, 'A valid authorization code is required');
  }

  const session = loginSessions.get(req.params.sessionId);
  if (!session) throw httpError(404, 'Login session not found');

  // Idempotent: if the process already finished (or failed), just report it.
  if (session.status !== 'pending') {
    return void res.json({ ok: true, status: session.status });
  }

  const stdin = session.proc.stdin;
  if (!stdin || stdin.destroyed || !stdin.writable) {
    throw httpError(409, 'Login session is no longer accepting input — please start over');
  }

  stdin.write(parsed.data.code.trim() + '\n');
  logger.info({ action: 'claude_reauth_code_submitted' }, 'admin: Claude re-auth code submitted');
  res.json({ ok: true });
};

/**
 * Validate an admin-supplied AI token by making a 1-token test call.
 * Returns { ok: true } on success or { ok: false, error: string } on failure.
 * Body: { aiToken: string }
 */
export const checkAiToken: RequestHandler = async (req, res) => {
  const { aiToken } = req.body as { aiToken?: unknown };
  if (typeof aiToken !== 'string' || aiToken.trim().length < 10) {
    throw httpError(400, 'aiToken is required');
  }
  const token = aiToken.trim();
  const isOAuth = !token.startsWith('sk-');
  const client = new Anthropic(
    isOAuth ? { authToken: token, maxRetries: 0 } : { apiKey: token, maxRetries: 0 },
  );
  try {
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });
    res.json({ ok: true });
  } catch (err: any) {
    const msg: string = err?.error?.error?.message ?? err?.message ?? 'Token validation failed';
    logger.warn({ action: 'ai_token_check_failed', err: msg }, 'admin: AI token check failed');
    res.json({ ok: false, error: msg });
  }
};
