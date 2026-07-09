module.exports = {
  apps: [
    {
      name: 'aaral-bridge',
      script: 'src/whatsapp/bot.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production' },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 30000,
      max_restarts: 5,
      min_uptime: '30s',
      kill_timeout: 5000,
    },
  ],
};
