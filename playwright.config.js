import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    viewport: { width: 1440, height: 1000 },
    launchOptions: existsSync(systemChrome) ? { executablePath: systemChrome } : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `"${process.execPath}" tests/browser-server.mjs`,
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 10000,
  },
});
