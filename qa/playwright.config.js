const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:3000',
    headless: false,
    slowMo: 300,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  timeout: 60000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'results/last-run.json' }]],
});
