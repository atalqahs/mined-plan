import { defineConfig } from '@playwright/test';

/**
 * Tests of the PACKAGED desktop app (electron-builder output), not the dev server.
 * Build first: `npm run dist:linux-dir` (Linux) or `npm run dist:win-dir` (Windows).
 * Set DESKTOP_APP_DIR to test another unpacked build folder.
 */
export default defineConfig({
  testDir: 'tests/desktop',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
});
