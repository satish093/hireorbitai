# Environment Variables Reference

All env vars are read from `backend/.env` (gitignored). Copy `backend/.env.example` to get started. The file is loaded via Node 22's `--env-file=.env` flag — no `dotenv` package. Validation runs at startup via Zod (`backend/src/config/env.ts`); the process exits with a readable error block if any required var is missing or malformed.

> **Secrets**: Never commit real keys to `.env.example` or any tracked file. Rotate any key that has been pasted into a committed file.

---

## Server

| Variable               | Description                                                                                        | Default           | Required/Optional |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ----------------- | ----------------- |
| `PORT`                 | HTTP port Node listens on                                                                          | `4000`            | Optional          |
| `NODE_ENV`             | Runtime environment (`development`, `production`, `test`)                                          | `development`     | Optional          |
| `APP_URL`              | Fully-qualified public URL of the app (used in emails, CSP)                                        | —                 | **Required**      |
| `CORS_ORIGIN`          | Comma-separated list of allowed CORS origins (must be valid URLs)                                  | —                 | **Required**      |
| `TRUST_PROXY`          | Express trust-proxy depth. Set `1` behind Nginx/CloudPanel, `0` if Node listens on `:443` directly | `1`               | Optional          |
| `RATE_LIMIT_WINDOW_MS` | Global rate-limit sliding window in milliseconds                                                   | `900000` (15 min) | Optional          |
| `RATE_LIMIT_MAX`       | Max requests per IP per window (auth routes use a stricter internal limit)                         | `3000`            | Optional          |
| `DB_GUARD`             | Cross-environment DB safety check: `enforce` (hard-exit on mismatch), `warn`, or `off`             | `enforce`         | Optional          |

---

## Database

| Variable       | Description                                                            | Default   | Required/Optional |
| -------------- | ---------------------------------------------------------------------- | --------- | ----------------- |
| `DATABASE_URL` | PostgreSQL connection string (`postgres://user:pass@host:5432/dbname`) | —         | **Required**      |
| `DATABASE_SSL` | SSL mode for Postgres connection: `disable`, `require`, or `no-verify` | `disable` | Optional          |

---

## Storage

| Variable             | Description                                                                                                                                                     | Default                        | Required/Optional |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------- |
| `UPLOADS_DIR`        | Absolute path on the VPS where uploaded files are stored. The Node process must own this directory.                                                             | `/var/lib/hireorbitai/uploads` | Optional          |
| `STORAGE_URL_SECRET` | Secret (min 32 chars) used to HMAC-sign short-lived download URLs. Generate with: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` | —                              | **Required**      |

---

## Auth / JWT

| Variable                     | Description                                                                               | Default                   | Required/Optional |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------------------------- | ----------------- |
| `JWT_SECRET`                 | Secret (min 32 chars) used to sign access tokens. Rotate to invalidate all live sessions. | —                         | **Required**      |
| `JWT_ACCESS_TTL_SECONDS`     | Access-token lifetime in seconds                                                          | `3600` (1 h)              | Optional          |
| `JWT_REFRESH_TTL_SECONDS`    | Refresh-token lifetime in seconds. Tokens are stored hashed in `public.auth_sessions`.    | `2592000` (30 d)          | Optional          |
| `COOKIE_SECRET`              | Secret (min 32 chars) for cookie signing. Generate same way as `STORAGE_URL_SECRET`.      | —                         | **Required**      |
| `FRONTEND_URL`               | Frontend origin embedded in email links (password reset, welcome).                        | `https://hireorbitai.com` | Optional          |
| `TEMP_PASSWORD_EXPIRY_HOURS` | How long a temporary password remains valid                                               | `24`                      | Optional          |
| `RESET_TOKEN_EXPIRY_MINUTES` | How long a password-reset token remains valid                                             | `15`                      | Optional          |
| `MAX_FAILED_LOGINS`          | Failed login attempts before the account is locked                                        | `5`                       | Optional          |
| `LOCKOUT_MINUTES`            | Duration of an account lockout after too many failed logins                               | `30`                      | Optional          |

---

## AI (Google Gemini)

The primary AI provider for job matching, resume scoring, and general inference is Google Gemini. Anthropic/Claude keys are retained only for the optional training-content generation path.

| Variable                  | Description                                                                                                                     | Default                     | Required/Optional              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------ |
| `GOOGLE_AI_API_KEY`       | Google AI (Gemini) API key. Required for job matching and resume-scoring features.                                              | —                           | **Required** (for AI features) |
| `GEMINI_MODEL`            | Gemini model ID used for job matching / scoring calls                                                                           | `gemini-2.0-flash`          | Optional                       |
| `TRAINING_AI_PROVIDER`    | How training-content generation reaches a model: `api` (Anthropic Messages API) or `stub` (returns editable stubs, no API call) | `api`                       | Optional                       |
| `ANTHROPIC_API_KEY`       | Anthropic API key. Only needed when `TRAINING_AI_PROVIDER=api`.                                                                 | —                           | Optional                       |
| `ANTHROPIC_MODEL`         | Anthropic model used for outline + quiz generation                                                                              | `claude-haiku-4-5-20251001` | Optional                       |
| `TRAINING_CONTENT_MODEL`  | Anthropic model used for long-form lesson/capstone generation                                                                   | `claude-haiku-4-5-20251001` | Optional                       |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token from `claude setup-token` (Max plan). Required in headless/VPS mode when `TRAINING_AI_PROVIDER=subscription`.       | —                           | Optional                       |
| `CLAUDE_CLI_PATH`         | Path to the Claude Code CLI binary if not on `PATH`                                                                             | `claude`                    | Optional                       |
| `AI_MAX_INPUT_CHARS`      | Max characters from free-text inputs (resume body, JD) sent to the model. ~6000 chars ≈ 1500 tokens.                            | `6000`                      | Optional                       |
| `AI_MAX_JOB_DESC_CHARS`   | Per-job description character budget in the batch job-matcher call                                                              | `600`                       | Optional                       |

---

## Email (Brevo)

All transactional email (invitations, welcome + temp password, password reset, password changed, account locked, reminders, daily digest) is sent exclusively via Brevo's v3 REST API. No other providers are supported.

| Variable             | Description                                                                              | Default                   | Required/Optional |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------- | ----------------- |
| `BREVO_API_KEY`      | Brevo v3 API key (`xkeysib-…`). Obtain from Brevo → SMTP & API → API Keys.               | —                         | **Required**      |
| `BREVO_SENDER_EMAIL` | From-address for all outbound email. Must be authenticated in Brevo (Senders & Domains). | `noreply@hireorbitai.com` | Optional          |
| `BREVO_SENDER_NAME`  | Display name for the sender                                                              | `HireOrbit AI`            | Optional          |

---

## Job Sources

| Variable               | Description                                                                                                                                                                                                  | Default                                                  | Required/Optional |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ----------------- |
| `JOB_SOURCES_MOCK`     | Set `true` to make all job-ingestion drivers return synthetic data (no real API calls). Mock rows use `external_id` prefix `MOCK-`. Clean up with `DELETE FROM public.jobs WHERE external_id LIKE 'MOCK-%';` | `false`                                                  | Optional          |
| `JSEARCH_API_KEY`      | RapidAPI key for JSearch (free Basic plan: 200 req/mo). Also used as fallback for `RAPIDAPI_KEY`.                                                                                                            | —                                                        | Optional          |
| `JSEARCH_COUNTRY`      | Country code for JSearch queries                                                                                                                                                                             | `us`                                                     | Optional          |
| `JSEARCH_QUERIES`      | Pipe- or comma-separated search queries for JSearch                                                                                                                                                          | `software engineer in united states\|data engineer…`     | Optional          |
| `JOOBLE_API_KEY`       | Jooble aggregator API key (free, sign-up required)                                                                                                                                                           | —                                                        | Optional          |
| `JOOBLE_QUERIES`       | Pipe-separated job-title queries for Jooble                                                                                                                                                                  | `software engineer\|data engineer\|full stack developer` | Optional          |
| `JOOBLE_LOCATION`      | Location filter for Jooble queries                                                                                                                                                                           | `United States`                                          | Optional          |
| `USAJOBS_API_KEY`      | USAJobs API key (free, requires email registration per their ToS)                                                                                                                                            | —                                                        | Optional          |
| `USAJOBS_USER_AGENT`   | Your email address, required by USAJobs ToS                                                                                                                                                                  | —                                                        | Optional          |
| `USAJOBS_KEYWORD`      | Keyword used in USAJobs searches                                                                                                                                                                             | `software engineer`                                      | Optional          |
| `SERPAPI_API_KEY`      | SerpAPI key for Google Jobs SERP scraping (free tier: ~100 searches/mo)                                                                                                                                      | —                                                        | Optional          |
| `SERPAPI_QUERY`        | Search query for SerpAPI                                                                                                                                                                                     | `software engineer in united states`                     | Optional          |
| `SEARCHAPI_API_KEY`    | SearchApi.io key for Google Jobs SERP (free tier: 100 credits)                                                                                                                                               | —                                                        | Optional          |
| `SEARCHAPI_QUERY`      | Search query for SearchApi.io                                                                                                                                                                                | `software engineer in united states`                     | Optional          |
| `RAPIDAPI_KEY`         | RapidAPI key shared across LinkedIn, Monster, and other RapidAPI-hosted drivers. Falls back to `JSEARCH_API_KEY` if empty.                                                                                   | —                                                        | Optional          |
| `LINKEDIN_TITLES`      | Pipe-separated job titles for the LinkedIn (Fantastic Jobs) driver                                                                                                                                           | `Software Engineer\|Data Engineer\|Full Stack Developer` | Optional          |
| `LINKEDIN_LOCATIONS`   | Locations for LinkedIn job pulls                                                                                                                                                                             | `United States`                                          | Optional          |
| `LINKEDIN_WINDOW`      | Recency window for LinkedIn posts                                                                                                                                                                            | `24h`                                                    | Optional          |
| `MONSTER_KEYWORDS`     | Pipe-separated keywords for the Monster (RapidAPI) driver                                                                                                                                                    | `software engineer\|data engineer\|full stack developer` | Optional          |
| `MONSTER_LOCATION`     | Location filter for Monster                                                                                                                                                                                  | `United States`                                          | Optional          |
| `MONSTER_COUNTRY_CODE` | Country code for Monster                                                                                                                                                                                     | `en_us`                                                  | Optional          |
| `MONSTER_MAX_ROWS`     | Max results per Monster request                                                                                                                                                                              | `50`                                                     | Optional          |
| `GLASSDOOR_HOST`       | RapidAPI host for Glassdoor Real-Time (interview prep, not job ingestion)                                                                                                                                    | `glassdoor-real-time.p.rapidapi.com`                     | Optional          |

> **Budget note**: `JOB_SYNC_INTERVAL_MS` defaults to 24 h to stay within the JSearch free quota (200 req/mo). Do not shorten without upgrading the JSearch plan. The `monster` source driver is intentionally disabled by default — re-enabling it exhausts the JSearch free quota within a week.

---

## Notifications

| Variable                 | Description                                                                                                                                                                             | Default | Required/Optional |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------- |
| `MATCH_NOTIFY_THRESHOLD` | After each sync, jobs scoring at or above this threshold (0–100) against an active consultant trigger a DM to the consultant's recruiter. Set `100` to effectively disable auto-notify. | `85`    | Optional          |

---

## Invitations

| Variable                  | Description                                         | Default | Required/Optional |
| ------------------------- | --------------------------------------------------- | ------- | ----------------- |
| `INVITATION_EXPIRY_HOURS` | How long an invitation link remains valid (1–720 h) | `72`    | Optional          |

---

## Bootstrap

These vars are only needed in ephemeral environments (e.g. CI) where you want the API process itself to seed the first admin account on boot. The canonical path for real deployments is `npm --prefix backend run bootstrap:admin`.

| Variable                 | Description                                                                                                    | Default       | Required/Optional                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------- |
| `ENABLE_DEFAULT_ADMIN`   | Set `true` to have the process auto-provision the first admin on boot                                          | —             | Optional                                           |
| `DEFAULT_ADMIN_EMAIL`    | Email address for the bootstrap admin                                                                          | —             | Optional (required if `ENABLE_DEFAULT_ADMIN=true`) |
| `DEFAULT_ADMIN_PASSWORD` | Password for the bootstrap admin (min 12 characters). The account is created with `must_change_password=true`. | —             | Optional (required if `ENABLE_DEFAULT_ADMIN=true`) |
| `DEFAULT_ADMIN_NAME`     | Display name for the bootstrap admin                                                                           | —             | Optional                                           |
| `DEFAULT_ADMIN_ROLE`     | Role assigned to the bootstrap admin                                                                           | `SUPER_ADMIN` | Optional                                           |
| `DEFAULT_ADMIN_RESET`    | Set `true` to reset the default admin on every boot (for CI seed resets)                                       | `false`       | Optional                                           |
