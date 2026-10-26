module.exports = {
  apps: [
    {
      name: 'vochus-easysave-staging',
      script: 'server.js',
      cwd: '/home/administrator/vochus-easysave-staging',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3005,
      },
      error_file: '/home/administrator/vochus-easysave-staging/logs/error.log',
      out_file: '/home/administrator/vochus-easysave-staging/logs/out.log',
      log_file: '/home/administrator/vochus-easysave-staging/logs/combined.log',
      time: true,
    },
  ],
};
