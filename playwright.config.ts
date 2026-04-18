import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for GDeveloper smoke tests.
 * These tests launch the built Electron app and verify basic rendering.
 */
export default defineConfig({
  testDir: './tests/smoke',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
