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
  if (/fonts\.(googleapis|gstatic)|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED/.test(m.text())) return;
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
  // Screenshots want a consistent frame, not an adaptive one.
  GWShell.stage.setQuality(1);
  GWShell.renderHud();
});

let index = 3;
for (const g of games) {
  if (only.length && !only.includes(g.id)) continue;
  const label = String(index++).padStart(2, '0') + '-' + g.id;
  const before = errors.length;

  await page.evaluate((id) => {
    const floor = GWConfig.FLOORS.findIndex((f) => f.games.includes(id));
    GWShell.enterFloor(floor, id);
  }, g.id);
  await sleep(900);
  await shot(label);

  // Play one hand, answering any mid-hand prompt by taking the first option.
  const played = await page.evaluate(async () => {
    const shell = window.GWShell;
    document.getElementById('btnPlay').click();
    const deadline = Date.now() + 95000;
    let answered = 0, picked = 0;
    while (shell.busy && Date.now() < deadline && answered + picked < 40) {
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
    return { busy: shell.busy, answered, picked, status: (document.getElementById('gameStatus').textContent || '').slice(0, 60) };
  });

  await sleep(400);
  await shot(label + '-result');
  const fresh = errors.slice(before);
  console.log(
    (g.id + ':').padEnd(14),
    played.busy ? 'STILL BUSY' : 'ok',
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
  process.exit(1);
}
console.log('no console or page errors');
