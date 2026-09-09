/* Photograph the three cinematics mid-shot.

   They are two and a half seconds long and the whole point is how they look
   while they are running, which no end-state assertion can tell you. */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shots = resolve(here, '..', 'shots');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[ERR] ' + e.message));

await page.goto('file://' + resolve(here, '..', 'nightshift.html'), { waitUntil: 'load' });
await page.waitForSelector('.screen--title', { timeout: 20000 });
await page.waitForTimeout(1600);
await page.screenshot({ path: resolve(shots, 'cine-00-title.png') });

await page.fill('.field', 'Robin');
await page.click('.btn--quiet');
await page.waitForSelector('.screen--lobby');
for (let i = 0; i < 4; i++) { await page.click('.bot-row .btn:last-of-type'); await page.waitForTimeout(80); }
await page.click('.lobby-buttons .btn--primary');
await page.waitForTimeout(1100);
await page.screenshot({ path: resolve(shots, 'cine-01-reveal.png') });

await page.waitForFunction(() => window.NS.world.state.phase === 'play', null, { timeout: 25000 });
await page.waitForTimeout(500);

const shot = async (kind, data, at, name) => {
  await page.evaluate(([k, d]) => window.NS.cinema.play(k, d), [kind, data]);
  await page.waitForTimeout(at);
  await page.screenshot({ path: resolve(shots, name) });
  await page.evaluate(() => window.NS.cinema.stop());
  await page.waitForTimeout(150);
};

await shot('kill', {
  killerColour: 12, killerHat: 4, victimColour: 3, victimHat: 6,
  line: 'YOU ARE DEAD', sub: 'Finish your tasks. Talk to the other ghosts.',
}, 900, 'cine-02-kill.png');

await shot('kill', {
  killerColour: 0, killerHat: 1, victimColour: 7, victimHat: 0,
  line: 'MOSS', sub: 'You saw the whole thing.',
}, 500, 'cine-03-kill-lunge.png');

await shot('eject', {
  name: 'Cobalt', colorIdx: 1, hatIdx: 5, impostor: true,
  line: 'Cobalt was an impostor.', sub: '1 impostor remains.',
}, 2200, 'cine-04-eject.png');

await browser.close();
console.log('cinematics photographed');
