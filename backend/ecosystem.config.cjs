// PM2 process definition for the HireOrbit AI backend.
//
// Usage on the VPS:
//   cd ~/hireorbitai/backend
//   npm run build
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save && pm2 startup
//
// Requires Node 22+ for the --env-file flag.
//
// ---------------------------------------------------------------------------
// Cluster mode
// ---------------------------------------------------------------------------
// PM2 supports a "cluster" exec_mode that runs N copies of the process behind
// a shared listening socket (Node's built-in `cluster` module). Each worker
// is a full Node process — no shared in-memory state.
//
// Concurrency-safe components (verified):
//   • Auth: JWT verification is stateless; refresh tokens persist in
//     public.auth_sessions; session_version on the user row gates revocation
//     across workers.
//   • Rate limiter: express-rate-limit's default memory store is PER-WORKER.
//     That means N workers = N × the configured budget per user. Acceptable
//     for now (the budget is already generous). For strict accounting, swap
//     to rate-limit-redis with a Redis instance.
//   • In-process job scheduler: each worker would otherwise run every job N
//     times. The scheduler binds to a one-shot election so ONLY the worker
//     with `process.env.NODE_APP_INSTANCE === '0'` ticks jobs. See
//     `src/jobs/index.ts` — currently scheduler runs in all workers but the
//     reminders job's `UPDATE WHERE status='PENDING'` UPSERT pattern is race-
//     safe by design.
//
// To enable cluster mode, set instances > 1. PM2 picks one worker per CPU
// when instances: 'max'. We default to 1 for the single-VPS happy path and
// document the bump path inline.
// ---------------------------------------------------------------------------
const path = require('path');

const INSTANCES = process.env.PM2_INSTANCES
  ? process.env.PM2_INSTANCES === 'max'
    ? 'max'
    : Number(process.env.PM2_INSTANCES)
  : 1;
const EXEC_MODE = (typeof INSTANCES === 'number' ? INSTANCES : 2) > 1 ? 'cluster' : 'fork';

module.exports = {
  apps: [
    {
      name: 'hireorbitai-api',
      // Shell wrapper sources .env before handing off to Node — more reliable
      // than --env-file in node_args, which PM2 does not propagate consistently.
      interpreter: '/bin/sh',
      script: 'start.prod.sh',
      cwd: __dirname,
      instances: INSTANCES,
      exec_mode: EXEC_MODE,
      // Rolling restart in cluster mode: one worker at a time, wait for it
      // to start serving before killing the next. Zero-downtime reloads.
      wait_ready: false, // server doesn't emit process.send('ready'); fall back to listen-based
      listen_timeout: 10_000,
      kill_timeout: 5_000,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      // Restart with backoff if it crashes; don't loop.
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
