module.exports = {
  apps: [
    {
      name: 'eguardian-backend',
      script: 'dist/main.js',
      cwd: '/var/www/eguardian/backend',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '400M',
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/eguardian/backend-error.log',
      out_file: '/var/log/eguardian/backend-out.log',
    },
    {
      name: 'eguardian-frontend',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      cwd: '/var/www/eguardian/frontend',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '400M',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/eguardian/frontend-error.log',
      out_file: '/var/log/eguardian/frontend-out.log',
    },
  ],
}
