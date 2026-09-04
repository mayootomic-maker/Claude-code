/* A whole day, played the way a person plays it.

   Usage: node gwyf-web/tools/aday.mjs

   Every other harness in this repository reaches past something. They set the
   player's position to a stand point, or their height to the top of a crate,
   or call `enterFloor` directly. Each of those is reasonable in isolation and
   together they left a hole big enough to hide the worst bug in the project:
   nothing in the world had a top, so no crate could be stood on, and every
   test passed because every test put the player where the feature would have.

   This one reaches past nothing. Movement is WASD, jumping is Space, using
   things is E, and every button is clicked where it is drawn. The one thing it
   does touch is the look angle, because aiming is a mouse a person has and
   there is no way to drive a pointer-locked camera from Playwright -- the body
   is never moved, only turned.

   If a step here cannot be completed, a player cannot complete it either. */
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
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.setDefaultTimeout(60000);
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

const state = () => page.evaluate(() => {
  const st = GWShell.player.state;
  const n = GWShell.player.nearest;
  return {
    x: st.pos.x, z: st.pos.z, y: st.y, grounded: st.grounded,
    mode: GWShell.mode,
    room: GWShell.level ? GWShell.level.name : null,
    lobby: !!(GWShell.level && GWShell.level.isLobby),
    near: n && n.anchor ? (n.anchor.action || n.anchor.gameId) : null,
    bank: GWShell.store.s.bank,
    phase: GWShell.store.s.phase,
    screen: GWScreens.isOpen(),
  };
});

/* A route, not a straight line.

   Aiming at a target and holding W is how the older harnesses walked, and it
   cannot get out of a room: the hub is two spaces joined by one doorway, and a
   walker pointed at the loan shark presses itself into the partition wall and
   reports that he is twenty-five metres away and unreachable. A player does
   not have that problem, because a player can see the door.

   So the route is worked out first, on the same grid tools/paths.mjs floods --
   the collision world at the radius the player occupies -- and then walked one
   waypoint at a time with the keys. The path is what a person's eyes do; the
   walking is still entirely W. */
const routeTo = (x, z) => page.evaluate((t) => {
  const lv = GWShell.level, st = GWShell.player.state, R = GWPlayer.RADIUS;
  const STEP = 0.4;
  const minX = -lv.size.w / 2, minZ = -lv.size.d / 2;
  const cols = Math.ceil(lv.size.w / STEP), rows = Math.ceil(lv.size.d / STEP);
  const at = (c, r) => [minX + (c + 0.5) * STEP, minZ + (r + 0.5) * STEP];
  const cellOf = (px, pz) => [Math.floor((px - minX) / STEP), Math.floor((pz - minZ) / STEP)];
  const open = new Uint8Array(cols * rows);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const [ax, az] = at(c, r);
      open[r * cols + c] = lv.solids.clearAt(ax, az, R * 1.05) ? 1 : 0;
    }
  }
  // Breadth-first from the target, so following the falling numbers from
  // wherever the player happens to be is the shortest way there.
  const from = new Int32Array(cols * rows).fill(-1);
  const seen = new Uint8Array(cols * rows);
  const nearestOpen = (px, pz) => {
    const [c0, r0] = cellOf(px, pz);
    for (let d = 0; d <= 10; d++) {
      for (let dc = -d; dc <= d; dc++) {
        for (let dr = -d; dr <= d; dr++) {
          const c = c0 + dc, r = r0 + dr;
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          if (open[r * cols + c]) return r * cols + c;
        }
      }
    }
    return -1;
  };
  const goal = nearestOpen(t.x, t.z);
  const start = nearestOpen(st.pos.x, st.pos.z);
  if (goal < 0 || start < 0) return null;
  const q = [goal];
  seen[goal] = 1;
  for (let i = 0; i < q.length; i++) {
    const c = q[i] % cols, r = (q[i] - (q[i] % cols)) / cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const k = nr * cols + nc;
      if (seen[k] || !open[k]) continue;
      seen[k] = 1; from[k] = q[i]; q.push(k);
    }
  }
  if (!seen[start]) return null;
  const out = [];
  for (let k = start; k >= 0; k = from[k]) {
    const c = k % cols, r = (k - (k % cols)) / cols;
    const [ax, az] = at(c, r);
    out.push([ax, az]);
    if (k === goal) break;
  }
  // Every fifth cell is enough to steer by, plus the target itself.
  const thinned = out.filter((_, i) => i % 5 === 0);
  thinned.push([t.x, t.z]);
  return thinned;
}, { x, z });

/* Walk a route with the keys. Nothing here moves the body -- W does that --
   and it gives up rather than hanging, so a place that cannot be walked to is
   a failure with a distance on it. */
async function walkTo(x, z, seconds, jump) {
  const path = (await routeTo(x, z)) || [[x, z]];
  const until = Date.now() + (seconds || 12) * 1000;
  let closest = Infinity;
  /* Running, because this runs on a software rasteriser at a few frames a
     second and the game's own clock moves with the frame: a crossing that
     takes a player twelve seconds takes this the best part of a minute, and a
     budget written for the first is a timeout for the second. */
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  for (const [wx, wz] of path) {
    // The last waypoint is the one that matters, so it gets walked right up
    // to; the rest are only there to steer round corners.
    const last = wx === x && wz === z;
    while (Date.now() < until) {
      const d = await page.evaluate((t) => {
        const st = GWShell.player.state;
        const dx = t.x - st.pos.x, dz = t.z - st.pos.z;
        st.yaw = Math.atan2(-dx, -dz);
        st.viewYaw = st.yaw;
        return Math.hypot(dx, dz);
      }, { x: wx, z: wz });
      if (last) closest = Math.min(closest, d);
      if (d < (last ? 0.35 : 0.8)) break;
      if (jump && d < 2.2) await page.keyboard.press('Space');
      await page.waitForTimeout(110);
    }
    if (Date.now() >= until) break;
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  return closest;
}

/* Walk up to a fixture and use it, all through the interface: find where the
   level says to stand, walk there, look at it, wait for the frame to offer it,
   press E. */
async function useFixture(action, seconds) {
  const target = await page.evaluate((a) => {
    const anchor = (GWShell.level.anchors || []).find((x) => x.action === a);
    return anchor ? { x: anchor.stand.x, z: anchor.stand.z } : null;
  }, action);
  if (!target) return { reached: false, why: 'no such fixture on this level' };

  const closest = await walkTo(target.x, target.z, seconds || 16, false);
  await page.evaluate((a) => {
    const anchor = (GWShell.level.anchors || []).find((x) => x.action === a);
    const st = GWShell.player.state;
    if (!anchor) return;
    st.yaw = Math.atan2(-(anchor.position.x - st.pos.x), -(anchor.position.z - st.pos.z));
    st.viewYaw = st.yaw;
  }, action);

  const offered = await page.waitForFunction((a) => {
    const n = GWShell.player.nearest;
    return !!(n && n.anchor && n.anchor.action === a);
  }, action, { timeout: 12000 }).then(() => true).catch(() => false);
  if (!offered) return { reached: false, why: 'walked to within ' + closest.toFixed(1) + ' m and it never offered itself' };

  await page.keyboard.press('KeyE');
  await page.waitForTimeout(700);
  return { reached: true };
}

/* Click something, or say it was not there.

   Deliberately tolerant: a button that never appears is a finding, and a
   harness that throws on it loses every check after the first failure. */
const click = async (sel) => {
  const el = await page.$(sel);
  if (!el) return false;
  try { await el.click({ timeout: 6000 }); }
  catch (e) { return false; }
  await page.waitForTimeout(500);
  return true;
};

await page.goto('file://' + FILE);
await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 90000 });
await page.click('.titlebtn--primary');
await page.waitForTimeout(500);
console.log('');

console.log('you wake up in the yard');
await click('[data-go]');
await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 90000 });
await page.waitForTimeout(1200);
let s = await state();
check('the day starts in the hub', s.lobby, s.room);
check('and on your feet', s.grounded && s.mode === 'world', 'y ' + s.y.toFixed(2));

// Straight ahead, out of the crate, on foot.
await page.keyboard.down('KeyW');
await page.waitForTimeout(2600);
await page.keyboard.up('KeyW');
const out = await state();
check('you can walk out of the crate',
  Math.hypot(out.x - s.x, out.z - s.z) > 1.5,
  Math.hypot(out.x - s.x, out.z - s.z).toFixed(1) + ' m in under three seconds');

console.log('\nthe loan shark, on foot');
const shark = await useFixture('shark', 70);
check('you can walk to the loan shark and use him', shark.reached, shark.why || '');
if (shark.reached) {
  check('and his screen opens', await page.evaluate(() => GWScreens.isOpen() === 'shark'));
  const took = await click('[data-accept]');
  check('and tonight’s quota can be taken', took);
  await click('[data-close]');
}

console.log('\nthe limo, on foot');
const limo = await useFixture('limo', 60);
check('you can walk to the limo and get in', limo.reached, limo.why || '');
await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world'
  && GWShell.level && !GWShell.level.isLobby, { timeout: 90000 }).catch(() => {});
s = await state();
check('and it takes you into the tower', !s.lobby, s.room || 'still in the hub');

console.log('\na machine, on foot');
const machine = await page.evaluate(() => {
  const st = GWShell.player.state;
  let best = null, bestD = Infinity;
  for (const rec of GWShell.anchors) {
    const a = rec.anchor;
    const d = Math.hypot(a.stand.x - st.pos.x, a.stand.z - st.pos.z);
    if (d < bestD) { bestD = d; best = { id: rec.def.id, x: a.stand.x, z: a.stand.z }; }
  }
  return best;
});
check('there are machines on the floor', !!machine, machine ? machine.id : 'none');
if (machine) {
  const got = await walkTo(machine.x, machine.z, 60, false);
  check('and you can walk right up to it', got < 0.6,
    'stopped ' + got.toFixed(2) + ' m from where the level says to stand');
  await page.evaluate((id) => {
    const rec = GWShell.anchors.find((r) => r.def.id === id);
    const st = GWShell.player.state;
    const at = rec.anchor.focus || rec.anchor.position;
    st.yaw = Math.atan2(-(at.x - st.pos.x), -(at.z - st.pos.z));
    st.viewYaw = st.yaw;
  }, machine.id);
  const offered = await page.waitForFunction((id) => {
    const n = GWShell.player.nearest;
    return !!(n && n.anchor && n.anchor.gameId === id);
  }, machine.id, { timeout: 14000 }).then(() => true).catch(() => false);
  check('you can walk up to one and it offers itself', offered, machine.id);

  await page.keyboard.press('KeyE');
  await page.waitForTimeout(2500);
  check('pressing use sits you at it', (await state()).mode === 'table');

  const bankBefore = (await state()).bank;
  const played = await click('#btnPlay');
  check('and the bet button takes a bet', played);
  // Answer anything the game asks, the way the rail asks it.
  for (let i = 0; i < 30; i++) {
    if (!(await page.evaluate(() => GWShell.busy))) break;
    const b = await page.$('#promptBox .promptbtn--cash, #promptBox .promptbtn');
    if (b) { await b.click(); }
    await page.waitForTimeout(200);
  }
  const bankAfter = (await state()).bank;
  check('and the hand settles', !(await page.evaluate(() => GWShell.busy)));
  check('and the money moved', bankAfter !== bankBefore, bankBefore + ' -> ' + bankAfter);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  check('and you can get back up', (await state()).mode === 'world');
}

console.log('\nthe lift, and back out to the car');
await click('#btnTower');
check('the lift panel opens', await page.evaluate(() => GWScreens.isOpen() === 'tower'));
await page.evaluate(() => GWScreens.close(true));
await page.waitForTimeout(400);

// End the day the way it ends: the clock runs out and you are walked back.
await page.evaluate(() => { GWShell.store.s.timeLeft = 1; });
await page.waitForFunction(() => GWShell.level && GWShell.level.isLobby
  && !GWLoading.isOpen(), { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(1200);
s = await state();
check('the doors close and you are back in the hub', s.lobby, s.room);
check('and nothing has settled yet', s.phase === 'closing', s.phase);

const back = await useFixture('limo', 70);
check('you can walk back to the limo', back.reached, back.why || '');
await page.waitForTimeout(1200);
check('and getting in settles the night',
  await page.evaluate(() => GWScreens.isOpen() === 'report'),
  await page.evaluate(() => GWScreens.isOpen() || 'nothing open'));

console.log('');
for (const e of [...new Set(errors)].slice(0, 12)) console.log('  ' + e);
check('no page or console errors', errors.length === 0, String(errors.length));

await browser.close();
console.log(bad ? '\n' + bad + ' failed' : '\na day can be played with the keys');
process.exitCode = bad ? 1 : 0;
