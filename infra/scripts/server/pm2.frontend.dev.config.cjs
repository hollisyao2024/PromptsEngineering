const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');

module.exports = {
  apps: [
    {
      name: 'frontend-dev',
      cwd: ROOT,
      script: 'pnpm',
      args: '--filter frontend dev',
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      exp_backoff_restart_delay: 200,
      env: {
        PORT: '3000',
        APP_ENVIRONMENT: 'development',
        NODE_TLS_REJECT_UNAUTHORIZED: '1',
      },
      out_file: '/tmp/frontend-dev.log',
      error_file: '/tmp/frontend-dev.log',
      merge_logs: true,
      time: true,
    },
  ],
};
