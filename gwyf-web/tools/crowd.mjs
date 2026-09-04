/* Is there anybody else in the building, and are they doing anything?

   Usage: node gwyf-web/tools/crowd.mjs

   The four named characters used to be AI teammates betting out of your
   account. The game this follows has no AI companions at all -- one to six
   real people, and solo means alone -- so they are gone, and what stands in a
   casino instead is strangers: punters here for their own evening with their
   own money, who happen to be at the machine you wanted.

   Three things have to hold, and the third is the one that matters:

   1. There are people on the floor, and on a solo run none of them is a
      teammate -- the crew rail is empty and nobody is in the account.
   2. They move, and they end up standing at machines rather than milling in
      the middle of the carpet.
   3. Not one penny moves. `resolve` is the single settlement funnel for the
      whole game, so watching it is enough: over a minute of floor time with
      the player standing still, the bank must not change by a cent. A crowd
      that can reach your money is the exact bug this replaced. */
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

let bad = 0;
const check = (what, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + what + (detail ? '   ' + detail : ''));
  if (!ok) bad++;
};

await page.goto('file://' + FILE);
await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 90000 });
await page.click('.titlebtn--primary');
await page.waitForTimeout(400);
const go = await page.$('[data-go]');
if (go) await go.click();
await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 90000 });
await page.evaluate(() => { GWScreens.close(true); GWShell.store.s.mods.allFloors = true; });

console.log('\nnobody is on your side of the account');
const solo = await page.evaluate(() => ({
  teammates: GWShell.store.s.friends.length,
  railRows: document.querySelectorAll('#crewList li').length,
}));
check('a solo run has no teammates', solo.teammates === 0, solo.teammates + ' in the run');
check('and nothing in the crew rail', solo.railRows === 0, solo.railRows + ' rows');

await page.evaluate(() => GWShell.enterFloor(0));
await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world', { timeout: 90000 });
await page.waitForTimeout(1500);

console.log('\nbut the room is not empty');
const first = await page.evaluate(() => {
  const people = GWShell.crew.people;
  return {
    total: people.length,
    strangers: people.filter((p) => p.stranger).length,
    tagged: people.filter((p) => p.tag).length,
    where: people.map((p) => [p.pos.x, p.pos.z]),
  };
});
check('there are strangers on the floor', first.strangers >= 4, first.strangers + ' of them');
check('and none of them is captioned', first.tagged === 0, first.tagged + ' name tags');

/* Sixty seconds of floor time, with the player parked out of the way. The
   frame clamps dt at a tenth of a second, so on the software rasteriser this
   is wall-clock rather than game-clock -- which is the honest way round: a
   crowd that only moves when the machine is fast is not a crowd. */
console.log('\nand they are doing something with their evening');
const bankBefore = await page.evaluate(() => {
  const st = GWShell.player.state;
  st.pos.set(GWShell.level.lift.x, st.pos.y, GWShell.level.lift.z + 2.5);
  return GWShell.store.s.bank;
});
await page.waitForTimeout(30000);
const later = await page.evaluate(() => {
  const people = GWShell.crew.people;
  return {
    atMachines: people.filter((p) => p.stranger && p.at).length,
    playing: people.filter((p) => p.stranger && p.state === 'play').length,
    where: people.map((p) => [p.pos.x, p.pos.z]),
    bank: GWShell.store.s.bank,
    hands: GWShell.store.s.stats.hands,
  };
});
let moved = 0;
for (let i = 0; i < first.where.length; i++) {
  const a = first.where[i], b = later.where[i];
  if (!a || !b) continue;
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1.5) moved++;
}
check('most of them went somewhere', moved >= Math.ceil(first.strangers * 0.5),
  moved + ' of ' + first.strangers + ' moved more than a metre and a half');
check('and some of them are at a machine', later.atMachines >= 1,
  later.atMachines + ' at a machine, ' + later.playing + ' stood playing one');

console.log('\nand none of it is your money');
check('the bank did not move', later.bank === bankBefore,
  bankBefore + ' -> ' + later.bank);
check('and nothing settled through the funnel', later.hands === 0,
  later.hands + ' hands');

console.log('');
for (const e of errors) console.log('  ' + e);
check('no page or console errors', errors.length === 0, String(errors.length));

await browser.close();
console.log(bad ? '\n' + bad + ' failed' : '\nthe casino has other people in it');
process.exitCode = bad ? 1 : 0;
