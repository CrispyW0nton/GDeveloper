/**
 * Regression test: Settings tier change — Sprint 25.9
 *
 * Launches the built Electron app, navigates to Settings, changes the
 * Anthropic API Tier through every option, and asserts zero React
 * render-loop or setState-in-render warnings in the console.
 *
 * IMPORTANT: NODE_ENV is set to 'development' so React emits dev warnings.
 * In production mode, React strips these warnings and the test would be a no-op.
 *
 * Checks for three forbidden patterns:
 *   1. "Cannot update a component … while rendering a different component"
 *   2. "Maximum update depth exceeded"
 *   3. "setState inside useEffect"
 *
 * Prerequisites:
 *   npm run build   (must succeed before running this test)
 */

import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';

/** Forbidden React warning patterns that indicate render-loop or setState bugs. */
const FORBIDDEN_WARNING_PATTERNS = [
  /Cannot update a component .* while rendering a different component/i,
  /Maximum update depth exceeded/i,
  /setState inside useEffect/i,
];

/** Find the renderer window (not DevTools) from all Electron windows. */
async function getRendererWindow(electronApp: Awaited<ReturnType<typeof electron.launch>>) {
  await new Promise((r) => setTimeout(r, 2000));

  let window = electronApp.windows().find((w) => w.url().startsWith('file://'));

  if (!window) {
    window = await electronApp.firstWindow();
    if (window.url().includes('devtools://')) {
      window = await electronApp.waitForEvent('window', {
        predicate: (w) => !w.url().includes('devtools://'),
        timeout: 15_000,
      });
    }
  }
  return window;
}

test.describe('SettingsPanel Tier Change', () => {
  test('changing tier produces no React render-loop or setState warnings', async () => {
    const consoleMessages: string[] = [];

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '../../dist-electron/main/index.js')],
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: '',
        // Use development mode so React emits dev warnings.
        // In production mode these warnings are stripped and the test is a no-op.
        NODE_ENV: 'development',
      },
    });

    try {
      const window = await getRendererWindow(electronApp);

      // Collect ALL console warnings and errors
      window.on('console', (msg) => {
        if (msg.type() === 'warning' || msg.type() === 'error') {
          consoleMessages.push(msg.text());
        }
      });

      await window.waitForLoadState('domcontentloaded');

      // Wait for React to mount
      await window.waitForFunction(
        () => {
          const root = document.getElementById('root');
          return root && root.innerHTML.length > 100;
        },
        { timeout: 30_000 },
      );

      // Clear any messages from initial mount before navigating to Settings
      consoleMessages.length = 0;

      // Navigate to Settings tab
      const settingsButton = window.locator('button', { hasText: 'Settings' }).first();
      await settingsButton.waitFor({ state: 'visible', timeout: 10_000 });
      await settingsButton.click();
      await window.waitForTimeout(1500);

      // Check for warnings just from mounting Settings
      for (const pattern of FORBIDDEN_WARNING_PATTERNS) {
        const mountHit = consoleMessages.find((m) => pattern.test(m));
        expect(mountHit, `Forbidden warning on Settings mount: ${mountHit}`).toBeUndefined();
      }

      // Locate the tier selector
      const tierSelect = window.locator('[data-testid="tier-select"]').first();
      await tierSelect.waitFor({ state: 'visible', timeout: 10_000 });

      // Read all available tier options
      const options = await tierSelect.locator('option').allTextContents();
      expect(options.length).toBeGreaterThanOrEqual(2);

      // Clear messages before tier cycling
      consoleMessages.length = 0;

      // Change tier through every option to provoke any render-phase setState or loop
      for (const opt of options) {
        await tierSelect.selectOption({ label: opt });
        await window.waitForTimeout(500);
      }

      // Also wait a bit for any delayed effects to fire
      await window.waitForTimeout(1000);

      // ── Assertion: no forbidden React warnings ──
      for (const pattern of FORBIDDEN_WARNING_PATTERNS) {
        const hit = consoleMessages.find((m) => pattern.test(m));
        expect(hit, `Found forbidden React warning: ${hit}`).toBeUndefined();
      }
    } finally {
      await electronApp.close();
    }
  });
});
