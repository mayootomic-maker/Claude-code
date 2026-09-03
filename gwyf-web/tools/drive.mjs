/* Drive the built game in a real browser and photograph it.

   Unit tests pass on code that renders a black screen. This opens the file the
   player opens, walks every table, plays a hand at each and fails on any
   console error or page error along the way. */

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

if (!existsSync(FILE)) { console.error('build it first: node gwyf-web/build.mjs'); process.exit(1); }

const only = process.argv.slice(2);
const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // The Google Fonts link cannot resolve in this sandbox. The page is designed
  // to fall back to the system stack, so this is expected and not a failure.
  if (/fonts\.(googleapis|gstatic)|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_CERT_AUTHORITY_INVALID/.test(m.text())) return;
  errors.push('console: ' + m.text());
});

const shot = async (name) => {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  return name;
};
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto('file://' + FILE);
await page.waitForSelector('#app:not([hidden])', { timeout: 45000 });
await sleep(1200);
console.log('booted');
await shot('01-briefing');

// Into the casino.
await startGame(page);
await sleep(1500);
await shot('02-lobby');

const games = await page.evaluate(() => GWGames.all().map((g) => ({ id: g.id, name: g.name, floor: g.floor })));
console.log('games:', games.map((g) => g.id).join(', '));

// Give ourselves enough money and time to walk the whole tower.
await page.evaluate(() => {
  const s = GWShell.store.s;
  s.mods.allFloors = true;
  s.mods.freezeClock = true;
  s.mods.quietFriends = true;
  s.bank = 500000;
  /* Screenshots want a consistent frame, not an adaptive one -- but pinning it
     at full resolution in a container with a software rasteriser costs half a
     second a frame and the screenshots themselves start timing out. Half is
     still fixed, which is the property that matters. */
  GWShell.stage.setQuality(0.5);
  GWShell.renderHud();
});

let index = 3;
let failures = 0;
for (const g of games) {
  if (only.length && !only.includes(g.id)) continue;
  const label = String(index++).padStart(2, '0') + '-' + g.id;
  const before = errors.length;
  const mark = (what) => { if (process.env.GW_TRACE) console.log('    ' + g.id + ' ' + what + ' +' + ((Date.now() - t0) / 1000).toFixed(1) + 's'); };
  const t0 = Date.now();

  /* Go to the floor, walk to the machine, and use it.

     This used to be `enterFloor(floor, id)` and nothing else. `enterFloor`
     takes a floor and ignores everything after it, so for months this harness
     reported twelve games played while standing in an empty corridor with the
     previous game's panel still on screen -- and the screenshots it saved were
     black. Nothing here may reach past what a player can press. */
  await page.evaluate((id) => {
    // Floors deal a hand from a pool, so the seed has to be one that puts this
    // machine out before the floor is entered.
    const floor = GWConfig.FLOORS.findIndex((f) => (f.pool || f.games || []).includes(id));
    for (let seed = 1; seed < 400; seed++) {
      if (GWConfig.gamesOn(floor, seed).includes(id)) { GWShell.store.s.seed = seed; break; }
    }
    GWShell.enterFloor(floor);
  }, g.id);
  await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world',
    { timeout: 60000 }).catch(() => {});
  await sleep(500);
  const walked = await page.evaluate((id) => {
    const st = GWShell.player.state;
    const a = (GWShell.level.anchors || []).find((x) => x.gameId === id);
    if (!a) return false;
    st.pos.set(a.stand.x, st.pos.y, a.stand.z);
    st.yaw = Math.atan2(-(a.position.x - st.pos.x), -(a.position.z - st.pos.z));
    st.viewYaw = st.yaw; st.pitch = 0; st.viewPitch = 0;
    return true;
  }, g.id);
  mark('on the floor');
  if (!walked) { console.error(g.id.padEnd(14) + 'FAIL never placed on its floor'); failures++; continue; }
  /* Wait for a frame to notice, not for a fixed number of milliseconds. What
     the player is standing in front of is worked out in the render loop, and
     this harness pins the renderer at full quality, which in a container with
     no GPU is one frame every half second. */
  const sees = await page.waitForFunction((id) => {
    const n = GWShell.player.nearest;
    return !!(n && n.anchor && n.anchor.gameId === id);
  }, g.id, { timeout: 25000 }).then(() => true).catch(() => false);
  mark(sees ? 'in reach' : 'NOT in reach');
  if (!sees) { console.error(g.id.padEnd(14) + 'FAIL standing at it and it is not in reach'); failures++; continue; }
  await page.keyboard.press('e');
  const atTable = await page.waitForFunction(
    (id) => GWShell.mode === 'table' && GWShell.game && GWShell.game.id === id,
    g.id, { timeout: 20000 }).then(() => true).catch(() => false);
  mark(atTable ? 'at the table' : 'NEVER opened');
  if (!atTable) { console.error(g.id.padEnd(14) + 'FAIL pressing use never opened it'); failures++; continue; }
  /* Wait for the camera to arrive rather than for a stopwatch. It eases toward
     the table on a clamped delta, so at two frames a second the journey takes
     a dozen real seconds and a screenshot taken after one is a photograph of
     the walk. */
  await page.waitForFunction(() => {
    if (!GWShell.anchor) return false;
    return GWShell.stage.camera.position.distanceTo(GWShell.stage.desired.pos) < 0.05;
  }, null, { timeout: 40000 }).catch(() => {});
  mark('camera arrived');
  await sleep(500);
  await shot(label);
  mark('photographed');

  // Play one hand, answering any mid-hand prompt by taking the first option.
  const played = await page.evaluate(async () => {
    const shell = window.GWShell;
    const bank = shell.store.s.bank;
    let staked = false;
    document.getElementById('btnPlay').click();
    const deadline = Date.now() + 95000;
    let answered = 0, picked = 0;
    while (shell.busy && Date.now() < deadline && answered + picked < 40) {
      if (shell.store.s.bank !== bank) staked = true;
      // Prefer cashing out where a game offers it, so open-ended runs terminate.
      const cash = document.querySelector('#promptBox .promptbtn--cash');
      const first = document.querySelector('#promptBox .promptbtn');
      const spec = shell.pending && shell.pending.spec;
      if (cash || first) {
        (cash || first).click();
        answered++;
      } else if (spec && spec.meshes && spec.meshes.length) {
        // No buttons, so the game wants a click on the table. Project a target
        // into screen space and dispatch a real click at that point.
        const canvas = document.getElementById('scene');
        const rect = canvas.getBoundingClientRect();
        const mesh = spec.meshes[Math.floor(Math.random() * spec.meshes.length)];
        const v = mesh.getWorldPosition(new THREE.Vector3()).project(shell.stage.camera);
        const x = rect.left + (v.x * 0.5 + 0.5) * rect.width;
        const y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
        canvas.dispatchEvent(new MouseEvent('click', {
          clientX: x, clientY: y, bubbles: true, cancelable: true,
        }));
        picked++;
      }
      await new Promise((r) => setTimeout(r, 130));
    }
    return { busy: shell.busy, staked, answered, picked, status: (document.getElementById('gameStatus').textContent || '').slice(0, 60) };
  });

  mark('hand played');
  await sleep(400);
  await shot(label + '-result');
  const fresh = errors.slice(before);
  if (played.busy) failures++;
  if (!played.staked) failures++;
  console.log(
    (g.id + ':').padEnd(14),
    played.busy ? 'STILL BUSY' : played.staked ? 'ok' : 'NEVER TOOK THE MONEY',
    'answers:' + played.answered,
    'picks:' + played.picked,
    fresh.length ? 'ERRORS ' + fresh.length : ''
  );
}

// Overlays.
await page.evaluate(() => GWScreens.show('tower'));
await sleep(500); await shot('90-tower');
await page.evaluate(() => GWScreens.show('shop'));
await sleep(400); await shot('91-shop');
await page.evaluate(() => GWScreens.show('shop', { tab: 'parts' }));
await sleep(300); await shot('92-backroom');
await page.evaluate(() => { GWScreens.close(); GWModMenu.toggle(); });
await sleep(400); await shot('93-modmenu');
await page.evaluate(() => { GWModMenu.close(); GWShell.endDay(); });
await sleep(700); await shot('94-report');

await browser.close();

console.log('\nshots in ' + SHOTS);
if (errors.length) {
  console.error('\n' + errors.length + ' ERROR(S):');
  for (const e of [...new Set(errors)].slice(0, 25)) console.error('  ' + e);
}
if (failures) console.error(failures + ' game(s) did not play');
if (errors.length || failures) process.exit(1);
console.log('no console or page errors, and every game took a bet');
