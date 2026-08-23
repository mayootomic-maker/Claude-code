import { expect, test } from '@playwright/test';

/**
 * Captures every scenario at every supported resolution.
 *
 * These are the artefacts `/council-ui` reviews. They are also the honesty check that matters
 * most: the simulation banner must appear in every single one, because a screenshot pasted
 * into an issue without it would have a wrong diagnosis debugged as if it were real.
 */

const RESOLUTIONS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '3440x1440-ultrawide', width: 3440, height: 1440 },
] as const;

const SCENARIOS = [
  'healthy',
  'background-cpu-spike',
  'cpu-frequency-collapse',
  'gpu-thermal-throttle',
  'paging-storm',
  'unexplained-hitch',
] as const;

const OUT = '../../artifacts/screenshots';

for (const resolution of RESOLUTIONS) {
  test(`live view at ${resolution.name}`, async ({ page }) => {
    await page.setViewportSize({ width: resolution.width, height: resolution.height });
    await page.goto('/');

    await expect(page.getByText('Frame time — last 60 s')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    // The canvas is driven by requestAnimationFrame; give it a couple of frames to paint.
    await page.waitForTimeout(300);

    await expect(page.getByRole('status')).toContainText('Simulation');

    await page.screenshot({ path: `${OUT}/live-${resolution.name}.png` });
  });
}

for (const scenario of SCENARIOS) {
  test(`scenario ${scenario}`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await expect(page.getByText('Frame time — last 60 s')).toBeVisible({ timeout: 15_000 });

    const index = SCENARIOS.indexOf(scenario);
    await page.locator('.rail__scenario').nth(index).click();

    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await page.waitForTimeout(400);

    // Every screenshot must carry the simulation banner. No exceptions, no corner badges.
    await expect(page.getByRole('status')).toContainText('Simulation');

    await page.screenshot({ path: `${OUT}/scenario-${scenario}.png` });
  });
}

test('an unavailable metric renders as a dash, never as zero', async ({ page }) => {
  // The honesty invariant, asserted against rendered output rather than against source.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.getByText('Frame time — last 60 s')).toBeVisible({ timeout: 15_000 });

  await page.locator('.rail__scenario').nth(SCENARIOS.indexOf('cpu-frequency-collapse')).click();
  await page.waitForTimeout(400);

  const cpuTemp = page.locator('.metric-readout', { hasText: 'CPU temp' });
  await expect(cpuTemp.locator('.metric-readout__absent')).toHaveText('—');
  await expect(cpuTemp).toContainText('kernel-mode sensor driver');

  await page.screenshot({ path: `${OUT}/honesty-unavailable-metric.png` });
});
