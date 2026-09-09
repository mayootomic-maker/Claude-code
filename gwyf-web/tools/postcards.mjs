/* Stand where a player stands and photograph what they see.

   One shot per machine on every floor, taken from the spot the level generator
   picked to stand at, looking at the machine. It is the only way to check that
   a floor reads as a room rather than as a list of props -- and it catches the
   things a unit test cannot: a machine facing a wall, a table with no lamp over
   it, a cabinet whose window is unlit.

   Usage: node gwyf-web/tools/postcards.mjs [outDir] */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Through the front door.

   The game opens on a title screen now, so every harness that used to click
   the briefing's button straight after boot has to press Play first. Kept as
   one function rather than five copies of the same two clicks. */
async function startGame(page) {
  await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 60000 });
  const title = await page.$('#title:not([hidden])');
  if (title) {
    await page.click('.titlebtn--primary');
    await page.waitForTimeout(500);
  }
  const go = await page.$('[data-go]');
  if (go) {
    await go.click();
    await page.waitForTimeout(400);
  }
}


const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '..', 'gamble-with-your-friends.html');
const OUT = process.argv[2] || '/tmp/gwshots/postcards';
mkdirSync(OUT, { recursive: true });
if (!existsSync(FILE)) { console.error('build it first'); process.exit(1); }

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 750 } });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/fonts\.(googleapis|gstatic)|ERR_/.test(m.text())) return;
  errors.push(m.text());
});

await page.goto('file://' + FILE);
await page.waitForSelector('#app:not([hidden])', { timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#app:not([hidden])', { timeout: 60000 });
await startGame(page);
await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 40000 });
await page.evaluate(() => {
  const s = GWShell.store.s;
  s.mods.allFloors = true; s.mods.freezeClock = true; s.mods.quietFriends = true;
  s.bank = 500000;
  GWShell.stage.setQuality(1);
  // The click-to-look prompt is for players, not for photographs.
  document.getElementById('resumeBtn').style.display = 'none';
});

for (const floor of [0, 1, 2, 3]) {
  // Floor zero is entered like the rest. Clicking through the briefing lands in
  // the lobby -- a hub with no machines in it -- so skipping the lift call here
  // photographed the lobby four times over and never the first four tables.
  await page.evaluate((f) => GWShell.enterFloor(f), floor);
  await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 40000 });
  await page.waitForTimeout(1800);

  const machines = await page.evaluate(() => GWShell.anchors.map((r) => r.def.id));

  // A wide shot from the lift, looking down the room.
  await page.evaluate(() => {
    const st = GWShell.player.state;
    st.pos.set(GWShell.level.spawn.x, 0, GWShell.level.spawn.z);
    st.yaw = GWShell.level.spawn.angle;
    st.pitch = -0.04;
  });
  await page.waitForTimeout(1100);
  await page.locator('#scene').screenshot({ path: `${OUT}/f${floor}-00-room.png` });

  for (const id of machines) {
    await page.evaluate((id) => {
      const rec = GWShell.anchors.find((r) => r.def.id === id);
      const a = rec.anchor;
      // Shoot from the spot the level picked, barely stepped back. Backing off
      // further puts pillars between the camera and the table -- the placement
      // only guarantees the stand point itself is clear.
      const yaw = Math.atan2(-(a.position.x - a.stand.x), -(a.position.z - a.stand.z));
      const st = GWShell.player.state;
      st.pos.set(a.stand.x + Math.sin(yaw) * 0.55, 0, a.stand.z + Math.cos(yaw) * 0.55);
      GWShell.level.solids.resolve(st.pos, 0.34);
      GWShell.player.lookAt(a.focus);
    }, id);
    await page.waitForTimeout(950);
    await page.locator('#scene').screenshot({ path: `${OUT}/f${floor}-${id}.png` });
  }
  console.log('floor ' + floor + ': ' + (machines.length + 1) + ' postcards');
}

await browser.close();
console.log('\nwritten to ' + OUT);
if (errors.length) {
  console.error([...new Set(errors)].join('\n'));
  process.exitCode = 1;
}
