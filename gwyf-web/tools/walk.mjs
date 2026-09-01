/* Walk the tower in a browser and photograph it.

   Drives the real first-person controller -- key events, not teleports -- so
   the collision solver, the interaction cone and the camera all get exercised
   the way a player exercises them. Fails on any console or page error. */

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
const SHOTS = process.env.GW_SHOTS || '/tmp/gwshots';
mkdirSync(SHOTS, { recursive: true });
if (!existsSync(FILE)) { console.error('build it first'); process.exit(1); }

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/fonts\.(googleapis|gstatic)|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED/.test(m.text())) return;
  errors.push('console: ' + m.text());
});

const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const sleep = (ms) => page.waitForTimeout(ms);
const settled = () => page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 40000 });

await page.goto('file://' + FILE);
await page.waitForSelector('#app:not([hidden])', { timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#app:not([hidden])', { timeout: 60000 });
await shot('walk-00-briefing');

await startGame(page);
await sleep(400);
await shot('walk-01-loading');
await settled();
await sleep(1400);
await shot('walk-02-spawn');
console.log('spawned in', await page.evaluate(() => GWShell.mode));

// Give the run enough money and time to walk the whole tower.
await page.evaluate(() => {
  const s = GWShell.store.s;
  s.mods.allFloors = true; s.mods.freezeClock = true; s.mods.quietFriends = true;
  s.bank = 500000;
  // Quality is left adaptive here on purpose. Pinned at full detail a software
  // rasteriser runs at four frames a second, and since animation time is
  // clamped per frame the player then walks at half speed and every crossing
  // times out. Screenshots for looking at are taken by a separate harness.
  GWShell.renderHud();
});

/* Walk toward a target on the floor by pressing the real movement keys. */
async function walkTo(x, z, seconds) {
  // Re-aim as it goes. Pointing once and holding W means the first pillar it
  // slides along is where the walk ends.
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const deadline = Date.now() + seconds * 1000;
  let best = Infinity, stale = 0;
  while (Date.now() < deadline) {
    const dist = await page.evaluate(({ x, z }) => {
      const p = GWShell.player;
      const dx = x - p.state.pos.x, dz = z - p.state.pos.z;
      p.state.yaw = Math.atan2(-dx, -dz);
      return Math.hypot(dx, dz);
    }, { x, z });
    if (dist < 0.7) break;
    // Stuck against something: sidestep for a moment and try again.
    if (dist > best - 0.05) stale++; else stale = 0;
    best = Math.min(best, dist);
    if (stale > 6) {
      stale = 0;
      await page.keyboard.down('KeyA');
      await sleep(360);
      await page.keyboard.up('KeyA');
    }
    await sleep(110);
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
}

for (const floor of [0, 1, 2, 3]) {
  /* Floor zero has to be entered like the rest of them.

     Clicking through the briefing lands you in the lobby, which is a hub with
     fixtures in it and no machines -- so skipping the lift call for floor zero
     walked the harness round the lobby, found nothing to reach, and silently
     reported nothing at all about the first four tables in the game. */
  await page.evaluate((f) => GWShell.enterFloor(f), floor);
  await settled();
  await sleep(1200);
  const name = await page.evaluate(() => GWConfig.FLOORS[GWShell.store.s.floor].name);
  await shot(`walk-1${floor}-floor${floor}`);

  const machines = await page.evaluate(() => GWShell.anchors.map((a) => ({
    id: a.def.id,
    stand: [a.anchor.stand.x, a.anchor.stand.z],
  })));

  let reached = 0;
  for (const m of machines) {
    await walkTo(m.stand[0], m.stand[1], 30);
    await page.evaluate((id) => {
      const rec = GWShell.anchors.find((a) => a.def.id === id);
      // The machine's own focal point, which is what the player turns to when
      // they walk up to it -- not the middle of its footprint.
      GWShell.player.lookAt(rec.anchor.focus || rec.anchor.position);
    }, m.id);
    await sleep(500);
    const near = await page.evaluate(() => {
      const n = GWShell.player.nearest;
      return n ? n.anchor.gameId : null;
    });
    if (near === m.id) reached++;
    else console.log('    could not get within reach of ' + m.id + ' (saw ' + near + ')');
  }
  await shot(`walk-2${floor}-approach`);

  // Step up to one machine, play a hand, step away.
  if (machines.length) {
    await page.evaluate(() => GWShell.player.state && document.dispatchEvent(new Event('x')));
    await page.keyboard.press('KeyE');
    await sleep(1200);
    const mode = await page.evaluate(() => GWShell.mode);
    await shot(`walk-3${floor}-playing`);
    let played = false;
    if (mode === 'table') {
      played = await page.evaluate(async () => {
        document.getElementById('btnPlay').click();
        const t = Date.now();
        let n = 0;
        while (GWShell.busy && Date.now() - t < 60000 && n < 30) {
          const cash = document.querySelector('#promptBox .promptbtn--cash');
          const first = document.querySelector('#promptBox .promptbtn');
          if (cash || first) { (cash || first).click(); n++; }
          await new Promise((r) => setTimeout(r, 130));
        }
        return !GWShell.busy;
      });
      await page.keyboard.press('Escape');
      await sleep(900);
    }
    console.log(`floor ${floor} ${name.padEnd(14)} machines ${machines.length}`
      + `  reached ${reached}/${machines.length}  entered ${mode === 'table'}  played ${played}`
      + `  back in ${await page.evaluate(() => GWShell.mode)}`);
  }
}

await shot('walk-99-final');
await browser.close();
if (errors.length) {
  console.error('\n' + errors.length + ' ERROR(S):');
  for (const e of [...new Set(errors)].slice(0, 20)) console.error('  ' + e);
  process.exitCode = 1;
} else {
  console.log('\nno console or page errors');
}
