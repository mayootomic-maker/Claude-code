/* Can every machine actually be played?

   Usage: node gwyf-web/tools/reach.mjs [seeds]

   walk.mjs answers a harder question -- can a player *get* there -- with a
   deliberately dumb pathfinder, so one miss in twelve tells you very little.
   This answers the invariant underneath it: standing where the level says to
   stand and looking where it says to look, does the machine offer itself? A
   failure here is a floor with a table on it that cannot be used, which is the
   one placement bug worth failing a build over.

   Run across many seeds, because layout is drawn from the run's RNG and the
   pillar that buries an approach only appears on some of them. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Through the front door.

   The game opens on a title screen now, so every harness that used to click
   the briefing's button straight after boot has to press Play first. Kept as
   one function rather than five copies of the same two clicks. */
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
const SEEDS = Number(process.argv[2] || 12);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
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
  s.mods.quietFriends = true;
});

let total = 0;
let missing = 0;
const unplaced = [];
for (let seed = 0; seed < SEEDS; seed++) {
  await page.evaluate((n) => {
    // Re-seed the layout stream. Every floor is drawn from it, so a fresh seed
    // is a fresh building.
    GWShell.store.s.seed = (n * 7919 + 13) >>> 0;
    GWShell.store.rng.seed = GWShell.store.s.seed;
    GWShell.store.rng.calls = 0;
  }, seed);

  for (const floor of [0, 1, 2, 3]) {
    await page.evaluate((f) => GWShell.enterFloor(f), floor);
    await settled();
    const report = await page.evaluate(async () => {
      const wanted = GWConfig.FLOORS[GWShell.store.s.floor].games;
      const built = GWShell.anchors.map((a) => a.def.id);
      const rows = [];
      for (const rec of GWShell.anchors) {
        GWShell.player.state.pos.set(rec.anchor.stand.x, 0, rec.anchor.stand.z);
        GWShell.player.lookAt(rec.anchor.focus || rec.anchor.position);
        // Two frames: one for the controller to take the new position, one for
        // the interaction test that runs off it.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const near = GWShell.player.nearest;
        rows.push({ id: rec.def.id, ok: !!(near && near.anchor.gameId === rec.def.id) });
      }
      return { rows, absent: wanted.filter((id) => !built.includes(id)) };
    });
    for (const row of report.rows) {
      total++;
      if (row.ok) continue;
      missing++;
      console.log(`  seed ${seed} floor ${floor}: ${row.id} does not respond from its own stand point`);
    }
    for (const id of report.absent) {
      unplaced.push(`seed ${seed} floor ${floor}: ${id} was never placed`);
    }
  }
}

await browser.close();
for (const line of unplaced) console.log('  ' + line);
console.log(`${total - missing}/${total} machines usable from their stand point`
  + ` across ${SEEDS} seeds` + (unplaced.length ? `, ${unplaced.length} never placed` : ''));
if (errors.length) {
  console.error(errors.length + ' ERROR(S):');
  for (const e of [...new Set(errors)].slice(0, 20)) console.error('  ' + e);
}
process.exitCode = (missing || unplaced.length || errors.length) ? 1 : 0;
