/* What the floors actually look like, from where a player stands.

   Usage: node gwyf-web/tools/look.mjs [outDir] [seed]

   postcards.mjs photographs one machine at a time from its own standing spot,
   which is the right frame for "is this table playable" and the wrong one for
   "is this a room". A room is judged wide: from the lift looking in, from the
   middle turning around, and from a corner. Those are the three shots that
   show ceilings, walls, the gaps between things and whether the floor between
   the tables is furnished or empty.

   It also prints the draw calls and triangles per shot, because the honest
   version of "make it look better" is a number next to every picture. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '..', 'gamble-with-your-friends.html');
if (!existsSync(FILE)) { console.error('build it first'); process.exit(1); }
const OUT = process.argv[2] || '/tmp/gwshots/look';
const SEED = Number(process.argv[3] || 0);
mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
await page.evaluate((n) => {
  GWShell.store.s.mods.allFloors = true;
  GWShell.store.s.seed = (n * 2654435761 + 12345) >>> 0;
}, SEED);

/* Standing somewhere and looking at something. This is a camera, not a player:
   nothing here is claiming a person could walk to these spots -- paths.mjs is
   what says that. It is only choosing the three frames worth looking at. */
async function shot(name, from, at) {
  const stats = await page.evaluate(([f, a]) => {
    const st = GWShell.player.state;
    st.pos.x = f[0]; st.pos.z = f[2]; st.y = f[1] - 1.62;
    st.yaw = Math.atan2(-(a[0] - f[0]), -(a[2] - f[2]));
    st.viewYaw = st.yaw;
    st.pitch = Math.atan2(a[1] - f[1], Math.hypot(a[0] - f[0], a[2] - f[2]));
    st.viewPitch = st.pitch;
    const r = GWShell.stage.renderer.info.render;
    return { calls: r.calls, tris: r.triangles };
  }, [from, at]);
  await page.waitForTimeout(700);
  const live = await page.evaluate(() => {
    const r = GWShell.stage.renderer.info.render;
    return { calls: r.calls, tris: r.triangles };
  });
  await page.screenshot({ path: resolve(OUT, name + '.png') });
  console.log('  ' + name.padEnd(16) + String(live.calls).padStart(5) + ' calls  '
    + (live.tris / 1000).toFixed(0).padStart(6) + 'k tris');
  return live;
}

console.log('');
for (let f = 0; f < 4; f++) {
  await page.evaluate((n) => GWShell.enterFloor(n), f);
  await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world', { timeout: 90000 })
    .catch(() => {});
  await page.waitForTimeout(2400);
  const box = await page.evaluate(() => {
    const s = GWShell.level.size;
    return { w: s.w, d: s.d, h: s.height, name: GWShell.level.name || '' };
  });
  console.log(box.name || ('floor ' + f));
  const hw = box.w / 2, hd = box.d / 2;
  // From the lift, looking the length of the room: the arrival shot.
  await shot(`f${f}-arrive`, [0, 1.62, -hd + 3], [0, 1.5, hd]);
  // From the middle, looking up and across: the ceiling and the far wall.
  await shot(`f${f}-middle`, [0, 1.62, 0], [hw, 3.4, hd * 0.4]);
  // From a corner, the long diagonal: how full the floor reads.
  await shot(`f${f}-corner`, [-hw + 2.5, 1.62, -hd + 2.5], [hw, 1.2, hd]);
}

await page.evaluate(() => GWShell.enterLobby());
await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world', { timeout: 90000 })
  .catch(() => {});
await page.waitForTimeout(2400);
console.log('lobby');
await shot('lobby-in', [0, 1.62, 12], [0, 1.5, -12]);
await shot('lobby-back', [0, 1.62, -12], [0, 1.5, 12]);

console.log('');
for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e);
console.log(errors.length ? errors.length + ' errors' : 'no errors');
await browser.close();
console.log('shots in ' + OUT);
