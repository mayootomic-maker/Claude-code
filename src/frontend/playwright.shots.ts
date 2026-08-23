import { defineConfig, devices } from '@playwright/test';

/**
 * Screenshot capture for design review.
 *
 * `/council-ui` requires real rendered pixels — a design verdict from source is worthless.
 * This config exists so that requirement is satisfiable on a Linux host with no Windows.
 *
 * Chromium is preinstalled at /opt/pw-browsers; never run `playwright install`.
 */
export default defineConfig({
  testDir: './shots',
  outputDir: '../../artifacts/screenshots/.trace',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'dark',
    launchOptions: {
      // The container ships Chromium 1194 while @playwright/test expects a newer build.
      // Point at what is here rather than downloading: `playwright install` is prohibited in
      // this environment, and the rendering we care about is identical.
      executablePath:
        process.env.FD_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    },
  },
  webServer: {
    command: 'pnpm preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
