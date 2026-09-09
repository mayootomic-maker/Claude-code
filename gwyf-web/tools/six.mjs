/* Six seats, and the seventh person is told so.

   Usage: node gwyf-web/tools/six.mjs

   The game this follows is an online 1-6 co-op: a host and up to five invited
   friends. Nothing here enforced that -- a lobby took as many as found it, and
   everybody was drawn in the same gold because there was one default colour
   and no seat assignment at all.

   Seven windows on the local transport, joined one at a time through the
   interface the way a person joins. The first six have to seat, the seventh
   has to be turned away and told why, and the six that got in have to end up
   with six different colours -- worked out from sorted ids on every copy
   rather than negotiated, so this also checks the host and the guests agree
   about who is what colour without a word passing between them on the
   subject. */
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
// One context, because the local transport is a BroadcastChannel and that is
// exactly what it is for: other windows of the same game on the same machine.
const context = await browser.newContext({ viewport: { width: 700, height: 500 } });

let bad = 0;
const check = (what, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + what + (detail ? '   ' + detail : ''));
  if (!ok) bad++;
};

async function openWindow(label) {
  const page = await context.newPage();
  /* Seven WebGL contexts on a software rasteriser is the slowest thing this
     repository does. The default thirty-second navigation timeout is for one
     page, not for the seventh of seven. */
  page.setDefaultNavigationTimeout(180000);
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => errors.push(label + ' pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/fonts\.(googleapis|gstatic)|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_CERT_AUTHORITY_INVALID/.test(m.text())) return;
    errors.push(label + ' console: ' + m.text());
  });
  await page.goto('file://' + FILE);
  await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 90000 });
  const title = await page.$('#title:not([hidden])');
  if (title) { await page.click('.titlebtn--primary'); await page.waitForTimeout(400); }
  const go = await page.$('[data-go]');
  if (go) { await go.click(); await page.waitForTimeout(400); }
  await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 90000 });
  await page.evaluate(() => GWScreens.close(true)).catch(() => {});
  return page;
}

/* Everything through the interface: open the table screen, type a name, press
   the button a person would press. */
async function sitDown(page, name, asHost) {
  await page.evaluate(() => GWScreens.show('table'));
  await page.waitForSelector('.sheet input', { timeout: 20000 });
  await page.fill('.sheet input', name);
  const label = asHost ? 'Host here' : 'Join here';
  const button = await page.$(`.sheet button:text-is("${label}")`);
  if (!button) return false;
  await button.click();
  await page.waitForTimeout(1400);
  await page.evaluate(() => GWScreens.close(true)).catch(() => {});
  return true;
}

const NAMES = ['Ari', 'Bex', 'Cy', 'Dot', 'Eli', 'Fay', 'Gus'];
const pages = [];
console.log('');
for (let i = 0; i < NAMES.length; i++) {
  const page = await openWindow(NAMES[i]);
  pages.push(page);
  const sat = await sitDown(page, NAMES[i], i === 0);
  if (!sat) { check('window ' + (i + 1) + ' found its button', false); break; }
}

// Let the hellos settle: everyone answers everyone, so the last arrival's
// round trip is the slowest one in the room.
await pages[0].waitForTimeout(3000);

const seen = [];
for (let i = 0; i < pages.length; i++) {
  seen.push(await pages[i].evaluate(() => ({
    connected: !!(GWShell.net && GWShell.net.ready),
    peers: GWShell.net ? GWShell.net.peers.size : 0,
    roster: GWShell.net ? GWShell.net.roster().map((p) => p.name + ':' + p.colour) : [],
    seat: GWShell.net ? GWShell.net.seat : null,
    railRows: document.querySelectorAll('#crewList li').length,
    told: Array.from(document.querySelectorAll('#ticker .line'))
      .map((n) => n.textContent).filter((t) => /full/i.test(t)),
  })));
}

console.log('six of them get a seat');
const host = seen[0];
check('the host sees five others', host.peers === 5, host.peers + ' peers');
check('and the rail has five rows', host.railRows === 5, host.railRows + ' rows');

const colours = new Set([host.seat].concat(host.roster.map((r) => r.split(':')[1])));
check('everyone at the table has their own colour', colours.size === 6,
  Array.from(colours).join(' '));

/* Every copy has to agree, because nothing negotiates it: each one sorts the
   ids it knows and indexes the same six seats. If they disagree, the person
   you are looking at is a different colour to the row with their name on it. */
let agreed = true;
for (let i = 1; i < 6 && i < seen.length; i++) {
  const mine = new Set([seen[i].seat].concat(seen[i].roster.map((r) => r.split(':')[1])));
  if (mine.size !== 6) agreed = false;
  for (const c of mine) if (!colours.has(c)) agreed = false;
}
check('and every window agrees about who is what colour', agreed);

console.log('\nthe seventh is turned away');
const seventh = seen[6];
check('they did not get a seat', seventh && seventh.peers === 0,
  seventh ? seventh.peers + ' peers' : 'no seventh window');
check('and they were told why, rather than left hanging',
  !!(seventh && seventh.told.length), seventh ? (seventh.told[0] || 'nothing said') : '');
check('and the table is still six', host.peers === 5, host.peers + ' peers at the host');

console.log('');
for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e);
check('no page or console errors', errors.length === 0, String(errors.length));

await browser.close();
console.log(bad ? '\n' + bad + ' failed' : '\nsix sit down and the seventh is told');
process.exitCode = bad ? 1 : 0;
