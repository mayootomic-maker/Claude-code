/* Audit every payout in the building.

   Two checks. First, arithmetic: for every bet the game declares, does its own
   stated probability times its own stated payout leave a house edge that is
   positive and sane? A negative edge is a machine that loses money; a huge one
   is a machine nobody should play.

   Second, and the one that matters: for the games that can be enumerated, walk
   the entire sample space through the game's *own* outcome function and check
   the count against what the odds panel prints. Plinko cannot be enumerated --
   its distribution comes out of the physics -- so its board is re-simulated
   here instead.

   Usage: node gwyf-web/tools/odds.mjs [plinkoDrops] */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '..', 'gamble-with-your-friends.html');
if (!existsSync(FILE)) { console.error('build it first: node gwyf-web/build.mjs'); process.exit(1); }

const DROPS = Number(process.argv[2] || 4000);
const TOLERANCE = 0.0005;   // enumerated games must agree exactly-ish
/* Plinko is checked per pocket with a z-test rather than on its return.

   The return is dominated by the two 26x pockets, which come up about once in
   two hundred drops, so a few thousand drops leave the estimate with a standard
   error of seven percentage points -- wide enough to "fail" a table that is
   perfectly correct, and wide enough to pass one that is badly wrong. Comparing
   each pocket's frequency against its published probability, scaled by that
   pocket's own binomial standard error, tests the actual claim. */
const Z_LIMIT = 4;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('file://' + FILE);
await page.waitForSelector('#app:not([hidden])', { timeout: 60000 });

const report = await page.evaluate(async (drops) => {
  const out = [];
  const rng = new GWRng.Rng(20260828);
  for (const def of GWGames.all()) {
    const row = { id: def.id, name: def.name, bets: [], checks: [] };
    for (const bet of def.bets) {
      row.bets.push({
        id: bet.id, prob: bet.prob, pays: bet.pays,
        edge: 1 - bet.prob * bet.pays,
      });
    }
    if (def.verify) {
      const seen = await def.verify(rng, drops);
      for (const v of seen) {
        const bet = def.bets.find((b) => b.id === v.id);
        if (!bet) { row.checks.push({ id: v.id, error: 'verify() named a bet that does not exist' }); continue; }
        if (v.distribution) {
          row.pockets = v.distribution.map((seen, i) => ({
            i, seen, published: v.published[i], drops,
          }));
          row.checks.push({ id: v.id, kind: 'return', declared: bet.pays, measured: v.pays,
                            physics: true });
        } else if (v.pays !== undefined) {
          row.checks.push({ id: v.id, kind: 'return', declared: bet.pays, measured: v.pays });
        } else {
          row.checks.push({ id: v.id, kind: 'chance', declared: bet.prob, measured: v.prob });
        }
      }
      const total = seen.reduce((s, v) => s + (v.prob === 1 ? 0 : v.prob), 0);
      if (def.id === 'duckrace' || def.id === 'roulette') row.probSum = total;
    }
    out.push(row);
  }
  return out;
}, DROPS);

await browser.close();

let failures = 0;
const pct = (v) => (v * 100).toFixed(2) + '%';

for (const game of report) {
  console.log('\n' + game.name + '  (' + game.id + ')');
  for (const bet of game.bets) {
    const edgeOk = bet.edge >= -0.0001 && bet.edge <= 0.12;
    if (!edgeOk) failures++;
    console.log('   ' + bet.id.padEnd(11)
      + 'chance ' + pct(bet.prob).padStart(8)
      + '   pays ' + ('×' + bet.pays.toFixed(3)).padStart(9)
      + '   house ' + pct(bet.edge).padStart(8)
      + (edgeOk ? '' : '   <-- OUT OF RANGE'));
  }
  for (const c of game.checks) {
    if (c.error) { failures++; console.log('   ! ' + c.id + ': ' + c.error); continue; }
    if (c.physics) {
      // Reported for information; the pocket-by-pocket test below is the check.
      console.log('   simulated return over ' + DROPS + ' drops: ×' + c.measured.toFixed(4)
        + '  (published ×' + c.declared.toFixed(4) + ')');
      continue;
    }
    const diff = Math.abs(c.declared - c.measured);
    const ok = diff <= TOLERANCE;
    if (!ok) failures++;
    console.log('   ' + (ok ? 'verified' : 'MISMATCH') + '  ' + c.id + ' ' + c.kind
      + ': declared ' + c.declared.toFixed(5) + ', counted ' + c.measured.toFixed(5)
      + '  (Δ ' + diff.toFixed(5) + ')');
  }

  if (game.pockets) {
    let worst = 0, worstAt = 0;
    for (const pocket of game.pockets) {
      const p = pocket.published;
      const se = Math.sqrt(Math.max(p * (1 - p), 1e-9) / pocket.drops);
      const z = Math.abs(pocket.seen - p) / se;
      if (z > worst) { worst = z; worstAt = pocket.i; }
    }
    const ok = worst <= Z_LIMIT;
    if (!ok) failures++;
    console.log('   ' + (ok ? 'verified' : 'MISMATCH')
      + '  every pocket within ' + Z_LIMIT + " standard errors of its published chance"
      + ' (worst: pocket ' + worstAt + ' at ' + worst.toFixed(2) + ')');
    console.log('     published  ' + game.pockets.map((x) => (x.published * 100).toFixed(1)).join(' '));
    console.log('     simulated  ' + game.pockets.map((x) => (x.seen * 100).toFixed(1)).join(' '));
  }
  if (game.probSum !== undefined) {
    // Roulette's outside bets overlap, so only the mutually exclusive sets sum
    // to one; the duck race's five runners must.
    const ok = game.id !== 'duckrace' || Math.abs(game.probSum - 1) < 1e-9;
    if (!ok) failures++;
    console.log('   ' + (ok ? 'verified' : 'MISMATCH') + '  chances sum to ' + game.probSum.toFixed(6));
  }
}

if (errors.length) { failures++; console.error('\npage errors:\n' + errors.join('\n')); }
console.log('\n' + (failures ? failures + ' PROBLEM(S)' : 'every published number checks out'));
process.exitCode = failures ? 1 : 0;
