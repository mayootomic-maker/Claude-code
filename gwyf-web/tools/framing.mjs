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
let pass = 0;

/* Measured in the page, on a frame drawn on purpose.

   Coverage is the screen area the machine's own bounding box projects onto;
   brightness is the mean luminance of the pixels actually drawn, read back
   straight after a render so the buffer has not been swapped away. Two
   different faults produce the same black rectangle -- a camera pointed
   somewhere the machine is not, and a machine in frame with no light on it --
   and neither raises an error, so both have to be measured rather than
   watched for. */
const measureShot = () => {
  const s = GWShell.stage, cam = s.camera, rec = GWShell.anchor;
  cam.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(rec.holder);
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
  /* And whether anything is standing in the way.

     Coverage and brightness both pass happily when a pillar or the next table
     in the bank is between the camera and the machine: the box still projects
     onto most of the frame and the room behind it is still lit. With floors
     laid out in banks of three that is now the likeliest way to press use and
     see nothing, and it is invisible to every other measure here. Rays are
     cast at the machine's centre and at four points around it, so clipping one
     corner on a pillar does not count as blocked. */
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const targets = [centre,
    centre.clone().add(new THREE.Vector3(size.x * 0.3, 0, size.z * 0.3)),
    centre.clone().add(new THREE.Vector3(-size.x * 0.3, 0, -size.z * 0.3)),
    centre.clone().add(new THREE.Vector3(size.x * 0.3, 0, -size.z * 0.3)),
    centre.clone().add(new THREE.Vector3(-size.x * 0.3, 0, size.z * 0.3))];
  const ray = new THREE.Raycaster();
  const dir = new THREE.Vector3();
  let clear = 0;
  const mine = new Set();
  rec.holder.traverse((o) => { if (o.isMesh) mine.add(o); });
  /* Solid meshes only, gathered by hand. Raycasting the group wholesale walks
     into the crew's name tags, which are sprites with no geometry of their own
     and throw rather than miss -- and a floating name would not block the view
     of anything anyway. */
  const blockers = [];
  s.group.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry || mine.has(o)) return;
    // The crew wander, so counting them made the same seed report different
    // tables blocked from one run to the next. This is about the building.
    if (o.userData.person) return;
    blockers.push(o);
  });
  for (const t of targets) {
    dir.copy(t).sub(cam.position);
    const dist = dir.length();
    ray.set(cam.position, dir.normalize());
    ray.far = dist - 0.05;
    if (!ray.intersectObjects(blockers, false).length) clear++;
  }
  return { coverage, lum: sum / n / 255, clear, of: targets.length };
};

/* Every machine on the floor, not one per game.

   A floor puts out banks of three now, and the copy that fails is not the
   copy a per-game walk happens to pick: what breaks a shot is where a machine
   ended up -- against a wall, behind a pillar, nose to nose with the next
   table -- so the same game is fine in one bay and blank in another. Checking
   one of each is how "sometimes you click on a machine and see nothing"
   survived two rounds of fixes. */
async function everyMachineOnThisFloor(label) {
  const n = await page.evaluate(() =>
    (GWShell.level.anchors || []).filter((a) => a.kind === 'machine').length);
  for (let i = 0; i < n; i++) {
    const walked = await page.evaluate((idx) => {
      const st = GWShell.player.state;
      const a = (GWShell.level.anchors || []).filter((x) => x.kind === 'machine')[idx];
      if (!a) return null;
      st.pos.set(a.stand.x, st.pos.y, a.stand.z);
      st.yaw = Math.atan2(-(a.position.x - st.pos.x), -(a.position.z - st.pos.z));
      st.viewYaw = st.yaw; st.pitch = 0; st.viewPitch = 0;
      return a.gameId;
    }, i);
    if (!walked) continue;
    const ok = await page.waitForFunction((idx) => {
      const a = (GWShell.level.anchors || []).filter((x) => x.kind === 'machine')[idx];
      const nr = GWShell.player.nearest;
      return !!(nr && nr.anchor === a);
    }, i, { timeout: 25000 }).then(() => true).catch(() => false);
    if (!ok) {
      const why = await page.evaluate((idx) => {
        const a = (GWShell.level.anchors || []).filter((x) => x.kind === 'machine')[idx];
        const st = GWShell.player.state;
        const nr = GWShell.player.nearest;
        return { mode: GWShell.mode, active: GWShell.player.active,
          pos: [+st.pos.x.toFixed(2), +st.pos.z.toFixed(2)],
          stand: [+a.stand.x.toFixed(2), +a.stand.z.toFixed(2)],
          nearest: nr ? (nr.anchor.gameId || nr.anchor.kind) + '@' + nr.distance.toFixed(1) : null };
      }, i);
      console.log((label + ' #' + i + ' ' + walked).padEnd(30) + 'FAIL  not in reach   ' + JSON.stringify(why));
      bad++; continue;
    }
    await page.keyboard.press('e');
    const opened = await page.waitForFunction(() => GWShell.mode === 'table' && !!GWShell.anchor,
      null, { timeout: 25000 }).then(() => true).catch(() => false);
    if (!opened) { console.log((label + ' #' + i + ' ' + walked).padEnd(30) + 'FAIL  use did not open it'); bad++; continue; }
    /* Put the camera where it is going rather than waiting for it to ease
       there. The ease runs on the frame clock, and in a container rendering at
       two frames a second a four-metre approach takes a dozen real seconds --
       thirty-five machines times five seeds of that is an hour of watching a
       lerp. `snap` is the stage's own call for exactly this and lands on the
       same position the ease was heading for. */
    await page.evaluate(() => GWShell.stage.snap());
    await page.waitForTimeout(120);
    const m = await page.evaluate(measureShot);
    /* Step away first, report second.

       Reporting a pass with a `continue` skipped the leave, so the game stayed
       at the table and every machine after the first failed to come into reach
       -- forty consecutive failures that were all this line. Whatever the
       verdict, the walk to the next machine starts from the floor. */
    await page.evaluate(() => GWShell.leaveMachine());
    await page.waitForFunction(() => GWShell.mode === 'world', null, { timeout: 25000 })
      .catch(() => {});

    const framed = m.coverage > 0.02;
    const lit = m.lum > 0.04;
    // Most of the machine has to be actually visible, not merely in front.
    const seen = m.clear >= 3;
    if (framed && lit && seen) { pass++; continue; }
    bad++;
    console.log((label + ' #' + i + ' ' + walked).padEnd(30)
      + ((m.coverage * 100).toFixed(1) + '%').padEnd(8) + (framed ? 'ok  ' : 'FAIL')
      + '   ' + (m.lum * 100).toFixed(1).padStart(5) + '%  ' + (lit ? 'ok  ' : 'FAIL')
      + '   ' + m.clear + '/' + m.of + ' ' + (seen ? 'ok' : 'BLOCKED'));
  }
}

if (process.argv.includes('--all')) {
  /* Across several run seeds, because the layout is drawn from them.

     A floor is generated from the run seed and the floor number, so one run
     exercises one arrangement of one bank of machines. "Sometimes you click on
     a machine and see nothing" is a statement about the seeds you have not
     tried, and checking a single layout is how it survived two rounds of
     fixes. */
  const SEEDS = Number(process.argv[process.argv.indexOf('--all') + 1]) || 4;
  console.log('machine                       on screen     lit      unblocked');
  for (let seed = 0; seed < SEEDS; seed++) {
   await page.evaluate((n) => { GWShell.store.s.seed = (n * 2654435761 + 12345) >>> 0; }, seed);
   for (let f = 0; f < 4; f++) {
    await page.evaluate((n) => GWShell.enterFloor(n), f);
    await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world',
      { timeout: 90000 }).catch(() => {});
    await everyMachineOnThisFloor('s' + seed + ' f' + f);
   }
  }
  for (const e of errors) console.log('  ' + e);
  await browser.close();
  console.log(bad
    ? '\n' + bad + ' machine(s) you cannot see, out of ' + (bad + pass)
    : '\nall ' + pass + ' machines across every floor and seed are on screen, lit and unblocked');
  process.exit(bad || errors.length ? 1 : 0);
}

console.log('game          on screen   lit');
for (const id of games) {
  /* A floor deals a hand from a pool now, so asking for the floor a game
     lives on is not enough -- the seed has to be one that actually puts it
     out. Walk seeds until it does. */
  await page.evaluate((gid) => {
    const floor = GWConfig.FLOORS.findIndex((f) => (f.pool || f.games || []).includes(gid));
    for (let seed = 1; seed < 400; seed++) {
      if (GWConfig.gamesOn(floor, seed).includes(gid)) {
        GWShell.store.s.seed = seed;
        break;
      }
    }
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
    if (!GWShell.anchor) return false;
    return GWShell.stage.camera.position.distanceTo(GWShell.stage.desired.pos) < 0.05;
  }, null, { timeout: 45000 }).catch(() => {});

  const m = await page.evaluate(measureShot);
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
