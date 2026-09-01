/* Is the table actually on screen, and is it lit?

   Two failures look identical from the outside and neither raises an error:
   a camera pointed somewhere the machine is not, and a machine in frame with
   no light on it. Both render a black rectangle, both pass every other test,
   and the game had one of each -- the roulette wheel was in frustum and unlit
   because the table lamp was still hanging over the world origin from back
   when every game was mounted there.

   So: walk to each machine through the interface, wait for the camera to
   arrive, then measure. Coverage is how much of the frame the machine's own
   bounding box projects onto; brightness is the mean luminance of the pixels
   that were actually drawn. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('file:///home/user/Claude-code/gwyf-web/gamble-with-your-friends.html');
await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 90000 });
await page.click('.titlebtn--primary'); await page.waitForTimeout(400);
const go = await page.$('[data-go]'); if (go) await go.click();
await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 90000 });
await page.evaluate(() => {
  GWShell.store.s.mods.allFloors = true;
  GWShell.store.s.mods.freezeClock = true;
  GWShell.store.s.bank = 500000;
  GWShell.stage.setQuality(0.5);
});
const games = await page.evaluate(() => GWGames.all().map((g) => g.id));

let bad = 0;
console.log('game          on screen   lit');
for (const id of games) {
  await page.evaluate((gid) => {
    const floor = GWConfig.FLOORS.findIndex((f) => f.games.includes(gid));
    GWShell.enterFloor(floor);
  }, id);
  await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world',
    { timeout: 60000 }).catch(() => {});
  const walked = await page.evaluate((gid) => {
    const st = GWShell.player.state;
    const a = (GWShell.level.anchors || []).find((x) => x.gameId === gid);
    if (!a) return false;
    st.pos.set(a.stand.x, st.pos.y, a.stand.z);
    st.yaw = Math.atan2(-(a.position.x - st.pos.x), -(a.position.z - st.pos.z));
    st.viewYaw = st.yaw; st.pitch = 0; st.viewPitch = 0;
    return true;
  }, id);
  if (!walked) { console.log(id.padEnd(14) + 'FAIL  not placed on its own floor'); bad++; continue; }
  await page.waitForFunction((gid) => {
    const n = GWShell.player.nearest;
    return !!(n && n.anchor && n.anchor.gameId === gid);
  }, id, { timeout: 25000 }).catch(() => {});
  await page.keyboard.press('e');
  const opened = await page.waitForFunction((gid) => GWShell.mode === 'table'
    && GWShell.game && GWShell.game.id === gid, id, { timeout: 25000 })
    .then(() => true).catch(() => false);
  if (!opened) { console.log(id.padEnd(14) + 'FAIL  use did not open it'); bad++; continue; }
  await page.waitForFunction(() => {
    const rec = GWShell.anchor;
    if (!rec) return false;
    const want = rec.view.pos.clone().applyMatrix4(rec.holder.matrixWorld);
    return GWShell.stage.camera.position.distanceTo(want) < 0.05;
  }, null, { timeout: 45000 }).catch(() => {});

  const m = await page.evaluate(() => {
    const s = GWShell.stage, cam = s.camera, rec = GWShell.anchor;
    cam.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(rec.holder);
    // Project the eight corners; the screen area they span is how much of the
    // frame the machine takes up.
    let minx = 9, maxx = -9, miny = 9, maxy = -9, anyFront = false;
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z).project(cam);
      if (v.z < 1) anyFront = true;
      minx = Math.min(minx, v.x); maxx = Math.max(maxx, v.x);
      miny = Math.min(miny, v.y); maxy = Math.max(maxy, v.y);
    }
    const cw = Math.max(0, Math.min(1, maxx) - Math.max(-1, minx));
    const ch = Math.max(0, Math.min(1, maxy) - Math.max(-1, miny));
    const coverage = anyFront ? (cw * ch) / 4 : 0;

    // Draw one frame and read it back before the buffer is swapped away.
    const r = s.renderer, gl = r.getContext();
    r.render(s.scene, cam);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const step = Math.max(1, Math.floor(w / 120));
    const rw = Math.floor(w / step), rh = Math.floor(h / step);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, n = 0;
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = ((y * step) * w + x * step) * 4;
        sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        n++;
      }
    }
    return { coverage, lum: sum / n / 255 };
  });
  // A table that fills less than a fiftieth of the frame is not being shown,
  // and one drawn at less than four percent grey is not being lit.
  const framed = m.coverage > 0.02;
  const lit = m.lum > 0.04;
  if (!framed || !lit) bad++;
  console.log(id.padEnd(14)
    + ((m.coverage * 100).toFixed(1) + '%').padEnd(8) + (framed ? 'ok  ' : 'FAIL')
    + '    ' + (m.lum * 100).toFixed(1) + '%  ' + (lit ? 'ok' : 'FAIL'));
}
for (const e of errors) console.log('  ' + e);
await browser.close();
console.log(bad ? '\n' + bad + ' table(s) you cannot see' : '\nevery table is on screen and lit');
process.exit(bad || errors.length ? 1 : 0);
