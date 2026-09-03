/* Does the movement have a body under it?

   Feel is not measurable, but the things that produce it are. Each of these
   was wrong before it was measured: the camera steered as freely in mid-air as
   on the ground, stopping took as long as starting, a jump pressed a moment
   early was thrown away, and landing from three metres moved the camera not at
   all. Numbers, so a later change cannot quietly undo them. */
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
const page = await browser.newPage({ viewport: { width: 1000, height: 660 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('file://' + FILE);
await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 90000 });
await page.click('.titlebtn--primary');
await page.waitForTimeout(400);
const go = await page.$('[data-go]');
if (go) await go.click();
await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 90000 });
await page.evaluate(() => GWShell.boardLimo());
await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world'
  && GWShell.level && !GWShell.level.isLobby, { timeout: 90000 });
await page.waitForTimeout(500);

let bad = 0;
const check = (what, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + what + (detail ? '   ' + detail : ''));
  if (!ok) bad++;
};

/* Step the controller directly at a fixed timestep.

   Driving it with real key events in a container that renders at two frames a
   second measures the container. The controller's own update is the thing
   under test, so it is stepped by hand at 60Hz with the inputs set. */
const sim = (script, steps = 120) => page.evaluate(({ script, steps }) => {
  const p = GWShell.player, st = p.state;
  const fn = new Function('st', 'i', script);
  st.vel.set(0, 0, 0); st.y = 0; st.vy = 0; st.grounded = true;
  st.dip = 0; st.dipV = 0; st.jumpAt = 0; st.pos.set(0, 0, 0);
  st.yaw = 0; st.viewYaw = 0;
  const out = [];
  for (let i = 0; i < steps; i++) {
    fn(st, i);
    p.update(1 / 60);
    out.push({ vx: st.vel.x, vz: st.vel.z, y: st.y, dip: st.dip,
               grounded: st.grounded, speed: Math.hypot(st.vel.x, st.vel.z) });
  }
  return out;
}, { script, steps });

const KEYS = (s) => 'GWShell.player.state.keys && 0;' + s;
void KEYS;

console.log('\ngetting going and stopping');
// Hold forward for a second, then let go for a second.
const startStop = await page.evaluate(() => {
  const p = GWShell.player, st = p.state;
  st.vel.set(0, 0, 0); st.pos.set(0, 0, 0); st.y = 0; st.vy = 0; st.grounded = true;
  st.stick.x = 0; st.stick.y = 1;                 // full forward on the stick
  const speeds = [];
  for (let i = 0; i < 60; i++) { p.update(1 / 60); speeds.push(Math.hypot(st.vel.x, st.vel.z)); }
  const top = Math.hypot(st.vel.x, st.vel.z);
  st.stick.y = 0;
  const stop = [];
  for (let i = 0; i < 60; i++) { p.update(1 / 60); stop.push(Math.hypot(st.vel.x, st.vel.z)); }
  const frames = (arr, f) => arr.findIndex((v) => f(v));
  return {
    top,
    toSpeed: frames(speeds, (v) => v > top * 0.9),
    toStop: frames(stop, (v) => v < top * 0.1),
  };
});
check('you reach walking pace quickly', startStop.toSpeed >= 0 && startStop.toSpeed < 24,
  startStop.toSpeed + ' frames');
check('and you stop faster than you start', startStop.toStop >= 0
  && startStop.toStop < startStop.toSpeed,
  'stop ' + startStop.toStop + ' vs start ' + startStop.toSpeed + ' frames');

console.log('\nsteering in mid-air');
const air = await page.evaluate(() => {
  const p = GWShell.player, st = p.state;
  const turn = (grounded) => {
    st.vel.set(0, 0, 0); st.pos.set(0, 0, 0); st.y = 0; st.vy = 0; st.grounded = true;
    st.yaw = 0; st.viewYaw = 0;
    st.stick.x = 0; st.stick.y = 1;
    for (let i = 0; i < 60; i++) p.update(1 / 60);   // up to speed, forwards
    const before = st.vel.z;
    if (!grounded) { st.y = 2; st.vy = 0; st.grounded = false; }
    st.stick.y = 0; st.stick.x = 1;                  // hard right
    for (let i = 0; i < 18; i++) p.update(1 / 60);
    const after = Math.abs(st.vel.x);
    st.stick.x = 0; st.stick.y = 0;
    return { sideways: after, forward: Math.abs(before) };
  };
  const g = turn(true);
  const a = turn(false);
  return { ground: g.sideways, air: a.sideways };
});
check('you can change direction on the ground', air.ground > 1.0, air.ground.toFixed(2) + ' m/s sideways');
check('and barely at all in the air', air.air < air.ground * 0.35,
  air.air.toFixed(2) + ' vs ' + air.ground.toFixed(2) + ' m/s');

console.log('\njumping and landing');
const jump = await page.evaluate(() => {
  const p = GWShell.player, st = p.state;
  st.vel.set(0, 0, 0); st.pos.set(0, 0, 0); st.y = 0; st.vy = 0; st.grounded = true;
  st.dip = 0; st.dipV = 0;
  let apex = 0, airborne = 0, dipAfter = 0;
  st.jumpAt = 0;
  GWShell.player.state.grounded = true;
  // Jump the way the key does.
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
  for (let i = 0; i < 120; i++) {
    p.update(1 / 60);
    apex = Math.max(apex, st.y);
    if (!st.grounded) airborne++;
    if (st.grounded && airborne > 0 && dipAfter === 0) dipAfter = st.dip;
  }
  return { apex, airborne, dipAfter };
});
check('the jump gets you off the floor', jump.apex > 0.4 && jump.apex < 1.0,
  jump.apex.toFixed(2) + ' m');
check('and takes a believable time', jump.airborne > 20 && jump.airborne < 60,
  (jump.airborne / 60).toFixed(2) + ' s');
check('landing moves the camera', jump.dipAfter < -0.01, jump.dipAfter.toFixed(3) + ' m of knee');

const buffered = await page.evaluate(() => {
  const p = GWShell.player, st = p.state;
  st.vel.set(0, 0, 0); st.pos.set(0, 0, 0); st.grounded = false; st.y = 0.35; st.vy = -3;
  st.jumpAt = 0;
  // Pressed while still falling, a couple of frames before touchdown.
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
  let leftGroundAgain = false;
  for (let i = 0; i < 40; i++) {
    p.update(1 / 60);
    if (st.grounded === false && i > 3) leftGroundAgain = true;
  }
  return leftGroundAgain;
});
check('a jump pressed just before landing still fires', buffered === true);

console.log('\nthe walk in the camera');
const bob = await page.evaluate(() => {
  const p = GWShell.player, st = p.state;
  st.vel.set(0, 0, 0); st.pos.set(0, 0, 0); st.y = 0; st.vy = 0; st.grounded = true;
  st.stick.x = 0; st.stick.y = 1; st.headBob = true;
  const ys = [], xs = [];
  for (let i = 0; i < 180; i++) {
    p.update(1 / 60);
    const e = p.eye();
    ys.push(e.y); xs.push(st.sway);
  }
  st.stick.y = 0;
  const range = (a) => Math.max.apply(null, a) - Math.min.apply(null, a);
  return { up: range(ys), side: range(xs) };
});
check('the head rises and falls as you walk', bob.up > 0.02 && bob.up < 0.2,
  bob.up.toFixed(3) + ' m');
check('and sways side to side', bob.side > 0.01, bob.side.toFixed(3) + ' m');

console.log('\nnothing threw');
for (const e of errors) console.log('  ' + e);
check('no page errors', errors.length === 0, String(errors.length));

await browser.close();
console.log(bad ? '\n' + bad + ' failed' : '\nthe movement has a body under it');
process.exit(bad ? 1 : 0);
