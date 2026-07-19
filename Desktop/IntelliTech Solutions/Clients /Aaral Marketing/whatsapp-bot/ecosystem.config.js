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
      // WhatsApp Web silently soft-throttles reconnects attempted too close
      // together — client.initialize() never resolves or rejects (confirmed
      // live: no 'ready', 'disconnected', 'auth_failure', or unhandled
      // rejection ever fires, only the startup watchdog after 3 min). A
      // flat restart_delay retries at the same doomed cadence forever and
      // never lets the throttle actually clear on its own. Exponential
      // backoff (10s, 20s, 40s... capped at PM2's 15min ceiling) means a
      // real cooldown emerges automatically after a few failed attempts,
      // so it self-heals after a power cut or ISP outage without anyone
      // having to notice and manually wait it out.
      exp_backoff_restart_delay: 10000,
      // Client-facing production bot: after a power cut or ISP outage, this
      // must keep retrying forever rather than giving up after a handful of
      // failed attempts and sitting dead until someone manually restarts it
      // (confirmed live: capping this at 5 left the bot permanently stopped
      // after one rough patch of reconnects).
      max_restarts: 1000000,
      min_uptime: '30s',
      kill_timeout: 5000,
    },
  ],
};
