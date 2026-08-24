import { expect, test } from '@playwright/test';

/**
 * Captures every scenario at every supported resolution.
 *
 * These are the artefacts `/council-ui` reviews. They are also the honesty check that matters
 * most: the simulation banner must appear in every single one, because a screenshot pasted
 * into an issue without it would have a wrong diagnosis debugged as if it were real.
 */

/**
 * The sizes the scenario captures do not already cover.
 *
 * 1920x1080 is deliberately absent: the scenario loop below captures every scenario at exactly
 * that size, so including it here produced a capture byte-identical to one of those — an
 * artifact claiming a state it had no separate evidence for.
 */
const RESOLUTIONS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '3440x1440-ultrawide', width: 3440, height: 1440 },
] as const;

const SCENARIOS = [
  'healthy',
  'background-cpu-spike',
  'cpu-frequency-collapse',
  'gpu-thermal-throttle',
  'gpu-power-limit',
  'paging-storm',
  'unexplained-hitch',
] as const;

const OUT = '../../artifacts/screenshots';

for (const resolution of RESOLUTIONS) {
  test(`live view at ${resolution.name}`, async ({ page }) => {
    await page.setViewportSize({ width: resolution.width, height: resolution.height });
    await page.goto('/');

    await expect(page.getByText('Frame time — last 60 s')).toBeVisible({ timeout: 15_000 });

    // A populated session, not the healthy one. These captures exist to review layout at four
    // sizes, and the default load shows an empty chart and an empty diagnosis panel — which is
    // exactly what scenario-healthy.png shows, so the two were byte-identical and one of the
    // claimed states had no evidence behind it.
    await page.locator('.rail__scenario').nth(SCENARIOS.indexOf('background-cpu-spike')).click();
    await page.waitForTimeout(250);
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

/**
 * No screen may render the string "NaN".
 *
 * It reached a screenshot: an event the engine declined to explain rendered `CONFIDENCE NaN%` at
 * hero size, because the serializer omits null keys and `undefined !== null` is true, so every
 * guard downstream passed. This walks every scenario and every screen and fails on the string
 * itself, which is the only check that would have caught it.
 */
for (const scenario of SCENARIOS) {
  test(`no screen renders NaN on ${scenario}`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await expect(page.getByText('Frame time — last 60 s')).toBeVisible({ timeout: 15_000 });

    await page.locator('.rail__scenario').nth(SCENARIOS.indexOf(scenario)).click();
    await page.waitForTimeout(250);

    for (const section of ['Live', 'Sessions', 'System', 'Settings']) {
      await page.getByRole('button', { name: section, exact: true }).click();
      await page.waitForTimeout(150);

      const text = await page.locator('.app__main').innerText();
      expect(text, `${section} on ${scenario}`).not.toContain('NaN');
      expect(text, `${section} on ${scenario}`).not.toContain('undefined');
      expect(text, `${section} on ${scenario}`).not.toContain('Infinity');
    }

    // And the inspector, which has its own confidence readout.
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    const marker = page.locator('.chart__marker').first();

    if ((await marker.count()) > 0) {
      await marker.click();
      await marker.click();
      await expect(page.locator('.inspector')).toBeVisible({ timeout: 5_000 });

      const text = await page.locator('.inspector').innerText();
      expect(text, `inspector on ${scenario}`).not.toContain('NaN');
      expect(text, `inspector on ${scenario}`).not.toContain('undefined');
    }
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

  // Cropped to the telemetry strip. A full-page capture here was byte-identical to the
  // cpu-frequency-collapse scenario shot, so the artifact set claimed a state it had no
  // separate evidence for.
  await page.locator('.live__strip').screenshot({
    path: `${OUT}/honesty-unavailable-metric.png`,
  });
});

/**
 * The event inspector, on the two scenarios that exercise its opposite extremes.
 *
 * `gpu-power-limit` has a named cause with vendor testimony behind it; `unexplained-hitch` has
 * no cause at all and exists to prove the screen is still worth opening when the answer is "I
 * do not know". If the second one looks like a failure state rather than a finding, the design
 * is wrong.
 */
for (const scenario of ['gpu-power-limit', 'unexplained-hitch'] as const) {
  test(`event inspector for ${scenario}`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await expect(page.getByText('Frame time — last 60 s')).toBeVisible({ timeout: 15_000 });

    await page.locator('.rail__scenario').nth(SCENARIOS.indexOf(scenario)).click();
    await page.waitForTimeout(300);

    // Two clicks: the first selects the event beside the chart, the second opens it in full.
    const marker = page.locator('.chart__marker').first();
    await marker.click();
    await marker.click();

    await expect(page.locator('.inspector')).toBeVisible({ timeout: 5_000 });
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await page.waitForTimeout(400);

    // The inspector is a screen someone will screenshot to ask for help, so it carries the
    // banner like every other one.
    await expect(page.getByRole('status')).toContainText('Simulation');

    // Every metric panel must state its own sample count. A panel that shows a line without
    // saying how many readings it came from invites a 4 Hz series to be read as continuous.
    await expect(page.locator('.panel').first().locator('.panel__foot')).not.toBeEmpty();

    await page.screenshot({ path: `${OUT}/inspector-${scenario}.png` });
  });
}

test('the inspector says why a confidence was capped, not just what it was', async ({ page }) => {
  // 60 % reads as weak evidence. On this scenario it is strong evidence held back by a missing
  // CPU temperature sensor — a fact about the machine the reader can act on, and one the number
  // alone hides.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.getByText('Frame time — last 60 s')).toBeVisible({ timeout: 15_000 });

  await page.locator('.rail__scenario').nth(SCENARIOS.indexOf('cpu-frequency-collapse')).click();
  await page.waitForTimeout(300);

  const marker = page.locator('.chart__marker').first();
  await marker.click();
  await marker.click();

  await expect(page.locator('.inspector')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Ruled out')).toBeVisible();
  await expect(page.locator('.fact__note')).toContainText('sensor');

  // An unavailable metric keeps its panel. Its absence is why the confidence is capped, and a
  // reader who cannot see the gap cannot understand the cap.
  await expect(page.locator('.panel__absent').first()).toBeVisible();

  await page.screenshot({ path: `${OUT}/inspector-capped-confidence.png` });
});

test('the system view lists what is missing, not only what works', async ({ page }) => {
  // The screen a user reaches after reading "capped because a sensor this diagnosis needs is
  // unavailable" and wanting to know which sensor. A list of only the working metrics would
  // answer the opposite question.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.getByText('Frame time — last 60 s')).toBeVisible({ timeout: 15_000 });

  await page.locator('.rail__scenario').nth(SCENARIOS.indexOf('cpu-frequency-collapse')).click();
  await page.waitForTimeout(200);

  await page.getByRole('button', { name: 'System' }).click();
  await expect(page.locator('.system')).toBeVisible({ timeout: 5_000 });

  // Both halves must be present. A screen showing only availability is a feature list.
  await expect(page.locator('.source__ok').first()).toBeVisible();
  await expect(page.locator('.source__missing').first()).toBeVisible();

  // Provenance is grouped by collector, so a source substitution is visible rather than silent.
  await expect(page.locator('.source__name').first()).not.toBeEmpty();

  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await page.waitForTimeout(300);
  await expect(page.getByRole('status')).toContainText('Simulation');

  await page.screenshot({ path: `${OUT}/system.png`, fullPage: true });
});

test('the sessions list shows what each session could have detected', async ({ page }) => {
  // Two rows both reading "0 stutters" mean different things when one could resolve 3 ms and
  // the other 30 ms. Without the floor beside it, a user reads the second as a clean session.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.getByText('Frame time — last 60 s')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Sessions' }).click();
  await expect(page.locator('.sessions__table')).toBeVisible({ timeout: 5_000 });

  await expect(page.getByRole('columnheader', { name: 'Smallest detectable' })).toBeVisible();
  await expect(page.locator('.sessions__floor').first()).not.toBeEmpty();

  // A session that cannot seed a baseline says so on its own row, not in a footnote.
  await expect(page.locator('.sessions__excluded').first()).toBeVisible();

  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await page.waitForTimeout(200);
  await expect(page.getByRole('status')).toContainText('Simulation');

  await page.screenshot({ path: `${OUT}/sessions.png` });
});

test('settings shows values and the command to change them, not dead switches', async ({
  page,
}) => {
  // The command channel from this window to the measuring process is not built. A switch here
  // would be a switch that does nothing, which is the exact thing invariant 9 forbids.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.getByText('Frame time — last 60 s')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('.settings')).toBeVisible({ timeout: 5_000 });

  // No form controls at all on this screen, disabled or otherwise.
  await expect(page.locator('.settings input, .settings select, .settings__list button')).toHaveCount(0);

  // Every setting carries the command that changes it.
  const settings = page.locator('.setting');
  await expect(settings.first()).toBeVisible();
  await expect(page.locator('.setting__command').first()).toContainText('framedoctor-engine settings');

  // And the file is named, because a setting a user cannot find is one they cannot undo.
  await expect(page.locator('.settings__path')).toContainText('settings.json');

  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await page.waitForTimeout(200);
  await expect(page.getByRole('status')).toContainText('Simulation');

  await page.screenshot({ path: `${OUT}/settings.png` });
});

/**
 * The detection section must read as requirements, never as a live state.
 *
 * There is no foreground window and no GPU here, so any state it claimed would be invented. The
 * assertion is that it says which three things are required and names the command that reports
 * them, rather than showing a "detected: none" that actually means "we did not look".
 */
test('the system view explains what gets measured without claiming to have looked', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.getByText('Frame time — last 60 s')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'System' }).click();
  await expect(page.locator('.detection')).toBeVisible({ timeout: 5_000 });

  // All three requirements, and the fact that it is a conjunction rather than a score.
  await expect(page.locator('.detection__list li')).toHaveCount(3);
  await expect(page.locator('.detection__lede')).toContainText('Not a score');

  // It says it did not look, and what to run in order to.
  await expect(page.locator('.detection')).toContainText('Nothing is detected in simulation mode');
  await expect(page.locator('.detection__command')).toHaveText('framedoctor-engine detect');

  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await page.waitForTimeout(200);

  await page.locator('.detection').screenshot({ path: `${OUT}/detection.png` });
});

/**
 * The baseline panel, which is where the product is most tempted to overstate itself.
 *
 * Three things are asserted rather than merely captured: that the panel names what the bar
 * actually is, that the verdict and the baseline's own standing are both on screen at once, and
 * that nothing in it renders an absent measurement as a number.
 */
test('the baseline panel states its verdict and its own standing together', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.getByText('Frame time — last 60 s')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Sessions' }).click();
  await expect(page.locator('.baseline')).toBeVisible({ timeout: 5_000 });

  // The verdict, and — always, not only when the news is bad — how far the baseline may be used.
  await expect(page.locator('.baseline__verdict')).not.toBeEmpty();
  await expect(page.locator('.baseline__trust')).toContainText('sessions');

  // The band is the scale. Without it the points are floating against nothing.
  await expect(page.locator('.baseline__band')).toHaveCount(1);

  // The axis is not zero-anchored, and the caption says so rather than leaving it to be
  // discovered by a reader comparing two points.
  await expect(page.locator('.baseline__caption')).toContainText('rather than to zero');

  const text = await page.locator('.baseline').innerText();
  expect(text).not.toContain('NaN');
  expect(text).not.toContain('undefined');
  expect(text).not.toContain('Infinity');

  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await page.waitForTimeout(200);

  await page.locator('.baseline').screenshot({ path: `${OUT}/baseline.png` });
});
