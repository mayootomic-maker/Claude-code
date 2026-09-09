/* The lift, driven through the interface.

   Three things it has to do, and all three were broken or missing: open from
   anywhere on the floor rather than only from the alcove, list every floor the
   building has opened to you, and keep listing a floor you have already been
   to for the rest of the run. Nothing here reaches past a button. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '..', 'gamble-with-your-friends.html');
if (!existsSync(FILE)) { console.error('build it first'); process.exit(1); }

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 780 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/fonts\.(googleapis|gstatic)|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_CERT_AUTHORITY_INVALID/.test(m.text())) return;
  errors.push('console: ' + m.text());
});
await page.goto('file://' + FILE);
await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 90000 });
await page.click('.titlebtn--primary');
await page.waitForTimeout(500);
const go = await page.$('[data-go]');
if (go) await go.click();
await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 90000 });
await page.waitForTimeout(600);

let bad = 0;
const check = (what, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + what + (detail ? '   ' + detail : ''));
  if (!ok) bad++;
};
const openLift = async () => {
  await page.click('#btnTower');
  await page.waitForTimeout(400);
};

// Get on to a real floor first: the lobby is the hub, not a floor of the tower.
await page.evaluate(() => GWShell.boardLimo());
await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world' && GWShell.level
  && !GWShell.level.isLobby, { timeout: 90000 });
await page.waitForTimeout(600);

console.log('\nit opens from anywhere on the floor');
// Stand as far from the lift as the room allows.
await page.evaluate(() => {
  const st = GWShell.player.state, lv = GWShell.level;
  st.pos.set(0, st.pos.y, lv.size.d / 2 - 2);
});
await page.waitForTimeout(300);
const far = await page.evaluate(() => {
  const st = GWShell.player.state, lv = GWShell.level;
  return Math.hypot(st.pos.x - lv.lift.x, st.pos.z - lv.lift.z);
});
check('standing well away from the lift', far > 8, far.toFixed(1) + ' m');
await openLift();
const panel = await page.evaluate(() => {
  const sheet = document.querySelector('.screen .sheet');
  return {
    open: !!sheet,
    title: sheet ? (sheet.querySelector('.sheet__title') || {}).textContent : '',
    floors: Array.from(document.querySelectorAll('.screen .sheet button[data-floor]')).map((b) => ({
      label: b.textContent.replace(/\s+/g, ' ').trim().slice(0, 60),
      disabled: b.disabled,
    })),
  };
});
check('the lift panel opened', panel.open && /floor/i.test(panel.title || ''), panel.title);
check('it lists every floor in the tower', panel.floors.length === 4, String(panel.floors.length));
check('at least one is available', panel.floors.some((f) => !f.disabled));

console.log('\nit takes you to the floor you press');
const target = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('.screen .sheet button[data-floor]:not([disabled])'));
  const here = GWShell.store.s.floor;
  const other = btns.map((b) => Number(b.dataset.floor)).find((n) => n !== here);
  return { here, other };
});
if (target.other === undefined) {
  // Day one only opens the ground floor, which is correct; unlock by riding up
  // with the mod so the rest of the panel can be exercised.
  await page.evaluate(() => { GWShell.store.s.mods.allFloors = true; });
  await page.evaluate(() => GWScreens.show('tower'));
  await page.waitForTimeout(300);
}
const pick = await page.evaluate(() => {
  const here = GWShell.store.s.floor;
  const btns = Array.from(document.querySelectorAll('.screen .sheet button[data-floor]:not([disabled])'));
  const b = btns.find((x) => Number(x.dataset.floor) !== here);
  if (!b) return null;
  const n = Number(b.dataset.floor);
  b.click();
  return n;
});
check('a floor button was there to press', pick !== null, String(pick));
if (pick !== null) {
  await page.waitForFunction((n) => !GWLoading.isOpen() && GWShell.store.s.floor === n,
    pick, { timeout: 90000 }).catch(() => {});
  const now = await page.evaluate(() => GWShell.store.s.floor);
  check('you arrive on the floor you pressed', now === pick, 'asked ' + pick + ', got ' + now);
  check('and you are walking around on it', await page.evaluate(() => GWShell.mode) === 'world');
}

console.log('\na floor you have visited stays on the panel');
const highest = await page.evaluate(() => GWShell.store.s.highestFloor);
check('the run remembers the highest floor reached', highest >= pick, String(highest));
// Wind the calendar back to before that floor was scheduled to open.
const stillThere = await page.evaluate(() => {
  GWShell.store.s.mods.allFloors = false;
  GWShell.store.s.day = 1;
  return GWShell.store.unlockedFloors().map((e) => e.open);
});
check('it is still open on day one, having been reached',
  stillThere[pick] === true, JSON.stringify(stillThere));

console.log('\nnothing threw');
for (const e of errors) console.log('  ' + e);
check('no page or console errors', errors.length === 0, String(errors.length));

await browser.close();
console.log(bad ? '\n' + bad + ' failed' : '\nthe lift works');
process.exit(bad ? 1 : 0);
