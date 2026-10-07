import { defineConfig } from '@playwright/test';
import { apps } from './src/apps.ts';

// Every UI application gets its own dev server on consecutive ports; E2E_BASE_PORT moves the first one.
const basePort = Number(process.env.E2E_BASE_PORT || 4310);
if (!Number.isInteger(basePort) || basePort < 1024 || basePort + apps.length - 1 > 65535) {
  throw new Error(`E2E_BASE_PORT must be an integer >= 1024 that leaves room for ${apps.length} consecutive ports, got: ${process.env.E2E_BASE_PORT}`);
}
const port = (index: number) => basePort + index;
// Unset uses the Chromium that "playwright install" downloads; "chrome" or "msedge" reuses an installed browser.
const channel = process.env.E2E_BROWSER_CHANNEL || undefined;

export default defineConfig({
  // No retries: a case that only passes on the second attempt is a flaky case, and qa verify must see it fail.
  retries: 0,
  // The junit report is the whole contract with "pnpm agent -- qa run"; keep outputFile in sync with its suite report path.
  reporter: [['list'], ['junit', { outputFile: 'reports/junit.xml' }]],
  projects: apps.map((app, index) => ({
    name: app.id,
    testDir: `./tests/${app.id}`,
    use: { baseURL: `http://127.0.0.1:${port(index)}`, channel },
  })),
  // E2E_SKIP_WEBSERVER=1 tests applications that are already running on those ports.
  webServer:
    process.env.E2E_SKIP_WEBSERVER === '1'
      ? undefined
      : apps.map((app, index) => ({
          command: app.command.replaceAll('{port}', String(port(index))),
          url: `http://127.0.0.1:${port(index)}`,
          // A stale server on the port would silently test the wrong application.
          reuseExistingServer: false,
          timeout: 120_000,
        })),
});
