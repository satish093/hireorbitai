import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import hpp from 'hpp';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import crypto from 'node:crypto';

import { env } from './config/env';
import { logger } from './config/logger';
import { ensureDefaultAdmin } from './config/bootstrap';
import { router } from './routes';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// --- Trust proxy --------------------------------------------------------------
// CloudPanel / Nginx terminates TLS in front of us. Tell Express to honour the
// X-Forwarded-* headers so req.ip, req.protocol, and rate-limit keying work
// correctly. TRUST_PROXY=1 means "trust one hop" (the local reverse proxy).
app.set('trust proxy', env.trustProxy);

// --- Security headers ---------------------------------------------------------
app.use(helmet({
  // Allow the frontend (served from a different origin) to read normal API
  // responses. Disable COEP because we don't host cross-origin embeds that
  // would benefit from it, and enabling it tends to break image previews.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
}));

// --- CORS ---------------------------------------------------------------------
// Strict allowlist sourced from env. No wildcard fallback — if CORS_ORIGIN is
// misconfigured the env schema will have already exited the process.
//
// We normalize both sides (lowercase + trim trailing slash) so a slightly
// off env value (`https://hireorbitai.com/`) still matches the browser's
// `Origin: https://hireorbitai.com` header.
const normalizedAllowlist = env.corsOrigins.map((o) => o.toLowerCase().replace(/\/+$/, ''));
app.use(cors({
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
}));

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
    genReqId: (req) => (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
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
// 15s (~720/15min/user) plus each page navigation fires several reads, so a
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
function sendRateLimitResponse(_req: import('express').Request, res: import('express').Response, _next: unknown, opts: { windowMs: number }) {
  res.setHeader('Retry-After', Math.ceil(opts.windowMs / 1000).toString());
  res.status(429).json({
    error: 'Too many requests. Please slow down.',
    retry_after_seconds: Math.ceil(opts.windowMs / 1000),
  });
}

const globalLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: 'draft-7', // RateLimit-* headers
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/ready',
  keyGenerator: (req) => {
    // requireAuth sets req.user; before that we only have the IP.
    const u = (req as unknown as { user?: { id?: string } }).user;
    if (u?.id) return `u:${u.id}`;
    return `ip:${req.ip ?? 'unknown'}`;
  },
  handler: (req, res, next) => sendRateLimitResponse(req, res, next, { windowMs: env.rateLimit.windowMs }),
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
  handler: (req, res, next) => sendRateLimitResponse(req, res, next, { windowMs: AUTH_LIMITER_WINDOW_MS }),
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

// --- Health + readiness -------------------------------------------------------
// /health = liveness (the process is up and responsive)
// /ready  = readiness (deps responding; safe to route traffic here)
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'hireorbit-api',
    uptimeSeconds: Math.round(process.uptime()),
    nodeEnv: env.nodeEnv,
  });
});

app.get('/ready', async (_req, res) => {
  // Cheap readiness probe — verifies the Supabase URL is reachable from this
  // process. Doesn't actually hit Postgres so it stays fast.
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`${env.supabase.url}/auth/v1/health`, { signal: ctl.signal });
    clearTimeout(t);
    res.status(r.ok ? 200 : 503).json({ ok: r.ok, supabase: r.status });
  } catch (e: unknown) {
    res.status(503).json({ ok: false, error: e instanceof Error ? e.message : 'unknown' });
  }
});

// --- API routes ---------------------------------------------------------------
// Mounted at both root and /api so two deployment shapes work without code change:
//   - Dedicated API subdomain (api.hireorbitai.com) — clean URLs at root.
//   - Single-domain with reverse proxy (hireorbitai.com/api/*) — legacy alias.
// The router is the same instance; Express doesn't double-execute.
app.use('/', router);
app.use('/api', router);

// --- Error handler (must be last) ---------------------------------------------
app.use(errorHandler);

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
