// PM2 process definition for the HireOrbit AI backend.
//
// Usage on the VPS:
//   cd ~/talentbridgeai/backend
//   npm run build
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save && pm2 startup
//
// Requires Node 22+ for the --env-file flag.
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'hireorbit-api',
      // PM2 launches Node with these args before the script. `--env-file`
      // is a Node 22 built-in that loads `.env` next to ecosystem.config.cjs.
      interpreter: 'node',
      interpreter_args: `--env-file=${path.join(__dirname, '.env')}`,
      script: 'dist/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
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
