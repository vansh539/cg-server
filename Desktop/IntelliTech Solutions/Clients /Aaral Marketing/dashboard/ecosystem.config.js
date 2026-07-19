module.exports = {
  apps: [
    {
      name: 'aaral-dashboard',
      script: 'server.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production' },
      restart_delay: 30000,
      // Keep retrying forever after a crash/outage instead of giving up —
      // see whatsapp-bot/ecosystem.config.js for why.
      max_restarts: 1000000,
      min_uptime: '30s',
    },
  ],
};
