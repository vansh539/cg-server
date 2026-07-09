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
      max_restarts: 5,
      min_uptime: '30s',
    },
  ],
};
