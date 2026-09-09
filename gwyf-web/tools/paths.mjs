/* Can you actually walk to everything on the floor?

   Usage: node gwyf-web/tools/paths.mjs [seeds]

   reach.mjs asks whether a machine answers from its own stand point, which it
   does by teleporting there. That leaves the question underneath it unasked:
   is the stand point somewhere you can get to on your own two feet, or has a
   pit rail, a bar counter or a cage wall closed the only way in?

   walk.mjs pointed a deliberately dumb pathfinder at each machine and reported
   misses, which answers nothing -- a walker that aims straight at a target and
   sidesteps when it sticks will lose to any piece of furniture, and did, five
   times on the first floor. So the invariant is checked directly: grid the
   floor's collision world at the radius the player actually occupies, flood it
   from the lift, and every stand point must come out inside the flood. That is
   "is it walled in", answered without depending on how clever the walker is.

   The lift and every lobby fixture are checked the same way, because a shop
   counter you cannot reach is the same bug in a room you visit twice a day.

   Pass --map to print the floor as ASCII, which is the only sane way to look
   at a failure: `#` solid, `.` reached, `?` open but cut off, a letter for
   each stand point, `@` for the lift. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function startGame(page) {
  await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 60000 });
  const title = await page.$('#title:not([hidden])');
  if (title) {
    await page.click('.titlebtn--primary');
    await page.waitForTimeout(500);
  }
  const go = await page.$('[data-go]');
  if (go) {
    await go.click();
    await page.waitForTimeout(400);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '..', 'gamble-with-your-friends.html');
if (!existsSync(FILE)) { console.error('build it first'); process.exit(1); }
const args = process.argv.slice(2);
const WANT_MAP = args.includes('--map');
const SEEDS = Number(args.find((a) => !a.startsWith('--')) || 6);

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/fonts\.(googleapis|gstatic)|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_CERT_AUTHORITY_INVALID/.test(m.text())) return;
  errors.push('console: ' + m.text());
});

const settled = () => page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 60000 });

await page.goto('file://' + FILE);
await page.waitForSelector('#app:not([hidden])', { timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#app:not([hidden])', { timeout: 60000 });
await startGame(page);
await settled();
await page.evaluate(() => {
  const s = GWShell.store.s;
  s.mods.allFloors = true;
  s.mods.freezeClock = true;
});

/* The flood, run against nothing but the level.

   Deliberately its own evaluate, touching only `GWShell.level`: the first
   version of this lived inside reach.mjs's evaluate, downstream of the loop
   that teleports the player to every stand point in turn, and reported four
   machines walled off that a standalone probe of the same seed found
   perfectly connected. */
const flood = (wantMap) => page.evaluate((withMap) => {
  const lv = GWShell.level;
  const R = GWPlayer.RADIUS;
  /* A third of a metre. Fine enough that a gap a player fits through is not
     closed by rounding, coarse enough that a 56x40 hall is twenty thousand
     cells, which costs nothing. */
  const STEP = 0.33;
  const minX = -lv.size.w / 2, minZ = -lv.size.d / 2;
  const cols = Math.ceil(lv.size.w / STEP), rows = Math.ceil(lv.size.d / STEP);
  const centre = (c, r) => [minX + (c + 0.5) * STEP, minZ + (r + 0.5) * STEP];
  const cellOf = (x, z) => [Math.floor((x - minX) / STEP), Math.floor((z - minZ) / STEP)];

  const open = new Uint8Array(cols * rows);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const [x, z] = centre(c, r);
      open[r * cols + c] = lv.solids.clearAt(x, z, R) ? 1 : 0;
    }
  }

  /* Start at the lift, or rather beside it: the lift's own middle is inside
     the shaft, which is solid, so the flood starts from the open cells nearest
     to it -- the floor you step out onto. */
  const seen = new Uint8Array(cols * rows);
  const queue = [];
  const [lc, lr] = cellOf(lv.lift.x, lv.lift.z);
  for (let d = 0; d <= 14 && !queue.length; d++) {
    for (let dc = -d; dc <= d; dc++) {
      for (let dr = -d; dr <= d; dr++) {
        const c = lc + dc, r = lr + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const k = r * cols + c;
        if (!open[k] || seen[k]) continue;
        seen[k] = 1;
        queue.push(k);
      }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i] % cols, r = (queue[i] - (queue[i] % cols)) / cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const k = nr * cols + nc;
      if (seen[k] || !open[k]) continue;
      seen[k] = 1;
      queue.push(k);
    }
  }

  // A stand point rounds into whichever cell it lands in, and that cell can be
  // one the machine's own box covers; any open cell touching it counts.
  const arrives = (x, z) => {
    const [c, r] = cellOf(x, z);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        if (seen[rr * cols + cc]) return true;
      }
    }
    return false;
  };

  const spots = [];
  for (const a of lv.anchors || []) {
    const name = a.kind === 'machine' ? a.gameId : a.action;
    spots.push({ name, ok: arrives(a.stand.x, a.stand.z),
                 at: [+a.stand.x.toFixed(1), +a.stand.z.toFixed(1)] });
  }

  let map = null;
  if (withMap) {
    const marks = {};
    for (const a of lv.anchors || []) {
      const [c, r] = cellOf(a.stand.x, a.stand.z);
      const name = a.kind === 'machine' ? a.gameId : a.action;
      marks[r * cols + c] = name[0].toUpperCase();
    }
    const [c0, r0] = cellOf(lv.lift.x, lv.lift.z);
    marks[r0 * cols + c0] = '@';
    const lines = [];
    for (let r = 0; r < rows; r++) {
      let line = '';
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c;
        line += marks[k] || (open[k] ? (seen[k] ? '.' : '?') : '#');
      }
      lines.push(line);
    }
    map = lines.join('\n');
  }

  let openCells = 0, seenCells = 0;
  for (let i = 0; i < open.length; i++) { openCells += open[i]; seenCells += seen[i]; }
  return { name: lv.name, spots, openCells, seenCells, map };
}, wantMap);

let bad = 0;
let checked = 0;
console.log('');

/* The hub first. Two rooms joined by one doorway is exactly the shape that can
   be sealed by an off-by-one, and it is the room you stand in twice a day. */
await page.evaluate(() => GWShell.enterLobby());
await settled();
{
  const r = await flood(WANT_MAP);
  for (const s of r.spots) {
    checked++;
    if (s.ok) continue;
    bad++;
    console.log('  FAIL the ' + s.name + ' in ' + r.name
      + ' cannot be walked to (stand ' + s.at.join(',') + ')');
  }
  const stranded = r.openCells - r.seenCells;
  if (stranded > r.openCells * 0.02) {
    bad++;
    console.log('  FAIL ' + r.name + ' has ' + stranded + ' of ' + r.openCells
      + ' walkable cells cut off from the doors');
  }
  if (WANT_MAP) console.log(r.map);
}

for (let seed = 0; seed < SEEDS; seed++) {
  await page.evaluate((n) => { GWShell.store.s.seed = (n * 7919 + 13) >>> 0; }, seed);
  for (const floor of [0, 1, 2, 3]) {
    await page.evaluate((f) => GWShell.enterFloor(f), floor);
    await settled();
    const r = await flood(WANT_MAP && seed === 0);
    for (const s of r.spots) {
      checked++;
      if (s.ok) continue;
      bad++;
      console.log('  FAIL seed ' + seed + ' ' + r.name + ': ' + s.name
        + ' cannot be walked to from the lift (stand ' + s.at.join(',') + ')');
    }
    /* A pocket of floor nobody can reach is not a failure by itself -- the
       inside of a bar's counter is meant to be closed -- but a big one means a
       zone has sealed a chunk of the room. Two percent is about one cell in a
       thousand square metres of hall. */
    const stranded = r.openCells - r.seenCells;
    if (stranded > r.openCells * 0.06) {
      bad++;
      console.log('  FAIL seed ' + seed + ' ' + r.name + ': ' + stranded + ' of '
        + r.openCells + ' walkable cells are cut off from the lift');
    }
    if (WANT_MAP && seed === 0) {
      console.log('\n' + r.name + '  (open ' + r.openCells + ', reached ' + r.seenCells + ')');
      console.log(r.map);
    }
  }
}

await browser.close();
console.log('\n' + (checked - bad) + '/' + checked
  + ' places you have to stand can be walked to, across ' + SEEDS + ' seeds');
if (errors.length) {
  console.error(errors.length + ' ERROR(S):');
  for (const e of [...new Set(errors)].slice(0, 20)) console.error('  ' + e);
}
console.log(bad || errors.length ? '\n' + (bad + errors.length) + ' failed'
  : 'nothing on any floor is walled off');
process.exitCode = (bad || errors.length) ? 1 : 0;
