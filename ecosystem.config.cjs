module.exports = {
  apps: [
    {
      name: 'vochus-easysave',
      script: 'server.js',
      cwd: '/home/administrator/vochus-easysave',
      instances: 2,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      kill_timeout: 5000,     // give in-flight requests 5s to finish before SIGKILL
      wait_ready: false,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: 3004,
      },
      error_file: '/home/administrator/vochus-easysave/logs/error.log',
      out_file: '/home/administrator/vochus-easysave/logs/out.log',
      log_file: '/home/administrator/vochus-easysave/logs/combined.log',
      time: true,
    },
  ],
};
