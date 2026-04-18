/**
 * Smoke test: Renderer mount — Sprint 25.7
 *
 * Launches the built Electron app and verifies:
 *  1. The #root element renders meaningful content (>100 chars).
 *  2. No CSP-related console errors appear.
 *  3. No Vite preamble errors appear.
 *  4. No uncaught page errors are thrown.
 *
 * Prerequisites:
 *   npm run build   (must succeed before running this test)
 *
 * Note: In non-packaged mode, Electron opens DevTools as a detached window.
 * The test must select the renderer window (file:// URL) not the DevTools window.
 */

import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';

test.describe('GDeveloper Renderer Mount', () => {
  test('renders without CSP violations or blank screen', async () => {
    const consoleMessages: { type: string; text: string }[] = [];
    const pageErrors: string[] = [];

    // Launch the built Electron app
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '../../dist-electron/main/index.js')],
      env: {
        ...process.env,
        // Ensure we test the production-like path (no dev server URL)
        ELECTRON_RENDERER_URL: '',
        NODE_ENV: 'production',
      },
    });

    try {
      // In non-packaged mode, DevTools opens as a detached window and may be
      // captured as the first window. We need the renderer window (file:// URL).
      // Wait a moment for both windows to be available, then pick the right one.
      await new Promise((r) => setTimeout(r, 2000));

      let window = electronApp.windows().find(
        (w) => w.url().startsWith('file://'),
      );

      // Fallback: if no file:// window yet, wait for the next window event
      if (!window) {
        window = await electronApp.firstWindow();
        // If this is DevTools, wait for the next window
        if (window.url().includes('devtools://')) {
          window = await electronApp.waitForEvent('window', {
            predicate: (w) => !w.url().includes('devtools://'),
            timeout: 15_000,
          });
        }
      }

      // Collect console messages on the renderer window
      window.on('console', (msg) => {
        consoleMessages.push({ type: msg.type(), text: msg.text() });
      });

      // Collect page errors
      window.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });

      // Wait for the app to be ready — allow generous time for initial load
      await window.waitForLoadState('domcontentloaded');

      // Give React time to mount; poll for #root to have content
      await window.waitForFunction(
        () => {
          const root = document.getElementById('root');
          return root && root.innerHTML.length > 100;
        },
        { timeout: 30_000 },
      );

      // ── Assertion 1: #root has meaningful content ──
      const rootHTML = await window.$eval('#root', (el) => el.innerHTML);
      expect(rootHTML.length).toBeGreaterThan(100);

      // ── Assertion 2: No CSP violation errors ──
      const cspErrors = consoleMessages.filter(
        (m) =>
          m.type === 'error' &&
          (m.text.toLowerCase().includes('content security policy') ||
            m.text.toLowerCase().includes('content-security-policy') ||
            m.text.includes('Refused to execute inline script') ||
            m.text.includes('Refused to evaluate a string')),
      );
      expect(cspErrors, `CSP errors found: ${JSON.stringify(cspErrors)}`).toHaveLength(0);

      // ── Assertion 3: No Vite preamble errors ──
      const preambleErrors = consoleMessages.filter(
        (m) =>
          m.type === 'error' &&
          (m.text.includes('__vite__') ||
            m.text.includes('preamble') ||
            m.text.includes('@vitejs/plugin-react')),
      );
      expect(
        preambleErrors,
        `Preamble errors found: ${JSON.stringify(preambleErrors)}`,
      ).toHaveLength(0);

      // ── Assertion 4: No uncaught page errors ──
      expect(pageErrors, `Page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
    } finally {
      await electronApp.close();
    }
  });
});
