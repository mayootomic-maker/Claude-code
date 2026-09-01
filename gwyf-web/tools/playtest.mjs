/* Play it like a person and time everything.

   "The gameplay is bad" is not something you can fix by reading the code, so
   this measures the things a player actually feels: how long you wait before
   you can do anything, how many actions a bet costs, how long the game spends
   showing you an animation you did not ask for, and what the frame rate is
   while you walk. Everything here is done with key and mouse events. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '..', 'gamble-with-your-friends.html');
const SHOTS = process.env.GW_SHOTS || '/tmp/playtest';
mkdirSync(SHOTS, { recursive: true });
if (!existsSync(FILE)) { console.error('build it first'); process.exit(1); }

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/fonts\.(googleapis|gstatic)|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_CERT_AUTHORITY_INVALID/.test(m.text())) return;
  errors.push('console: ' + m.text());
});
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const ms = (n) => Math.round(n) + ' ms';

const t0 = Date.now();
await page.goto('file://' + FILE);
await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 90000 });
console.log('to the title screen:            ' + ms(Date.now() - t0));
await shot('01-title');

let t = Date.now();
await page.click('.titlebtn--primary');
await page.waitForTimeout(400);
const go = await page.$('[data-go]');
let briefing = 0;
if (go) {
  await shot('02-briefing');
  briefing = await page.evaluate(() => (document.querySelector('.sheet') || {}).innerText || '');
  await go.click();
}
await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 90000 });
console.log('title -> standing in the world: ' + ms(Date.now() - t));
console.log('words read before you play:     ' + String(briefing).split(/\s+/).filter(Boolean).length);
await page.waitForTimeout(800);
await shot('03-lobby');

/* Frame times while walking. A single average hides a stutter, so the 95th
   percentile is reported too -- that is the frame you actually notice. */
async function walkAndMeasure(label, keys, seconds) {
  await page.evaluate(() => {
    window.__f = [];
    let last = performance.now();
    // Real elapsed time, not the tick's dt: dt is clamped at 100 ms so a
    // machine running at two frames a second reports as ten and the number
    // that matters is the one that is being hidden.
    window.__stop = GWShell.stage.onTick(() => {
      const now = performance.now();
      window.__f.push(now - last);
      last = now;
    });
  });
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(seconds * 1000);
  for (const k of keys) await page.keyboard.up(k);
  const f = await page.evaluate(() => { window.__stop(); const a = window.__f.slice(5); window.__f = []; return a; });
  if (f.length < 2) { console.log(label.padEnd(32) + 'fewer than two frames in ' + seconds + 's'); return null; }
  f.sort((a, b) => a - b);
  const mean = f.reduce((s, x) => s + x, 0) / f.length;
  const p95 = f[Math.floor(f.length * 0.95)];
  const worst = f[f.length - 1];
  console.log(label.padEnd(32) + Math.round(1000 / mean) + ' fps mean · p95 '
    + p95.toFixed(1) + ' ms · worst ' + worst.toFixed(1) + ' ms · ' + f.length + ' frames');
  return { mean, p95, worst };
}

console.log('');
await page.mouse.click(640, 400);          // pointer lock
await page.waitForTimeout(300);
await walkAndMeasure('standing still, lobby', [], 4);
await walkAndMeasure('walking forward, lobby', ['w'], 5);

const stats = await page.evaluate(() => {
  const r = GWShell.stage.renderer;
  return {
    calls: r.info.render.calls, tris: r.info.render.triangles,
    programs: r.info.programs.length, geometries: r.info.memory.geometries,
    textures: r.info.memory.textures,
    lights: GWShell.stage.scene.children.filter((c) => c.isLight).length,
  };
});
console.log('draw calls ' + stats.calls + ' · triangles ' + stats.tris.toLocaleString()
  + ' · shader programs ' + stats.programs + ' · lights ' + stats.lights);

/* How long does it take to find something to do? */
console.log('');
const where = await page.evaluate(() => {
  const p = GWShell.player.state.pos;
  const anchors = (GWShell.level && GWShell.level.anchors) || [];
  return {
    at: [p.x.toFixed(1), p.z.toFixed(1)],
    n: anchors.length,
    nearest: anchors.map((a) => ({
      id: a.gameId || a.kind,
      d: Math.hypot(a.position.x - p.x, a.position.z - p.z),
    })).sort((a, b) => a.d - b.d).slice(0, 4),
    prompt: (document.querySelector('#prompt') || {}).textContent || '',
    hud: (document.querySelector('#hud') || {}).innerText || '',
  };
});
console.log('you start at ' + where.at.join(', ') + ' with ' + where.n + ' things in the room');
for (const a of where.nearest) console.log('   ' + a.id.padEnd(16) + a.d.toFixed(1) + ' m away');
console.log('the screen says: ' + JSON.stringify(where.hud.replace(/\s+/g, ' ').slice(0, 200)));

await shot('04-standing');

/* Is it the pixels or the work? Halving the window quarters the fragment work
   and changes nothing else. If the frame time follows the pixels the cost is
   fill; if it does not, it is javascript. Worth knowing before optimising the
   wrong half. */
console.log('');
await page.setViewportSize({ width: 640, height: 400 });
await page.waitForTimeout(700);
await walkAndMeasure('walking, quarter the pixels', ['w'], 4);
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(700);

/* One bet, from standing in the room to the money having moved. Counted in
   actions and in seconds spent watching rather than deciding. */
console.log('');
/* Into the tower. The lobby has no machines in it at all, so a bet cannot be
   measured from where the game starts you -- which is itself worth knowing. */
const toFloor = Date.now();
await page.evaluate(() => GWShell.enterFloor(1));
await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.level && !GWShell.level.isLobby,
  { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1200);
console.log('lobby -> a floor with tables:   ' + ms(Date.now() - toFloor));
await shot('05-floor');
const anchor = await page.evaluate(() => {
  const p = GWShell.player.state.pos;
  const a = (GWShell.level.anchors || []).filter((x) => x.kind === 'machine')
    .sort((x, y) => x.position.distanceTo(p) - y.position.distanceTo(p))[0];
  if (!a) return null;
  const st = GWShell.player.state;
  st.pos.set(a.stand.x, st.pos.y, a.stand.z);
  // Face it. The interaction test is a cone, so standing in the right place
  // with your back to the machine is correctly nothing.
  st.yaw = Math.atan2(-(a.position.x - st.pos.x), -(a.position.z - st.pos.z));
  st.viewYaw = st.yaw; st.pitch = 0; st.viewPitch = 0;
  return { game: a.gameId };
});
if (anchor) {
  await page.waitForTimeout(500);
  let t2 = Date.now();
  await page.keyboard.press('e');
  await page.waitForFunction(() => !!GWShell.game, { timeout: 20000 }).catch(() => {});
  console.log('press E -> the table is up:      ' + ms(Date.now() - t2) + '   (' + anchor.game + ')');
  /* Long enough for the camera to finish travelling. It eases on the clamped
     delta, so in this container -- two frames a second -- the walk up to a
     table takes a dozen real seconds and a screenshot taken at one second is
     of the journey, not the table. */
  await page.waitForTimeout(9000);
  await shot('06-table');
  const ui = await page.evaluate(() => ({
    bets: Array.from(document.querySelectorAll('#betList button')).map((b) => b.innerText.replace(/\s+/g, ' ').trim()),
    controls: Array.from(document.querySelectorAll('#rail button')).map((b) => b.innerText.replace(/\s+/g, ' ').trim()),
    text: (document.querySelector('#rail') || {}).innerText || '',
  }));
  console.log('bets offered: ' + JSON.stringify(ui.bets));
  console.log('every button: ' + JSON.stringify(ui.controls));

  /* Time the hand with the drawing switched off.

     This container has no GPU: the software rasteriser takes hundreds of
     milliseconds a frame, and since animations advance on a delta that is
     clamped at 100 ms they play back several times slower than they would
     anywhere else. Timing a hand here without this measures the container.
     With rendering removed the same code runs at the frame rate the animation
     was written for, so the seconds below are the ones a player waits. */
  await page.evaluate(() => {
    const r = GWShell.stage.renderer;
    window.__origRender = r.render.bind(r);
    r.render = () => {};
  });
  await page.waitForTimeout(300);
  const bank0 = await page.evaluate(() => GWShell.store.s.bank);
  t2 = Date.now();
  const betBtn = await page.$('#btnPlay');
  const visible = betBtn && await betBtn.isVisible();
  if (!visible) console.log('the rail never appeared: mode is '
    + await page.evaluate(() => GWShell.mode));
  if (visible) {
    await betBtn.click();
    await page.waitForFunction((b) => GWShell.store.s.bank !== b, bank0, { timeout: 30000 })
      .catch(() => {});
    console.log('click a bet -> money moves:     ' + ms(Date.now() - t2));
    await page.waitForFunction(() => !GWShell.busy, { timeout: 30000 }).catch(() => {});
    console.log('click a bet -> able to act again: ' + ms(Date.now() - t2));
  } else {
    console.log('there is no bet button on the table screen');
  }
  await page.evaluate(() => { GWShell.stage.renderer.render = window.__origRender; });
  await page.waitForTimeout(600);
  await shot('07-result');
}
console.log('');
for (const e of errors) console.log('  ' + e);
await browser.close();
