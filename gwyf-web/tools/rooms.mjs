/* Are the floors rooms, or one box each?

   The old ones were a rectangle with machines on wall slots and two rows of
   islands, four times over with the lights changed -- correct, walkable, and
   with nowhere on it you could describe to somebody else. A floor is planned
   as a grid of cells now and each is built by a zone. This checks the things
   that make that a floor rather than a scatter of props: you arrive in an
   entrance, there is exactly one bar, machines stand where the rooms said a
   machine goes, and the whole lot still fits the draw-call budget. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '..', 'gamble-with-your-friends.html');
if (!existsSync(FILE)) { console.error('build it first'); process.exit(1); }
const SEEDS = Number(process.argv[2] || 5);

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
await page.evaluate(() => { GWShell.store.s.mods.allFloors = true; });

let bad = 0;
const check = (what, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + what + (detail ? '   ' + detail : ''));
  if (!ok) bad++;
};

const seen = {};
let worstCalls = 0, worstWhere = '';
console.log('');
for (let seed = 0; seed < SEEDS; seed++) {
  await page.evaluate((n) => { GWShell.store.s.seed = (n * 2654435761 + 12345) >>> 0; }, seed);
  for (let f = 0; f < 4; f++) {
    await page.evaluate((n) => GWShell.enterFloor(n), f);
    await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world',
      { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(2200);
    const r = await page.evaluate(() => {
      const lv = GWShell.level;
      const cells = lv.zones || [];
      const counts = {};
      for (const c of cells) counts[c.type] = (counts[c.type] || 0) + 1;
      // Which cell the lift opens into, worked out the same way the plan does.
      // Nearest centre, the same rule the plan uses -- the lift sits on a cell
      // boundary and a containment test picks whichever neighbour it likes.
      let liftCell = null, bestD = Infinity;
      for (const c of cells) {
        const dist = Math.hypot(c.x - lv.lift.x, c.z - lv.lift.z);
        if (dist < bestD) { bestD = dist; liftCell = c; }
      }
      const machines = (lv.anchors || []).filter((a) => a.kind === 'machine');
      // A machine counts as "in a room" if it stands inside some cell that is
      // not the entrance -- i.e. the zones offered the slot it took.
      let inRooms = 0;
      for (const a of machines) {
        const cell = cells.find((c) =>
          Math.abs(a.position.x - c.x) <= c.w / 2 && Math.abs(a.position.z - c.z) <= c.d / 2);
        if (cell && cell.type !== 'entrance') inRooms++;
      }
      return {
        name: lv.name, cells: cells.length, counts,
        liftType: liftCell ? liftCell.type : null,
        machines: machines.length, inRooms,
        calls: GWShell.stage.renderer.info.render.calls,
      };
    });
    for (const t in r.counts) seen[t] = (seen[t] || 0) + r.counts[t];
    if (r.calls > worstCalls) { worstCalls = r.calls; worstWhere = r.name + ' seed ' + seed; }

    const label = 's' + seed + ' f' + f;
    if (r.liftType !== 'entrance') {
      check(label + ' arrives in an entrance', false, 'arrives in a ' + r.liftType);
    }
    if ((r.counts.bar || 0) !== 1) {
      check(label + ' has exactly one bar', false, String(r.counts.bar || 0));
    }
    if ((r.counts.cage || 0) > 1) {
      check(label + ' has at most one cage', false, String(r.counts.cage));
    }
    if (r.machines && r.inRooms / r.machines < 0.7) {
      check(label + ' stands its machines in the rooms', false,
        r.inRooms + ' of ' + r.machines);
    }
  }
}
check('every floor arrives in an entrance, has one bar and at most one cage', bad === 0);
check('the zones that got built are the designed ones',
  Object.keys(seen).length >= 5, Object.keys(seen).sort().join(', '));
/* What the number is made of, so the threshold is not a mystery constant.

   Measured on the busiest floor: the room itself -- six zones, their rails,
   columns, bottles, inlays and signs -- is 61 draw calls, because zones only
   ever use the materials the level hands them and mergeStatic folds them into
   a handful of buckets. The rest is machines, at about thirty-five calls each
   now that each one folds its own cabinet, and the ten nearest are drawn.
   Before the machines folded, eight of them cost 542. If this ever fails it
   will be because a machine got more expensive or the budget went up, and both
   are worth being told about. */
check('draw calls stay inside budget', worstCalls < 480, worstCalls + ' worst, on ' + worstWhere);

console.log('\nnothing threw');
for (const e of errors) console.log('  ' + e);
check('no page or console errors', errors.length === 0, String(errors.length));

await browser.close();
console.log(bad ? '\n' + bad + ' failed' : '\nthe floors are rooms');
process.exit(bad ? 1 : 0);
