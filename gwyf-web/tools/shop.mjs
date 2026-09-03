/* The shop, and whether the things in it do what they claim.

   Twenty-seven items and nine perks is a lot of prose, and prose is where a
   game hides a button that does nothing. Every effect that can be checked from
   outside is checked here: the money leaves, the thing arrives, and the number
   it promised to move has moved. */
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
const page = await browser.newPage({ viewport: { width: 1240, height: 860 } });
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

let bad = 0;
const check = (what, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + what + (detail ? '   ' + detail : ''));
  if (!ok) bad++;
};

console.log('\nthe shelves');
await page.evaluate(() => { GWShell.store.s.bank = 100000; GWScreens.show('shop'); });
await page.waitForTimeout(400);
const shelves = await page.evaluate(() => ({
  titles: Array.from(document.querySelectorAll('.shelf__title')).map((h) => h.textContent),
  items: document.querySelectorAll('[data-item]').length,
  all: GWConfig.ITEMS.length,
  effects: document.querySelectorAll('.ware__effect').length,
  tonight: document.querySelectorAll('.ware__tonight').length,
}));
check('items are on labelled shelves', shelves.titles.length === 3, shelves.titles.join(', '));
check('every item is on one of them', shelves.items === shelves.all,
  shelves.items + ' of ' + shelves.all);
check('kit prints what it does to the odds', shelves.effects >= 15, String(shelves.effects));
check('and which of tonight’s machines it covers', shelves.tonight > 0, String(shelves.tonight));

console.log('\nkit for every machine in the building');
const covered = await page.evaluate(() => {
  const games = GWGames.all().map((g) => g.id);
  const missing = games.filter((g) => !GWConfig.ITEMS.some((i) => i.edge && i.edge[g]));
  return { games: games.length, missing };
});
check('no machine is without kit', covered.missing.length === 0,
  covered.missing.length ? covered.missing.join(', ') : covered.games + ' machines');

console.log('\nbuying an item');
const bought = await page.evaluate(async () => {
  const bank = GWShell.store.s.bank;
  const btn = document.querySelector('[data-item="luckycoin"]');
  if (!btn) return { missing: true };
  btn.click();
  await new Promise((r) => setTimeout(r, 200));
  return { bank, after: GWShell.store.s.bank,
           onShelf: (GWShell.store.s.pendingItems || []).indexOf('luckycoin') >= 0 };
});
check('the money comes out of the bank', bought.after === bought.bank - 260,
  bought.bank + ' -> ' + bought.after);
check('and it goes on the shelf, not into your pocket', bought.onShelf === true);

console.log('\nwhat the rule-changing items change');
const rules = await page.evaluate(() => {
  const s = GWShell.store;
  const before = {
    comps: GWConfig.compsFor((id) => s.has(id)),
    maxBet: s.floorLimits().maxBet,
  };
  s.s.items.compcard = 1;
  const withCard = GWConfig.compsFor((id) => s.has(id));
  s.meta.perks.deeperpockets = 2;
  const withPockets = s.floorLimits().maxBet;
  delete s.s.items.compcard;
  s.meta.perks.deeperpockets = 0;
  return { before, withCard, withPockets };
});
check('the comp card doubles the comps', rules.withCard === rules.before.comps * 2,
  rules.before.comps + ' -> ' + rules.withCard);
check('deeper pockets raises the table ceiling', rules.withPockets > rules.before.maxBet,
  rules.before.maxBet + ' -> ' + rules.withPockets);

const heatSlower = await page.evaluate(() => {
  const s = GWShell.store;
  /* Four winning hands at one table, with and without the ear. `played` is
     what the shell calls when a hand settles; `heatOf` is the number the pit
     is actually working from. */
  const run = () => {
    const h = GWHeat.create(s);
    h.enterFloor();
    h.newDay();
    for (let i = 0; i < 4; i++) h.played('coinflip', 100, 200);
    return h.heatOf('coinflip');
  };
  const without = run();
  s.s.items.managersear = 1;
  const with_ = run();
  delete s.s.items.managersear;
  return { without, with_ };
});
check('the manager’s ear slows the pit down', heatSlower.with_ < heatSlower.without,
  heatSlower.without.toFixed(3) + ' -> ' + heatSlower.with_.toFixed(3));

console.log('\nbuying a ticket perk');
const perk = await page.evaluate(async () => {
  GWShell.store.meta.tickets = 20;
  GWScreens.show('shop', { tab: 'tickets' });
  await new Promise((r) => setTimeout(r, 200));
  const before = GWShell.store.meta.tickets;
  const btn = document.querySelector('[data-perk="seedmoney"]');
  if (!btn) return { missing: true };
  btn.click();
  await new Promise((r) => setTimeout(r, 200));
  return { before, after: GWShell.store.meta.tickets,
           owned: GWShell.store.meta.perks.seedmoney || 0,
           pips: document.querySelectorAll('.ware__track').length };
});
check('tickets are spent', perk.after === perk.before - 3, perk.before + ' -> ' + perk.after);
check('and the perk is owned', perk.owned >= 1, '×' + perk.owned);
check('progress is shown on the repeatable ones', perk.pips > 0, String(perk.pips));

console.log('\nnothing threw');
for (const e of errors) console.log('  ' + e);
check('no page or console errors', errors.length === 0, String(errors.length));

await browser.close();
console.log(bad ? '\n' + bad + ' failed' : '\nthe shop sells what it says it sells');
process.exit(bad ? 1 : 0);
