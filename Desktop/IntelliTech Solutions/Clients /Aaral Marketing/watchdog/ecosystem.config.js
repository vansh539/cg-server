module.exports = {
  apps: [
    {
      name: 'aaral-watchdog',
      script: 'watchdog.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: { NODE_ENV: 'production' },
      restart_delay: 10000,
      max_restarts: 1000000,
      min_uptime: '30s',
    },
  ],
};
