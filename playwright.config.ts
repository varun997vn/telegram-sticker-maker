import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// This sandbox ships a pre-installed Chromium that may not match the revision
// Playwright would download, so point at it explicitly when it is present.
// CI installs its own browsers and takes the default path.
const preinstalled = '/opt/pw-browsers/chromium';
const executablePath = existsSync(preinstalled) ? preinstalled : undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  // Encoding a sticker runs ffmpeg.wasm single-threaded; give it room.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173/telegram-sticker-maker/',
    trace: 'on-first-retry',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The harness entry point is only emitted for this build.
    command:
      'INCLUDE_TEST_HARNESS=1 npm run build && npm run preview -- --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/telegram-sticker-maker/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
