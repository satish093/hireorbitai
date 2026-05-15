import { z } from 'zod';

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
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.string().url()).min(1, 'CORS_ORIGIN must contain at least one valid URL'));

// Optional API keys — empty string is treated as "not configured". The
// feature using the key throws a more specific error later if it actually
// tries to use it (see config/email.ts, services/jobIngestion.service.ts).
const optionalKey = z.string().optional().default('');

// Coerce numerics that arrive as strings from process.env.
const portSchema = z.coerce.number().int().min(1).max(65535).default(4000);
const hoursSchema = z.coerce.number().int().min(1).max(24 * 30).default(72);

const envSchema = z.object({
  // --- Server ---
  PORT: portSchema,
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_URL: z.string().url('APP_URL must be a fully-qualified URL'),
  CORS_ORIGIN: csvUrls,

  // --- Supabase (required) ---
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a fully-qualified URL'),
  SUPABASE_ANON_KEY: z.string().min(20, 'SUPABASE_ANON_KEY looks too short'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'SUPABASE_SERVICE_ROLE_KEY looks too short'),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default('resumes'),

  // --- Anthropic ---
  ANTHROPIC_API_KEY: optionalKey,
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5-20251001'),

  // --- Email (Brevo only) ---
  // Per the auth spec, ALL transactional email goes through Brevo. The
  // previous multi-provider EMAIL_PROVIDER switch + Resend/SendGrid keys
  // have been removed. If you need to swap providers in the future, do it
  // by editing brevo.service.ts — env stays Brevo-shaped.
  BREVO_API_KEY: z.string().min(10, 'BREVO_API_KEY is required (xkeysib-...)'),
  BREVO_SENDER_EMAIL: z.string().email().default('noreply@hireorbitai.com'),
  BREVO_SENDER_NAME: z.string().min(1).default('HireOrbit AI'),

  // --- Auth ---
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
  FRONTEND_URL: z.string().url('FRONTEND_URL must be a fully-qualified URL').default('https://hireorbitai.com'),

  // --- Rate limiting (configurable per env) ---
  // Default budget is per authenticated user (see server.ts keyGenerator).
  // 3000/15min covers a user with several open tabs + Messages thread polling
  // (8s) + Sidebar polling (60s) + normal navigation. Tighten via env if a
  // scraper shows up; loosen further for a high-tab-count internal team.
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(3000),

  // --- Trust proxy (set to 1 behind Nginx/CloudPanel, 0 if direct) ---
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
});

// Parse + fail-fast. `safeParse` lets us format every error in one shot
// rather than throwing on the first one.
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('\n✗ Invalid environment configuration:\n');
  for (const issue of parsed.error.issues) {
    const path = issue.path.join('.') || '(root)';
    // eslint-disable-next-line no-console
    console.error(`  • ${path}: ${issue.message}`);
  }
  // eslint-disable-next-line no-console
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
  supabase: {
    url: e.SUPABASE_URL,
    anonKey: e.SUPABASE_ANON_KEY,
    serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
    storageBucket: e.SUPABASE_STORAGE_BUCKET,
  },
  anthropic: {
    apiKey: e.ANTHROPIC_API_KEY,
    model: e.ANTHROPIC_MODEL,
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
