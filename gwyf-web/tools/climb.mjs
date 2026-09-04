/* Can you stand on things, and can you climb the parkour with the keys?

   Usage: node gwyf-web/tools/climb.mjs

   This exists because of the worst bug in the project so far, and because
   every harness in the repository passed while it was there.

   Nothing in this world had a top. Every solid was an infinitely tall wall
   over a single floor plane at zero, so a shin-high crate could be walked into
   and never stood on. The run of crates in the yard -- built so the jump, the
   landing and the air control had something to be for, with a ticket on the
   last one -- was scenery. And the jump's apex measured 0.38 m against a first
   step of 0.55 m, so even with tops it could not have been started.

   tools/yard.mjs passed throughout, because it puts the player on top of the
   last crate by setting their height directly and then presses E. That is the
   shape of the mistake worth remembering: a test that arranges the state a
   feature produces, instead of producing it.

   So everything here is keys. Nothing sets a position, a height or a velocity.
   If it can be done here, a person can do it. */
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
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/fonts\.(googleapis|gstatic)|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_CERT_AUTHORITY_INVALID/.test(m.text())) return;
  errors.push('console: ' + m.text());
});

let bad = 0;
const check = (what, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + what + (detail ? '   ' + detail : ''));
  if (!ok) bad++;
};
const at = () => page.evaluate(() => {
  const st = GWShell.player.state;
  return { x: st.pos.x, z: st.pos.z, y: st.y, grounded: st.grounded };
});

await page.goto('file://' + FILE);
await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 90000 });
await page.click('.titlebtn--primary');
await page.waitForTimeout(400);
const go = await page.$('[data-go]');
if (go) await go.click();
await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 90000 });
await page.evaluate(() => GWScreens.close(true)).catch(() => {});
await page.waitForTimeout(900);

const course = await page.evaluate(() => GWShell.level.jumps.map((b) => ({
  x: b.x, z: b.z, w: b.w, d: b.d, h: b.h,
})));

/* How high a jump goes, measured rather than read off a constant. Every step
   of the parkour is judged against this number, so raising one without the
   other cannot pass. */
console.log('\nhow far off the ground a jump gets you');
await page.keyboard.press('Space');
let apex = 0;
for (let i = 0; i < 12; i++) {
  const s = await at();
  apex = Math.max(apex, s.y);
  await page.waitForTimeout(60);
}
check('a jump clears knee height', apex > 0.55, apex.toFixed(2) + ' m at the apex');

/* Walking. Aim, hold W, and let the frame do the rest -- the same steering
   walk.mjs uses, because a straight line into furniture is not a walk. */
async function walkTo(x, z, seconds, jump) {
  await page.keyboard.down('KeyW');
  const until = Date.now() + seconds * 1000;
  let closest = Infinity;
  while (Date.now() < until) {
    const d = await page.evaluate((t) => {
      const p = GWShell.player, st = p.state;
      const dx = t.x - st.pos.x, dz = t.z - st.pos.z;
      // Aiming is looking, which is a mouse a person has; nothing here moves
      // the body.
      st.yaw = Math.atan2(-dx, -dz);
      st.viewYaw = st.yaw;
      return Math.hypot(dx, dz);
    }, { x, z });
    closest = Math.min(closest, d);
    if (d < 0.55) break;
    if (jump && d < 2.2) await page.keyboard.press('Space');
    await page.waitForTimeout(110);
  }
  await page.keyboard.up('KeyW');
  return closest;
}

console.log('\nthe first crate is a thing you can stand on');
const first = course[0];
await walkTo(first.x, first.z + first.d / 2 + 1.4, 8, false);
await walkTo(first.x, first.z, 7, true);
// Let them settle. Checking `grounded` a frame after a hop reports the hop.
await page.waitForTimeout(1400);
let now = await at();
const onFirst = Math.abs(now.x - first.x) < first.w / 2 + 0.3
  && Math.abs(now.z - first.z) < first.d / 2 + 0.3;
check('you end up on top of it, not beside it', onFirst && now.y > first.h - 0.08,
  'y ' + now.y.toFixed(2) + ' of ' + first.h + ', over it ' + onFirst);
check('and standing, not falling', now.grounded);

console.log('\nand the run of them goes all the way up');
for (let i = 1; i < course.length; i++) {
  const b = course[i];
  // Two goes at each. On a software rasteriser the frame is slow enough that a
  // jump can be timed badly; a person would try again too.
  await walkTo(b.x, b.z, 9, true);
  await page.waitForTimeout(400);
  const s1 = await at();
  if (s1.y < b.h - 0.12) { await walkTo(b.x, b.z, 8, true); await page.waitForTimeout(400); }
}
await page.waitForTimeout(700);
now = await at();
const top = course[course.length - 1];
const onTop = Math.abs(now.x - top.x) < top.w / 2 + 0.4
  && Math.abs(now.z - top.z) < top.d / 2 + 0.4;
check('the last crate can be reached on foot', onTop && now.y > top.h - 0.1,
  'y ' + now.y.toFixed(2) + ' of ' + top.h);

/* And the ticket, which is the whole reason the climb is there. Pressed, not
   granted: the anchor refuses below its own height, so this only passes if the
   climb above actually happened. */
console.log('\nand the ticket on top of it is yours');
const before = await page.evaluate(() => {
  const a = (GWShell.level.anchors || []).find((x) => x.action === 'prize');
  const st = GWShell.player.state;
  if (a) {
    st.yaw = Math.atan2(-(a.position.x - st.pos.x), -(a.position.z - st.pos.z));
    st.viewYaw = st.yaw;
  }
  return GWShell.store.meta.tickets;
});
const inReach = await page.waitForFunction(() => {
  const n = GWShell.player.nearest;
  return !!(n && n.anchor && n.anchor.action === 'prize');
}, null, { timeout: 8000 }).then(() => true).catch(() => false);
check('the ticket is in reach from up there', inReach);
await page.keyboard.press('KeyE');
await page.waitForTimeout(600);
const after = await page.evaluate(() => GWShell.store.meta.tickets);
check('and taking it pays a ticket', after === before + 1, before + ' -> ' + after);

console.log('\nand you cannot climb out of the building');
const roof = await page.evaluate(() => GWShell.level.size.height);
check('the walls are still taller than a jump', roof > apex * 3,
  roof + ' m of wall against a ' + apex.toFixed(2) + ' m jump');

console.log('');
for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e);
check('no page or console errors', errors.length === 0, String(errors.length));

await browser.close();
console.log(bad ? '\n' + bad + ' failed' : '\nthe parkour is a parkour');
process.exitCode = bad ? 1 : 0;
