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

  // --- Anthropic ---
  ANTHROPIC_API_KEY: optionalKey,
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  // Heavier model for long-form training content generation (lesson bodies,
  // capstone). Outline + quiz calls stay on the cheaper ANTHROPIC_MODEL.
  TRAINING_CONTENT_MODEL: z.string().default('claude-sonnet-4-6'),
  // How training AI generation reaches a model:
  //   subscription — shell out to the `claude` CLI, authenticated by the
  //                   operator's Claude Max login (or CLAUDE_CODE_OAUTH_TOKEN).
  //                   No per-token API billing. (default)
  //   api          — use the Anthropic Messages API with ANTHROPIC_API_KEY.
  //   stub         — never call a model; always return editable stubs.
  TRAINING_AI_PROVIDER: z.enum(['subscription', 'api', 'stub']).default('subscription'),
  // OAuth token from `claude setup-token` (Max plan). Lets the CLI auth on a
  // headless VPS where there's no interactive login. Optional locally.
  CLAUDE_CODE_OAUTH_TOKEN: optionalKey,
  // Path to the Claude Code CLI binary (override if not on PATH).
  CLAUDE_CLI_PATH: z.string().default('claude'),

  // --- Email (Brevo only) ---
  // Per the auth spec, ALL transactional email goes through Brevo. The
  // previous multi-provider EMAIL_PROVIDER switch + Resend/SendGrid keys
  // have been removed. If you need to swap providers in the future, do it
  // by editing brevo.service.ts — env stays Brevo-shaped.
  BREVO_API_KEY: z.string().min(10, 'BREVO_API_KEY is required (xkeysib-...)'),
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

  // --- Trust proxy (set to 1 behind Nginx/CloudPanel, 0 if direct) ---
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
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

/**
 * Validated, typed config. Import this anywhere in the backend instead of
 * touching `process.env` directly so the typechecker enforces the schema.
 */
export const env = {
  port: e.PORT,
  nodeEnv: e.NODE_ENV,
  isProd: e.NODE_ENV === 'production',
  appUrl: e.APP_URL,
  corsOrigins: e.CORS_ORIGIN,
  trustProxy: e.TRUST_PROXY,
  rateLimit: {
    windowMs: e.RATE_LIMIT_WINDOW_MS,
    max: e.RATE_LIMIT_MAX,
  },
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
  anthropic: {
    apiKey: e.ANTHROPIC_API_KEY,
    model: e.ANTHROPIC_MODEL,
    contentModel: e.TRAINING_CONTENT_MODEL,
    provider: e.TRAINING_AI_PROVIDER,
    oauthToken: e.CLAUDE_CODE_OAUTH_TOKEN,
    cliPath: e.CLAUDE_CLI_PATH,
  },
  email: {
    // Single provider — Brevo. Kept under env.email.* so callers in
    // services/brevo.service.ts read a stable shape.
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
} as const;
