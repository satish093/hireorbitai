import { z } from 'zod';
import path from 'node:path';

// Env vars are loaded by Node itself via the `--env-file=.env` flag on the
// `dev` and `start` scripts (a Node 22 built-in, no `dotenv` package required).
// `start:prod` and PM2-managed processes can rely on the host's environment
// being populated some other way (CloudPanel UI, systemd, Docker --env-file,
// etc.) — this module just reads from `process.env`.
//
// Validation happens once at startup. If any required var is missing or
// malformed the process exits with a single readable error block, so we never
// boot with a half-broken config and fail deep inside a library at request
// time.

// Coerce comma-separated origin lists into a string[]. Strict: every entry
// must be a fully-qualified URL. No wildcard fallback (see CORS section in
// server.ts — that file pulls from env.corsOrigins).
const csvUrls = z
  .string()
  .min(1, 'CORS_ORIGIN must list at least one origin')
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().url()).min(1, 'CORS_ORIGIN must contain at least one valid URL'));

// Optional API keys — empty string is treated as "not configured". The
// feature using the key throws a more specific error later if it actually
// tries to use it (see config/email.ts, services/jobIngestion.service.ts).
const optionalKey = z.string().optional().default('');

// Coerce numerics that arrive as strings from process.env.
const portSchema = z.coerce.number().int().min(1).max(65535).default(4000);
const hoursSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(24 * 30)
  .default(72);

const envSchema = z.object({
  // --- Server ---
  PORT: portSchema,
  // Bind address. Defaults to loopback so the API is only reachable via the
  // local nginx reverse proxy; set HOST=0.0.0.0 only if you must expose it
  // directly (e.g. container networking) — never on a shared/multi-tenant box.
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_URL: z.string().url('APP_URL must be a fully-qualified URL'),
  CORS_ORIGIN: csvUrls,

  // --- Database (self-hosted PostgreSQL on the VPS) ---
  DATABASE_URL: z
    .string()
    .min(10, 'DATABASE_URL is required (postgres://user:pass@host:5432/dbname)'),
  DATABASE_SSL: z.enum(['disable', 'require', 'no-verify']).default('disable'),

  // --- Filesystem storage (local uploads dir on the VPS) ---
  // Absolute path. Created on boot if missing.
  UPLOADS_DIR: z.string().min(1).default('/var/lib/hireorbitai/uploads'),
  // Secret used to HMAC-sign download URLs.
  STORAGE_URL_SECRET: z.string().min(32, 'STORAGE_URL_SECRET must be at least 32 chars'),

  // --- Auth tokens ---
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .default(60 * 60 * 24 * 30),

  // --- LlamaParse (free tier — PDF extraction, 1,000 pages/day) ---
  // Get a free key at cloud.llamaindex.ai — no credit card required.
  LLAMA_CLOUD_API_KEY: optionalKey,

  // --- Groq (free tier — resume tailoring + job copilot) ---
  // Get a free key at console.groq.com — no credit card required.
  GROQ_API_KEY: optionalKey,

  // --- Google Gemini (free tier — analysis, scoring, large-context tasks) ---
  // Get a free key at aistudio.google.com — 15 req/min, 1M tokens/day, no card.
  GEMINI_API_KEY: optionalKey,
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  // Hard stop before the 1M free-tier daily token cap. Gemini calls will fail
  // over to the next provider in the chain once this is reached.
  GEMINI_DAILY_TOKEN_LIMIT: z.coerce.number().int().min(1).default(950_000),

  // --- Anthropic ---
  ANTHROPIC_API_KEY: optionalKey,
  // OAuth access token for Claude.ai subscription mode (claude-... format).
  // Obtained from console.anthropic.com → OAuth. Set TRAINING_AI_PROVIDER=oauth
  // to use this instead of ANTHROPIC_API_KEY.
  ANTHROPIC_OAUTH_TOKEN: optionalKey,
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  // Heavier model for long-form training content generation (lesson bodies,
  // capstone). Outline + quiz calls stay on the cheaper ANTHROPIC_MODEL.
  TRAINING_CONTENT_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  // 'api'   — use the Anthropic Messages API with ANTHROPIC_API_KEY (pay-per-token).
  // 'oauth' — use a Claude.ai subscription OAuth token (ANTHROPIC_OAUTH_TOKEN).
  // 'stub'  — never call a model; always return editable stubs.
  TRAINING_AI_PROVIDER: z.enum(['api', 'oauth', 'stub']).default('api'),
  // Free-only policy: the Groq → Gemini → Anthropic generation fallback skips
  // the PAID Anthropic API unless this is explicitly true. Default false keeps
  // the app on free providers (Groq + Gemini) + the rule-based heuristics, even
  // if a Claude credential happens to be present (e.g. a CLI login on the box).
  AI_ALLOW_ANTHROPIC: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // --- Token-cost controls (API provider) ---
  // Free-text inputs (resume bodies, job descriptions) are clipped to this many
  // characters before being sent to the model — input tokens are the dominant
  // API cost on the hot paths. ~6000 chars ≈ 1500 tokens. Lower = cheaper.
  AI_MAX_INPUT_CHARS: z.coerce.number().int().min(500).max(40000).default(6000),
  // Per-job description budget in the batch job matcher (the recommended feed
  // sends many jobs in one call; title + skills carry most of the matching
  // signal, so each description is clipped hard). Lower = much cheaper feed.
  AI_MAX_JOB_DESC_CHARS: z.coerce.number().int().min(120).max(8000).default(600),

  // --- Email (Brevo only) ---
  // Per the auth spec, ALL transactional email goes through Brevo. The
  // previous multi-provider EMAIL_PROVIDER switch + Resend/SendGrid keys
  // have been removed. If you need to swap providers in the future, do it
  // by editing brevo.service.ts — env stays Brevo-shaped.
  //
  // BREVO_MOCK=true — dev/test shortcut. All outbound emails are logged via
  // pino instead of sent. Set any dummy value (≥10 chars) for BREVO_API_KEY
  // when mock mode is on; the key is never read by the HTTP client.
  BREVO_MOCK: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  BREVO_API_KEY: z
    .string()
    .min(
      10,
      'BREVO_API_KEY is required (xkeysib-...) — use any 10+ char dummy when BREVO_MOCK=true',
    ),
  BREVO_SENDER_EMAIL: z.string().email().default('noreply@hireorbitai.com'),
  BREVO_SENDER_NAME: z.string().min(1).default('HireOrbit AI'),

  // --- Auth policy ---
  INVITATION_EXPIRY_HOURS: hoursSchema,
  // 24h temp-password TTL per spec.
  TEMP_PASSWORD_EXPIRY_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  // 15min reset-token TTL per spec.
  RESET_TOKEN_EXPIRY_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  // After N consecutive failures, lock the account for LOCKOUT_MINUTES.
  MAX_FAILED_LOGINS: z.coerce.number().int().min(1).max(50).default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  // Used for cookie-signing if/when we add server-issued cookies. Required.
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 chars'),
  // Frontend origin used in email links (reset / welcome).
  FRONTEND_URL: z
    .string()
    .url('FRONTEND_URL must be a fully-qualified URL')
    .default('https://hireorbitai.com'),

  // --- Rate limiting (configurable per env) ---
  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(3000),
  // Per-user AI endpoint limit (per 5 min). Lower this if Anthropic/Groq costs spike.
  AI_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),

  // --- Trust proxy (set to 1 behind Nginx/CloudPanel, 0 if direct) ---
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),

  // --- Cross-environment database guard ---
  // 'enforce' (default) hard-exits if NODE_ENV and DATABASE_URL disagree about
  // which environment they belong to; 'warn' logs and continues; 'off' skips
  // the check entirely (use only if your DB names don't follow the convention).
  DB_GUARD: z.enum(['enforce', 'warn', 'off']).default('enforce'),

  // --- TURN / WebRTC NAT traversal ---
  // The voice-call stack (frontend/src/hooks/useCall.ts) used to ship with
  // free public OpenRelay (openrelayproject) TURN credentials baked into the
  // bundle. That fell over for cross-continent calls — single US region,
  // shared with thousands of strangers, routinely throttled.
  //
  // The new flow: backend issues short-lived TURN credentials via
  // GET /calls/turn-credentials. The handler asks Cloudflare for ephemeral
  // creds (free 1,000 GB/month, anycast edge across hundreds of POPs),
  // appends a static Metered.ca free fallback (~15 GB/month, regional), and
  // always includes Google STUN. Both providers are optional — if neither
  // is set, the handler still returns STUN-only so dev/test keeps working
  // (calls between same-WiFi devices still work, just no NAT-relay fallback).
  //
  // Cloudflare credentials live at:
  //   dash.cloudflare.com → Realtime → TURN keys
  // Create a TURN key, then copy:
  //   CLOUDFLARE_REALTIME_TURN_KEY_ID  → the key id (cf-…)
  //   CLOUDFLARE_REALTIME_TURN_TOKEN   → the bearer token
  // Metered free creds are issued at dashboard.metered.ca → TURN, then
  // copy the static username + password. Personal free tier: 0.5 GB/day.
  CLOUDFLARE_REALTIME_TURN_KEY_ID: optionalKey,
  CLOUDFLARE_REALTIME_TURN_TOKEN: optionalKey,
  METERED_TURN_USERNAME: optionalKey,
  METERED_TURN_CREDENTIAL: optionalKey,
  // Comma-separated TURN URLs from your Metered dashboard. Typically:
  //   turn:a.relay.metered.ca:80,turn:a.relay.metered.ca:443,turn:a.relay.metered.ca:443?transport=tcp
  // Empty disables the Metered fallback even if credentials are set.
  METERED_TURN_URLS: optionalKey,
  // How long Cloudflare-issued TURN creds live before the client must refetch.
  // Cloudflare caps at 24h; we default to 1h so a leaked credential's blast
  // radius is small. The frontend refetches on every call start anyway.
  TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),

  // Strict org-wide monthly cap on accepted call duration. Protects the
  // Cloudflare Realtime TURN free tier (1,000 GB egress / calendar month).
  // 980 hrs at Opus ~80 kbps ≈ 280 GB — well inside the free ceiling
  // with headroom for both legs of every call. Reset window is the
  // calendar month (UTC). Once the cap is reached, POST /calls/offer
  // returns 503 ("Monthly call capacity reached — service paused until
  // next month") and the frontend surfaces the message as a toast. Set
  // to 0 to disable the cap entirely (useful for dev/test). Integer-only
  // so a misconfig like `0.5` is rejected at boot instead of letting one
  // call through then blocking forever.
  CALLS_MONTHLY_HOUR_CAP: z.coerce.number().int().min(0).default(980),

  // --- Development tooling ---
  // Master switch for the development-only surface: the role/user switch
  // endpoints (/auth/dev/*) and the Super-Admin test panel API (/dev/*).
  // CRITICAL: this is FORCE-DISABLED whenever NODE_ENV=production (see the
  // derived `env.devTools` below) — setting it true in prod has no effect, so
  // none of the dev tooling can ever leak into the live environment.
  DEV_TOOLS: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // Whether to start the in-process background-job scheduler. Default on.
  // Set RUN_SCHEDULER=false on low-RAM / free-tier dev hosts to skip the
  // reminders / jobs-sync / daily-digest / sessions-purge workers entirely.
  RUN_SCHEDULER: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),

  // --- Antivirus (ClamAV) — scans uploaded files via clamd's INSTREAM ---
  // Off by default so local dev / tests / hosts without clamd are unaffected.
  // Turn on in production (CLAMAV_ENABLED=true) once clamd is reachable.
  CLAMAV_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  CLAMAV_HOST: z.string().default('127.0.0.1'),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  // When the scanner is enabled but unreachable, reject the upload
  // (fail-closed) rather than storing an unscanned file. Default closed.
  CLAMAV_FAIL_CLOSED: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),
});

// Parse + fail-fast. `safeParse` lets us format every error in one shot
// rather than throwing on the first one.
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('\n✗ Invalid environment configuration:\n');
  for (const issue of parsed.error.issues) {
    const p = issue.path.join('.') || '(root)';

    console.error(`  • ${p}: ${issue.message}`);
  }

  console.error('\nDouble-check backend/.env against backend/.env.example.\n');
  process.exit(1);
}

const e = parsed.data;

// --- Cross-environment database safety guard ---------------------------------
// There is no RLS and the DB runs as a single privileged Postgres role, so the
// ONLY thing standing between a dev/staging process and production data is the
// connection string. A fat-fingered DATABASE_URL is therefore a data-integrity
// incident, not a typo. This turns that mistake into a fail-fast boot error
// instead of a silent cross-environment read/write.
//
// Heuristic, by database-name / host substring:
//   production DB → contains 'hireorbit_prod'
//   development DB → contains 'hireorbit_dev' or a managed-dev host ('neon.tech')
// If your naming differs, set DB_GUARD=off. NODE_ENV=test is exempt (the DB is
// mocked in the Vitest suite).
if (e.DB_GUARD !== 'off' && e.NODE_ENV !== 'test') {
  // Classify by the database NAME + HOST only — never the raw DSN — so a
  // password/username that happens to contain 'hireorbit_prod'/'neon.tech'
  // can't skew the verdict (false block / false clear).
  let host = '';
  let dbName = '';
  try {
    const u = new URL(e.DATABASE_URL);
    host = u.hostname.toLowerCase();
    dbName = u.pathname.replace(/^\//, '').toLowerCase();
  } catch {
    // Not a parseable URL — fall back to the whole string so we still fail safe.
    dbName = e.DATABASE_URL.toLowerCase();
  }

  const looksProd = dbName.includes('hireorbit_prod');
  const looksDev = dbName.includes('hireorbit_dev') || host.endsWith('neon.tech');

  const violation =
    e.NODE_ENV === 'production'
      ? // Production must AFFIRMATIVELY point at a prod-named DB — a prod
        // process aimed at a dev OR an unrecognized DB is a config error.
        looksDev
        ? 'NODE_ENV=production but DATABASE_URL points at a DEVELOPMENT database'
        : !looksProd
          ? 'NODE_ENV=production but DATABASE_URL is not a recognized production database (its name should contain "hireorbit_prod")'
          : null
      : // Non-production must never point at the production DB.
        looksProd
        ? `NODE_ENV=${e.NODE_ENV} but DATABASE_URL points at the PRODUCTION database (hireorbit_prod)`
        : null;

  if (violation) {
    const banner =
      `Database environment guard tripped:\n  • ${violation}.\n` +
      `  NODE_ENV and the DATABASE_URL database/host must agree.\n` +
      `  Override with DB_GUARD=off only if you use non-standard DB names (not recommended).`;
    if (e.DB_GUARD === 'warn') {
      console.warn(`\n⚠ ${banner}\n`);
    } else {
      console.error(`\n✗ ${banner}\n`);
      process.exit(1);
    }
  }
}

/**
 * Validated, typed config. Import this anywhere in the backend instead of
 * touching `process.env` directly so the typechecker enforces the schema.
 */
export const env = {
  port: e.PORT,
  host: e.HOST,
  nodeEnv: e.NODE_ENV,
  isProd: e.NODE_ENV === 'production',
  // Dev tooling is ON only when explicitly enabled AND not in production.
  // The `&& NODE_ENV !== 'production'` is the hard kill-switch — a stray
  // DEV_TOOLS=true on the prod host is silently ignored.
  devTools: e.DEV_TOOLS && e.NODE_ENV !== 'production',
  runScheduler: e.RUN_SCHEDULER,
  appUrl: e.APP_URL,
  corsOrigins: e.CORS_ORIGIN,
  trustProxy: e.TRUST_PROXY,
  rateLimit: {
    windowMs: e.RATE_LIMIT_WINDOW_MS,
    max: e.RATE_LIMIT_MAX,
  },
  clamav: {
    enabled: e.CLAMAV_ENABLED,
    host: e.CLAMAV_HOST,
    port: e.CLAMAV_PORT,
    timeoutMs: e.CLAMAV_TIMEOUT_MS,
    failClosed: e.CLAMAV_FAIL_CLOSED,
  },
  aiRateLimitMax: e.AI_RATE_LIMIT_MAX,
  database: {
    url: e.DATABASE_URL,
    ssl: e.DATABASE_SSL,
  },
  storage: {
    uploadsDir: path.resolve(e.UPLOADS_DIR),
    urlSecret: e.STORAGE_URL_SECRET,
  },
  jwt: {
    secret: e.JWT_SECRET,
    accessTtlSeconds: e.JWT_ACCESS_TTL_SECONDS,
    refreshTtlSeconds: e.JWT_REFRESH_TTL_SECONDS,
  },
  llamaCloud: {
    apiKey: e.LLAMA_CLOUD_API_KEY || undefined,
  },
  groq: {
    apiKey: e.GROQ_API_KEY || undefined,
  },
  gemini: {
    apiKey: e.GEMINI_API_KEY || undefined,
    model: e.GEMINI_MODEL,
    dailyTokenLimit: e.GEMINI_DAILY_TOKEN_LIMIT,
  },
  anthropic: {
    apiKey: e.ANTHROPIC_API_KEY,
    oauthToken: e.ANTHROPIC_OAUTH_TOKEN,
    model: e.ANTHROPIC_MODEL,
    contentModel: e.TRAINING_CONTENT_MODEL,
    provider: e.TRAINING_AI_PROVIDER,
    maxInputChars: e.AI_MAX_INPUT_CHARS,
    maxJobDescChars: e.AI_MAX_JOB_DESC_CHARS,
    allowFallback: e.AI_ALLOW_ANTHROPIC,
  },
  email: {
    // Single provider — Brevo. Kept under env.email.* so callers in
    // services/brevo.service.ts read a stable shape.
    brevoMock: e.BREVO_MOCK,
    brevoKey: e.BREVO_API_KEY,
    brevoSenderEmail: e.BREVO_SENDER_EMAIL,
    brevoSenderName: e.BREVO_SENDER_NAME,
  },
  frontendUrl: e.FRONTEND_URL,
  invitationExpiryHours: e.INVITATION_EXPIRY_HOURS,
  tempPasswordExpiryHours: e.TEMP_PASSWORD_EXPIRY_HOURS,
  resetTokenExpiryMinutes: e.RESET_TOKEN_EXPIRY_MINUTES,
  maxFailedLogins: e.MAX_FAILED_LOGINS,
  lockoutMinutes: e.LOCKOUT_MINUTES,
  cookieSecret: e.COOKIE_SECRET,
  turn: {
    cloudflare: {
      keyId: e.CLOUDFLARE_REALTIME_TURN_KEY_ID || undefined,
      token: e.CLOUDFLARE_REALTIME_TURN_TOKEN || undefined,
    },
    metered: {
      username: e.METERED_TURN_USERNAME || undefined,
      credential: e.METERED_TURN_CREDENTIAL || undefined,
      urls: e.METERED_TURN_URLS
        ? e.METERED_TURN_URLS.split(',')
            .map((u) => u.trim())
            .filter(Boolean)
        : [],
    },
    credentialTtlSeconds: e.TURN_CREDENTIAL_TTL_SECONDS,
  },
  calls: {
    monthlyHourCap: e.CALLS_MONTHLY_HOUR_CAP,
  },
} as const;
