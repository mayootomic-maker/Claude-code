/* The day, from waking up to getting back in the car.

   The shape the game this follows has, and the one thing a screenshot cannot
   check: you come round inside a packing crate in the yard, climb out, take
   the limo to the tower, play, and the night is settled when you get back in
   the car -- not by a screen appearing over the top of wherever you were
   standing when a clock ran out. Everything here goes through the interface. */
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
const page = await browser.newPage({ viewport: { width: 1150, height: 750 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/fonts\.(googleapis|gstatic)|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_CERT_AUTHORITY_INVALID/.test(m.text())) return;
  errors.push('console: ' + m.text());
});
await page.goto('file://' + FILE);
await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 90000 });
await page.click('.titlebtn--primary');
await page.waitForTimeout(400);
const go = await page.$('[data-go]');
if (go) await go.click();
await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 90000 });
await page.waitForTimeout(500);

let bad = 0;
const check = (what, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + what + (detail ? '   ' + detail : ''));
  if (!ok) bad++;
};
/* Walk to a fixture and use it, the way a player does: stand where the level
   says to stand, face it, wait for the frame to notice, press use. */
async function useFixture(action) {
  const found = await page.evaluate((act) => {
    const a = (GWShell.level.anchors || []).find((x) => x.action === act);
    if (!a) return false;
    const st = GWShell.player.state;
    st.pos.set(a.stand.x, st.pos.y, a.stand.z);
    st.yaw = Math.atan2(-(a.position.x - st.pos.x), -(a.position.z - st.pos.z));
    st.viewYaw = st.yaw; st.pitch = 0; st.viewPitch = 0;
    return true;
  }, action);
  if (!found) return false;
  const near = await page.waitForFunction((act) => {
    const n = GWShell.player.nearest;
    return !!(n && n.anchor && n.anchor.action === act);
  }, action, { timeout: 25000 }).then(() => true).catch(() => false);
  if (!near) return false;
  await page.keyboard.press('e');
  await page.waitForTimeout(400);
  return true;
}

console.log('\nyou wake up in a crate');
const start = await page.evaluate(() => {
  const st = GWShell.player.state, lv = GWShell.level;
  return {
    inCrate: !!lv.crate && Math.abs(st.pos.x - lv.crate.x) < 1.0
                         && Math.abs(st.pos.z - lv.crate.z) < 1.0,
    lip: lv.crate ? lv.crate.h : null,
    jumps: (lv.jumps || []).length,
    room: lv.name,
  };
});
check('the day starts inside the crate', start.inCrate, start.room);
check('its walls are a step, not a wall', start.lip !== null && start.lip < 0.8,
  start.lip + ' m');
check('there is a parkour in the yard', start.jumps >= 4, start.jumps + ' boxes');

// You must be able to get out of the box by walking, not only by jumping.
const gotOut = await page.evaluate(async () => {
  const p = GWShell.player, st = p.state;
  st.stick.x = 0; st.stick.y = 1;               // straight ahead, no jumping
  const from = { x: st.pos.x, z: st.pos.z };
  for (let i = 0; i < 180; i++) p.update(1 / 60);
  st.stick.y = 0;
  return Math.hypot(st.pos.x - from.x, st.pos.z - from.z);
});
check('you can walk out of it', gotOut > 1.5, gotOut.toFixed(1) + ' m in three seconds');

console.log('\nthe parkour has something on top of it');
const climbed = await page.evaluate(() => {
  const st = GWShell.player.state, lv = GWShell.level;
  const top = lv.jumps[lv.jumps.length - 1];
  // On top of it and a step back, which is the only place the ticket can be
  // taken from -- standing at the foot of the last box must not be enough.
  st.pos.set(top.x, st.pos.y, top.z - top.d / 2 - 0.5);
  st.y = top.h;
  const a = (lv.anchors || []).find((x) => x.action === 'prize');
  if (!a) return null;
  st.yaw = Math.atan2(-(a.position.x - st.pos.x), -(a.position.z - st.pos.z));
  st.viewYaw = st.yaw;
  return { tickets: GWShell.store.meta.tickets, height: top.h };
});
check('the top box is a real climb', climbed && climbed.height > 2,
  climbed ? climbed.height + ' m' : 'no prize anchor');
await page.waitForTimeout(600);
await page.keyboard.press('e');
await page.waitForTimeout(500);
const after = await page.evaluate(() => GWShell.store.meta.tickets);
check('taking the ticket pays a ticket', after === climbed.tickets + 1,
  climbed.tickets + ' -> ' + after);
await page.keyboard.press('e');
await page.waitForTimeout(400);
const twice = await page.evaluate(() => GWShell.store.meta.tickets);
check('and only once a day', twice === after, String(twice));

const fromBelow = await page.evaluate(async () => {
  const st = GWShell.player.state, lv = GWShell.level;
  const top = lv.jumps[lv.jumps.length - 1];
  GWShell.store.s.prizeTakenOn = -1;            // make it available again
  const before = GWShell.store.meta.tickets;
  st.pos.set(top.x, st.pos.y, top.z - top.d / 2 - 0.5);
  st.y = 0;                                      // on the carpet, not the crate
  GWShell.interact();
  return { before, after: GWShell.store.meta.tickets };
});
check('and not from the floor below it', fromBelow.after === fromBelow.before,
  fromBelow.before + ' -> ' + fromBelow.after);

console.log('\nthe limo takes you to the tower');
await useFixture('shark');
await page.evaluate(() => GWScreens.close(true));
await page.waitForTimeout(200);
const rode = await useFixture('limo');
check('the limo was there to get into', rode);
await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world'
  && GWShell.level && !GWShell.level.isLobby, { timeout: 90000 }).catch(() => {});
check('you arrive on a floor of the tower',
  await page.evaluate(() => GWShell.store.s.phase) === 'floor',
  await page.evaluate(() => GWShell.level.name));

console.log('\nthe doors close and you go back out to the car');
await page.evaluate(() => GWShell.endDay());
await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world',
  { timeout: 90000 }).catch(() => {});
const closed = await page.evaluate(() => ({
  phase: GWShell.store.s.phase,
  lobby: !!(GWShell.level && GWShell.level.isLobby),
  reportUp: !!document.querySelector('.screen .sheet'),
  guide: (document.getElementById('guideText') || {}).textContent || '',
}));
check('you are back in the yard, on your feet', closed.lobby && closed.phase === 'closing',
  closed.phase);
check('no report has appeared over you yet', !closed.reportUp);
check('and you are told to get in the car', /limo/i.test(closed.guide), closed.guide);

console.log('\ngetting in is what settles the night');
const bankBefore = await page.evaluate(() => GWShell.store.s.bank);
await useFixture('limo');
await page.waitForTimeout(700);
const settled = await page.evaluate(() => ({
  phase: GWShell.store.s.phase,
  title: (document.querySelector('.sheet__title') || {}).textContent || '',
  bank: GWShell.store.s.bank,
}));
check('the night is settled', settled.phase === 'report', settled.phase);
check('and the stats come up', /quota/i.test(settled.title), settled.title);
check('the quota came out of the bank', settled.bank !== bankBefore,
  bankBefore + ' -> ' + settled.bank);

console.log('\nnothing threw');
for (const e of errors) console.log('  ' + e);
check('no page or console errors', errors.length === 0, String(errors.length));

await browser.close();
console.log(bad ? '\n' + bad + ' failed' : '\nthe day runs from the crate to the car');
process.exit(bad ? 1 : 0);
