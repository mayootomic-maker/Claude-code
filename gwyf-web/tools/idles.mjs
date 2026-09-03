/* Does anything on the floor move when nobody is playing?

   A room of machines that stand perfectly still until you press E reads as a
   showroom, and the difference between a machine and a prop is that a machine
   is doing something when you are not looking at it. This walks every game on
   every floor and asks one question of each: with nobody at it, does anything
   about it change over a second and a half?

   It is measured off the transforms and the emissive levels rather than off a
   screenshot, because a screenshot diff answers "did any pixel change", and on
   a floor with three friends walking about the answer to that is always yes.

   Usage: node gwyf-web/tools/idles.mjs */
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
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
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
await page.evaluate(() => { GWScreens.close(true); GWShell.store.s.mods.allFloors = true; });

/* What the machine looks like right now, as one string per game. Positions to
   a tenth of a millimetre and emissive to two places: a machine whose idle is
   smaller than that is one nobody can see move. */
const snap = () => page.evaluate(() => {
  const out = {};
  for (const rec of GWShell.anchors) {
    const parts = [];
    rec.holder.updateMatrixWorld(true);
    rec.holder.traverse((o) => {
      if (o.isLight) { parts.push(o.intensity.toFixed(2)); return; }
      if (!o.isMesh) return;
      const e = o.matrixWorld.elements;
      for (const v of e) parts.push(Math.round(v * 10000));
      parts.push(o.visible ? 1 : 0);
      const m = o.material;
      if (m && m.emissiveIntensity !== undefined) parts.push(m.emissiveIntensity.toFixed(2));
      if (o.geometry && o.geometry.drawRange) parts.push(o.geometry.drawRange.count);
    });
    out[rec.def.id] = parts.join(',');
  }
  return out;
});

let bad = 0;
const still = [];
const moving = [];
console.log('');
/* Several seeds, because a floor deals a hand from a pool: one run of the four
   floors stands twelve of the sixteen games, and a machine nobody checked is a
   machine that can stand still. */
const SEEDS = Number(process.argv[2] || 3);
for (let seed = 0; seed < SEEDS; seed++) {
 await page.evaluate((n) => { GWShell.store.s.seed = (n * 2654435761 + 12345) >>> 0; }, seed);
 for (let f = 0; f < 4; f++) {
  await page.evaluate((n) => GWShell.enterFloor(n), f);
  await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world', { timeout: 90000 });
  // Everything must be drawn, or a machine culled for distance reads as dead.
  await page.evaluate(() => { for (const r of GWShell.anchors) r.holder.visible = true; });
  await page.waitForTimeout(800);
  /* Three samples at uneven gaps, and a machine counts as moving if any two of
     them differ.

     Two samples is not enough and the harness proved it on itself: a placard
     whose glow is sin(t) sampled 1.5 s apart reads identical whenever the pair
     happens to straddle a peak symmetrically, and the tool reported a table
     that was visibly breathing as dead. Three gaps that are not multiples of
     each other cannot all land on that. */
  const shots = [await snap()];
  for (const gap of [700, 1300]) {
    await page.waitForTimeout(gap);
    shots.push(await snap());
  }
  for (const id of Object.keys(shots[0])) {
    if (still.includes(id) || moving.includes(id)) continue;
    const changed = shots.some((s) => s[id] !== shots[0][id]);
    (changed ? moving : still).push(id);
  }
 }
}

moving.sort(); still.sort();
console.log('  moving on their own   ' + moving.join(', '));
if (still.length) console.log('  standing dead still   ' + still.join(', '));
const check = (what, ok, detail) => {
  console.log((ok ? '\n  ok   ' : '\n  FAIL ') + what + (detail ? '   ' + detail : ''));
  if (!ok) bad++;
};
check('every machine on the floor is doing something', still.length === 0,
  still.length + ' of ' + (still.length + moving.length) + ' stand still');
check('no page or console errors', errors.length === 0, String(errors.length));
for (const e of errors) console.log('  ' + e);

await browser.close();
console.log(bad ? '\n' + bad + ' failed' : '\nthe floor is alive');
process.exit(bad ? 1 : 0);
