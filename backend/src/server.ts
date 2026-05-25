// Load .env before env.ts validates process.env. dotenv skips vars already
// set in the environment (e.g. NODE_ENV injected by PM2) and silently
// ignores a missing file (CI / test environments supply vars externally).
import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import hpp from 'hpp';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import { env } from './config/env';
import { logger } from './config/logger';
import { ensureDefaultAdmin } from './config/bootstrap';
import { jobs } from './jobs';
import { startRealtime, stopRealtime } from './services/realtime.service';
import { router } from './routes';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// --- Trust proxy --------------------------------------------------------------
// CloudPanel / Nginx terminates TLS in front of us. Tell Express to honour the
// X-Forwarded-* headers so req.ip, req.protocol, and rate-limit keying work
// correctly. TRUST_PROXY=1 means "trust one hop" (the local reverse proxy).
app.set('trust proxy', env.trustProxy);

// --- Security headers ---------------------------------------------------------
// Helmet defaults are good; we tighten the policies that ship with weak
// defaults (HSTS 180s, no Permissions-Policy, default-permissive referrer).
app.use(
  helmet({
    // Allow the frontend (served from a different origin) to read normal API
    // responses. Disable COEP because we don't host cross-origin embeds that
    // would benefit from it, and enabling it tends to break image previews.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    // 1 year HSTS + includeSubDomains + preload eligibility. Once the
    // domain is added to the Chrome HSTS preload list, this becomes
    // browser-enforced even on first visit.
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    // Don't leak the full URL as Referer to third-party sites. "strict-origin"
    // sends only the origin on cross-origin, nothing on downgrade.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);

// Permissions-Policy — disable browser APIs we don't use. Reduces fingerprint
// surface + blocks third-party iframes from prompting users with our origin.
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    [
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
    ].join(', '),
  );
  next();
});

// --- CORS ---------------------------------------------------------------------
// Strict allowlist sourced from env. No wildcard fallback — if CORS_ORIGIN is
// misconfigured the env schema will have already exited the process.
//
// We normalize both sides (lowercase + trim trailing slash) so a slightly
// off env value (`https://hireorbitai.com/`) still matches the browser's
// `Origin: https://hireorbitai.com` header.
const normalizedAllowlist = env.corsOrigins.map((o) => o.toLowerCase().replace(/\/+$/, ''));
app.use(
  cors({
    origin: (origin, cb) => {
      // No Origin header → same-origin, curl, or server-to-server. Allow.
      if (!origin) return cb(null, true);
      const norm = origin.toLowerCase().replace(/\/+$/, '');
      if (normalizedAllowlist.includes(norm)) return cb(null, true);
      // Loud log so misconfig is obvious in `pm2 logs`. Don't throw — returning
      // (null, false) lets cors() respond without the Allow-Origin header,
      // which is the correct CORS-spec behavior and avoids a 500 that lacks
      // CORS headers entirely.
      logger.warn({ origin, allowlist: normalizedAllowlist }, 'CORS: origin not in allowlist');
      cb(null, false);
    },
    credentials: true,
  }),
);

// --- Body parsing -------------------------------------------------------------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// --- Defenses -----------------------------------------------------------------
// hpp = HTTP Parameter Pollution guard. Strips duplicate query/body keys
// (e.g. ?role=admin&role=user) so handlers always see a single value.
app.use(hpp());
// gzip/brotli responses where it makes sense (most JSON bodies).
app.use(compression());

// --- Request logging ----------------------------------------------------------
// pino-http attaches a per-request logger to req.log with a unique requestId,
// so downstream handlers can log with correlation. Skip /health to keep the
// log stream clean.
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => {
      const clientId = req.headers['x-request-id'];
      return typeof clientId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(clientId)
        ? clientId
        : crypto.randomUUID();
    },
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === '/ready',
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  }),
);

// --- Rate limiting ------------------------------------------------------------
// Global limiter — generous on purpose. The Sidebar polls 3 endpoints every
// 60s (~180/15min/user) plus each page navigation fires several reads, so a
// strict per-IP cap would 429 normal traffic on shared NAT / office networks.
//
// Strategy:
//   - Key on the authenticated userId when present (req.user is set by the
//     route-level requireAuth middlewares; for unauthed requests we fall back
//     to the client IP). This means two users behind the same NAT don't share
//     a bucket.
//   - Skip /health and /ready so uptime monitors don't burn budget.
//   - Public auth + invitation routes get their own much stricter limiter
//     mounted below — those are the brute-force surface.
// Shared 429 handler — emits a clean JSON body and a Retry-After header in
// seconds (the default response is HTML "Too many requests"). The frontend
// can read Retry-After to back off intelligently if we ever wire a retrying
// client.
function sendRateLimitResponse(
  _req: import('express').Request,
  res: import('express').Response,
  _next: unknown,
  opts: { windowMs: number },
) {
  // express-rate-limit sets RateLimit-Reset on the response (in seconds until
  // the bucket frees up). Echo that as Retry-After so clients can back off the
  // right amount instead of the worst-case full window. We cap at 60s so a
  // misconfigured client doesn't sleep forever; the next tick will retry if
  // we're still over budget.
  const resetSec = Number(res.getHeader('RateLimit-Reset'));
  const fallback = Math.ceil(opts.windowMs / 1000);
  const retryAfter = Math.min(60, Number.isFinite(resetSec) && resetSec > 0 ? resetSec : fallback);
  res.setHeader('Retry-After', String(retryAfter));
  res.status(429).json({
    error: 'Too many requests. Please slow down.',
    retry_after_seconds: retryAfter,
  });
}

// The global limiter mounts BEFORE requireAuth runs, so `req.user` isn't
// populated yet. Decode (verify) the JWT here directly so the bucket is keyed
// per-user instead of per-IP — otherwise everyone behind a shared NAT / office
// proxy shares a single bucket and the polling Sidebar burns the entire team's
// budget. Falls back to IP for unauthenticated requests.
function rateLimitKey(req: import('express').Request): string {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const decoded = jwt.verify(token, env.jwt.secret, { algorithms: ['HS256'] }) as {
        sub?: string;
      };
      if (decoded?.sub) return `u:${decoded.sub}`;
    } catch {
      // Falls through to IP key. The actual auth failure surfaces in
      // requireAuth, not here.
    }
  }
  return `ip:${req.ip ?? 'unknown'}`;
}

// Skip the global limiter on health/readiness/refresh:
//   - /health, /ready  → uptime monitors mustn't burn budget.
//   - /auth/refresh   → silent token refresh is a high-frequency interceptor
//                       hook; if it gets 429'd we end up logging the user out
//                       on a transient burst. The refresh endpoint has its own
//                       narrow per-user cost (one DB hit) so it's safe.
function skipGlobal(req: import('express').Request): boolean {
  const p = req.path;
  return p === '/health' || p === '/ready' || p === '/auth/refresh' || p === '/api/auth/refresh';
}

const globalLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: 'draft-7', // RateLimit-* headers
  legacyHeaders: false,
  skip: skipGlobal,
  keyGenerator: rateLimitKey,
  handler: (req, res, next) =>
    sendRateLimitResponse(req, res, next, { windowMs: env.rateLimit.windowMs }),
});
app.use(globalLimiter);

// Stricter limiter on the brute-forceable surfaces. These are public routes
// where one IP can guess many credentials. Per-IP keying is correct here —
// we WANT to throttle a single attacker even across many candidate emails.
const AUTH_LIMITER_WINDOW_MS = 15 * 60 * 1000;
const authLimiter = rateLimit({
  windowMs: AUTH_LIMITER_WINDOW_MS,
  max: 20, // 20 attempts per 15min per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next) =>
    sendRateLimitResponse(req, res, next, { windowMs: AUTH_LIMITER_WINDOW_MS }),
});
app.use('/auth/login', authLimiter);
app.use('/auth/forgot-password', authLimiter);
app.use('/auth/reset-password', authLimiter);
app.use('/invitations/setup', authLimiter);
// Same routes under the /api alias for the legacy single-domain deployment.
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/invitations/setup', authLimiter);

// --- AI-endpoint per-user limiter --------------------------------------------
// Anthropic calls cost real money. The global 3000/15min ceiling is too high
// for AI routes — a single user could burn through $10+ of Sonnet calls in
// a minute. Tighter limit: 30 AI requests per 5 minutes per user, with the
// same per-session keying as the global limiter.
const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: env.aiRateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  handler: (req, res, next) => sendRateLimitResponse(req, res, next, { windowMs: 5 * 60 * 1000 }),
});
app.use('/ai', aiLimiter);
app.use('/api/ai', aiLimiter);
// Also cap the AI-heavy endpoints under /jobs (resume tailoring, ATS match,
// per-job match-for-me, enrich-pending). These all hit Anthropic.
app.use('/jobs/:id/skill-match', aiLimiter);
app.use('/jobs/:id/skill-match-for-me', aiLimiter);
app.use('/jobs/:id/ats-match', aiLimiter);
app.use('/jobs/:id/enrich', aiLimiter);
app.use('/jobs/:id/customize-resume', aiLimiter);
app.use('/api/jobs/:id/skill-match', aiLimiter);
app.use('/api/jobs/:id/skill-match-for-me', aiLimiter);
app.use('/api/jobs/:id/ats-match', aiLimiter);
app.use('/api/jobs/:id/enrich', aiLimiter);
app.use('/api/jobs/:id/customize-resume', aiLimiter);

// --- Health + readiness -------------------------------------------------------
// /health = liveness (the process is up and responsive)
// /ready  = readiness (deps responding; safe to route traffic here)
// Registered on both root and /api so single-domain Nginx proxies (which only
// forward /api/* to the backend) can hit them without an extra location block.
const healthHandler: import('express').RequestHandler = (_req, res) => {
  res.json({
    ok: true,
    service: 'hireorbit-api',
    uptimeSeconds: Math.round(process.uptime()),
  });
};
const readyHandler: import('express').RequestHandler = async (_req, res) => {
  try {
    const { pool } = await import('./config/db');
    await pool.query('SELECT 1');
    res.status(200).json({ ok: true, db: 'reachable' });
  } catch (e: unknown) {
    res.status(503).json({ ok: false, error: e instanceof Error ? e.message : 'unknown' });
  }
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);
app.get('/ready', readyHandler);
app.get('/api/ready', readyHandler);

// --- API routes ---------------------------------------------------------------
// Mounted at both root and /api so two deployment shapes work without code change:
//   - Dedicated API subdomain (api.hireorbitai.com) — clean URLs at root.
//   - Single-domain with reverse proxy (hireorbitai.com/api/*) — legacy alias.
// The router is the same instance; Express doesn't double-execute.
// Mount /api first. If "/" is mounted first, a request like /api/auth/login
// reaches the root router as "/api/auth/login"; it does not match the public
// /auth/login route and falls through to requireAuth, returning "Missing
// bearer token" before the /api mount ever sees it.
app.use('/api', router);
app.use('/', router);

// --- Error handler (must be last) ---------------------------------------------
app.use(errorHandler);

// Ensure the uploads root exists before we start accepting requests. Lazy
// import so we don't pay the fs cost in unit tests that import server.ts.
import('node:fs').then(({ promises: fs }) => {
  void fs.mkdir(env.storage.uploadsDir, { recursive: true });
});

// --- Listen + graceful shutdown ----------------------------------------------
const server = app.listen(env.port, () => {
  logger.info({ port: env.port, env: env.nodeEnv }, 'HireOrbit API listening');
  // Opt-in runtime admin bootstrap. Off by default — the canonical path is
  // the SQL seed in database/seed-default-admin.sql which runs once when you
  // apply migrations. Set ENABLE_DEFAULT_ADMIN=true if you'd rather provision
  // from Node (e.g. on a fresh deploy where you can't reach the SQL editor).
  if (process.env.ENABLE_DEFAULT_ADMIN === 'true') {
    void ensureDefaultAdmin();
  }
  // In-process background scheduler — reminders dispatch, session purge,
  // etc. See ./jobs/index.ts for the registry. Off by default in test mode
  // and when DISABLE_JOBS=true so unit-test runs don't fire timers.
  if (env.nodeEnv !== 'test' && process.env.DISABLE_JOBS !== 'true') {
    jobs.start();
  }
  // Boot the realtime LISTEN client. Best-effort: if it fails, the app
  // still works (frontends fall back to polling). Reconnect logic inside
  // the service keeps trying.
  if (env.nodeEnv !== 'test' && process.env.DISABLE_REALTIME !== 'true') {
    startRealtime().catch((err) =>
      logger.error({ err }, 'realtime: initial connect failed, will retry'),
    );
  }
});

// Tolerate slow clients but cap header send time. Nginx in front has its own
// 60s default; keep this slightly higher so the proxy is what decides.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down…');
  // Stop accepting new connections, drain in-flight requests for up to 25s,
  // then force-close. Anything past 30s and Nginx would have already given up.
  const forceClose = setTimeout(() => {
    logger.warn('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 25_000);
  // Stop the scheduler first so an in-flight job tick doesn't get killed
  // mid-write by a hard process.exit. Best-effort — capped at 5s inside.
  void jobs.stop();
  // Close the realtime LISTEN client so we don't dangle the dedicated PG
  // connection across the restart.
  void stopRealtime();
  server.close((err) => {
    clearTimeout(forceClose);
    if (err) {
      logger.error({ err }, 'Error during server.close');
      process.exit(1);
    }
    logger.info('HTTP server closed cleanly');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Last-resort logging — never silently die on an unhandled rejection.
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});
