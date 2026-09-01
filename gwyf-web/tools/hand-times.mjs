/* How long does a hand take?

   The number that decides what the game feels like. A day is five minutes; if
   one spin costs ten seconds then the whole day is thirty spins and most of it
   is spent watching. Timed with drawing switched off, because this container's
   software renderer runs at two frames a second and animations advance on a
   clamped delta, so they play back several times slow here and the measurement
   would be of the container rather than the game. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('file:///home/user/Claude-code/gwyf-web/gamble-with-your-friends.html');
await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 90000 });
await page.click('.titlebtn--primary'); await page.waitForTimeout(400);
const go = await page.$('[data-go]'); if (go) await go.click();
await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 90000 });
await page.evaluate(() => {
  const r = GWShell.stage.renderer;
  r.render = () => {};
  GWShell.store.s.bank = 1e7;             // never blocked for money
  GWShell.store.s.mods.freeplay = true;
});
await page.evaluate(() => { GWShell.store.s.mods.allFloors = true; GWShell.store.s.mods.freezeClock = true; });
const ids = await page.evaluate(() => GWGames.all().map(g => g.id));
console.log('game          stake lands   hand ends   your turn again');
const rows = [];
for (const id of ids) {
  await page.evaluate((id) => {
    const floor = GWConfig.FLOORS.findIndex((f) => f.games.includes(id));
    GWShell.enterFloor(floor);
  }, id);
  await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world',
    { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(300);
  /* Walk up to it and use it, rather than calling in through the side door.
     `enterFloor` takes a floor and nothing else -- an older harness passed a
     game id as a second argument that has never existed, so it spent months
     reporting that it had played twelve games while standing in a corridor. */
  const reached = await page.evaluate((id) => {
    const st = GWShell.player.state;
    const a = (GWShell.level.anchors || []).find((x) => x.gameId === id);
    if (!a) return false;
    st.pos.set(a.stand.x, st.pos.y, a.stand.z);
    st.yaw = Math.atan2(-(a.position.x - st.pos.x), -(a.position.z - st.pos.z));
    st.viewYaw = st.yaw; st.pitch = 0; st.viewPitch = 0;
    return true;
  }, id);
  if (!reached) { console.log(id.padEnd(14) + 'no such machine on its own floor'); continue; }
  await page.waitForTimeout(250);
  await page.keyboard.press('e');
  await page.waitForFunction((id) => GWShell.mode === 'table' && GWShell.game && GWShell.game.id === id,
    id, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
  const r = await page.evaluate(async () => {
    const shell = window.GWShell;
    shell.store.s.bank = 1e6;
    shell.renderHud();
    const bank = shell.store.s.bank;
    const t0 = performance.now();
    let staked = 0;
    document.getElementById('btnPlay').click();
    const deadline = Date.now() + 90000;
    let answered = 0;
    while (shell.busy && Date.now() < deadline && answered < 40) {
      if (!staked && shell.store.s.bank !== bank) staked = performance.now() - t0;
      const cash = document.querySelector('#promptBox .promptbtn--cash');
      const first = document.querySelector('#promptBox .promptbtn');
      const spec = shell.pending && shell.pending.spec;
      if (cash || first) { (cash || first).click(); answered++; }
      else if (spec && spec.meshes && spec.meshes.length) {
        const canvas = document.getElementById('scene');
        const rect = canvas.getBoundingClientRect();
        const mesh = spec.meshes[0];
        const v = mesh.getWorldPosition(new THREE.Vector3()).project(shell.stage.camera);
        canvas.dispatchEvent(new MouseEvent('click', {
          clientX: rect.left + (v.x * 0.5 + 0.5) * rect.width,
          clientY: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
          bubbles: true, cancelable: true }));
        answered++;
      }
      await new Promise((k) => setTimeout(k, 40));
    }
    return { staked, hand: performance.now() - t0, answered,
             mode: shell.mode, game: shell.game && shell.game.id,
             disabled: document.getElementById('btnPlay').disabled };
  }).catch((e) => ({ err: e.message }));
  if (r.err) { console.log(id.padEnd(14) + 'failed: ' + r.err); continue; }
  rows.push({ id, ...r });
  if (!r.answered && r.hand < 100) console.log('   [' + id + '] mode=' + r.mode + ' game=' + r.game + ' playDisabled=' + r.disabled);
  console.log(id.padEnd(14) + (r.staked / 1000).toFixed(2) + 's'
    + '        ' + (r.hand / 1000).toFixed(1) + 's'
    + '       ' + (r.answered ? r.answered + ' decisions' : 'no decisions'));
}
const hands = rows.map(r => r.hand / 1000).sort((a, b) => a - b);
if (hands.length) {
  const mid = hands[Math.floor(hands.length / 2)];
  console.log('\nmedian hand ' + mid.toFixed(1) + 's  ·  a five-minute day is '
    + Math.floor(300 / mid) + ' hands at that rate');
}
await browser.close(); process.exit(0);
