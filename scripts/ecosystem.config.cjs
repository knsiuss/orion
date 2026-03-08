/**
 * PM2 ecosystem configuration for EDITH.
 * Usage:
 *   npm install -g pm2
 *   pm2 start scripts/ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup  (follow the printed command to enable on boot)
 */
module.exports = {
  apps: [
    {
      name: "edith",
      script: "src/main.ts",
      interpreter: "node",
      interpreter_args: "--import tsx/esm",
      cwd: "C:\Users\test\OneDrive\Desktop\EDITH",
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: ".edith/logs/pm2-error.log",
      out_file: ".edith/logs/pm2-out.log",
    },
  ],
}
