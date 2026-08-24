import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Screenshot capture for design review.
 *
 * `/council-ui` requires real rendered pixels — a design verdict from source is worthless.
 * This config exists so that requirement is satisfiable on a Linux host with no Windows.
 */

/**
 * Where Chromium is, on whichever machine this is.
 *
 * The development container pre-provisions it and forbids `playwright install`; CI installs it
 * and has no such directory. This used to name the container's path unconditionally, so every CI
 * run failed to launch a browser — and the failure surfaced as a web-server timeout, which is
 * why it survived several runs before anyone traced it.
 *
 * `undefined` means "use the browser Playwright installed", which is the right answer anywhere
 * the container's copy is absent.
 */
function chromium(): string | undefined {
  const configured = process.env.FD_CHROMIUM;
  if (configured) return configured;

  const container = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return existsSync(container) ? container : undefined;
}

/**
 * The address the preview server binds and the tests poll.
 *
 * Stated once and passed to both. Vite may bind IPv6 loopback only, in which case a health check
 * against 127.0.0.1 never succeeds and Playwright reports a timeout that says nothing about the
 * cause.
 */
const HOST = '127.0.0.1';
const PORT = 4173;

export default defineConfig({
  testDir: './shots',
  outputDir: '../../artifacts/screenshots/.trace',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://${HOST}:${PORT}`,
    colorScheme: 'dark',
    launchOptions: {
      executablePath: chromium(),
    },
  },
  webServer: {
    command: `pnpm preview --host ${HOST} --port ${PORT} --strictPort`,
    url: `http://${HOST}:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    // Without this a failure to start is invisible: the run reports only that the URL never
    // became reachable, and the server's own reason for not starting is discarded.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
