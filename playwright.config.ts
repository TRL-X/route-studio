import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL,
    browserName: 'chromium',
    locale: 'en-US',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `${process.env.PLAYWRIGHT_SKIP_BUILD === '1' ? '' : 'npm run build && '}npm run preview -- --port 4173 --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
