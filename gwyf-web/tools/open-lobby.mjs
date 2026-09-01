/* Two strangers, no code between them.

   One window hosts a public lobby. The other window, which has been told
   nothing, reads the lobby off the list and clicks Join. Everything is done by
   clicking what a person would click; the only thing reached past the interface
   is the broker address, which is redirected at a local one because this
   container cannot reach the public brokers (the outbound proxy will not tunnel
   a WebSocket). That redirect is the equivalent of a hosts file -- the client,
   the packets and the whole of the UI are the real ones. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBroker } from './broker.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '..', 'gamble-with-your-friends.html');
if (!existsSync(FILE)) { console.error('build it first'); process.exit(1); }

const broker = await startBroker();
console.log('broker: ' + broker.url);

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1150, height: 760 } });

async function openWindow(label) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(label + ' pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/fonts\.(googleapis|gstatic)|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED/.test(m.text())) return;
    errors.push(label + ' console: ' + m.text());
  });
  await page.goto('file://' + FILE);
  await page.waitForSelector('#title:not([hidden])', { timeout: 90000 });
  await page.evaluate((url) => {
    GWLink.BROKERS.length = 0;
    GWLink.BROKERS.push({ url, name: 'the test broker' });
  }, broker.url);
  return page;
}

async function intoTheGame(page) {
  await page.click('.titlebtn--primary');
  await page.waitForTimeout(500);
  const go = await page.$('[data-go]');
  if (go) await go.click();
  await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 90000 });
  await page.waitForTimeout(600);
}

let bad = 0;
const check = (what, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + what + (detail ? '   ' + detail : ''));
  if (!ok) bad++;
};
const wait = (p, ms) => p.waitForTimeout(ms);

async function openTable(page, name) {
  await page.click('#btnTable');
  await wait(page, 350);
  await page.fill('#netName', name);
}

const A = await openWindow('host');
await A.evaluate(() => localStorage.clear());
await A.reload();
await A.waitForSelector('#title:not([hidden])', { timeout: 90000 });
await A.evaluate((url) => {
  GWLink.BROKERS.length = 0;
  GWLink.BROKERS.push({ url, name: 'the test broker' });
}, broker.url);
await intoTheGame(A);

const B = await openWindow('guest');
await intoTheGame(B);

console.log('\nthe public section exists and reaches the broker');
await openTable(A, 'Ivo');
const shown = await A.evaluate(() => {
  const btn = document.querySelector('[data-open="host"]');
  const list = document.querySelector('#netOpenList');
  return {
    hasButton: !!btn, enabled: btn ? !btn.disabled : false,
    hasList: !!list,
    heading: Array.from(document.querySelectorAll('.netway h3')).map((h) => h.textContent),
  };
});
check('a Host a public lobby button is on the screen', shown.hasButton && shown.enabled);
check('there is a list element for the lobbies', shown.hasList);
check('the section is headed for what it is', shown.heading.includes('Anyone on the internet'),
  shown.heading.join(' / '));

// The status line must say it connected -- to the broker, before any lobby.
await A.waitForFunction(() => {
  const el = document.querySelector('#netOpenStatus');
  return el && /Connected via/.test(el.textContent);
}, { timeout: 15000 }).catch(() => {});
const status = await A.evaluate(() => document.querySelector('#netOpenStatus').textContent);
check('the screen says it reached a broker', /Connected via/.test(status), status);

console.log('\nhosting puts a lobby on the list');
await A.click('[data-open="host"]');
await A.waitForFunction(() => GWShell.net && GWShell.net.isHost, { timeout: 20000 });
check('the host is connected', await A.evaluate(() => !!GWShell.net));
check('the host link is the open one', await A.evaluate(() => GWShell.net.kind) === 'open');

console.log('\nthe guest sees it with no code, and joins with a name');
await openTable(B, 'Ren');
await B.waitForFunction(() => {
  return document.querySelectorAll('#netOpenList [data-join]').length > 0;
}, { timeout: 20000 });
const listed = await B.evaluate(() => Array.from(document.querySelectorAll('#netOpenList .lobby'))
  .map((li) => li.textContent));
check('the host appears on the guest’s list', listed.length === 1, JSON.stringify(listed));
check('the list shows who is hosting', /Ivo/.test(listed.join(' ')), listed.join(' '));
check('no code was typed anywhere', await B.evaluate(() =>
  !document.querySelector('#netOpenList textarea')));

await B.click('#netOpenList [data-join]');
await B.waitForFunction(() => GWShell.net && GWShell.net.ready, { timeout: 25000 });
check('the guest is connected', await B.evaluate(() => !!GWShell.net));
check('the guest is not the host', await B.evaluate(() => !GWShell.net.isHost));

console.log('\nthey can see each other');
await A.waitForFunction(() => GWShell.net && GWShell.net.roster().length > 0, { timeout: 20000 })
  .catch(() => {});
const rosterA = await A.evaluate(() => GWShell.net.roster().map((p) => p.name));
const rosterB = await B.evaluate(() => GWShell.net.roster().map((p) => p.name));
check('the host sees the guest by name', rosterA.includes('Ren'), JSON.stringify(rosterA));
check('the guest sees the host by name', rosterB.includes('Ivo'), JSON.stringify(rosterB));

console.log('\nthe money is shared');
const before = await A.evaluate(() => GWShell.store.s.bank);
await B.evaluate(() => GWShell.net.stake(250));
await wait(A, 900);
const after = await A.evaluate(() => GWShell.store.s.bank);
check('a guest stake moves the host’s bank', after === before - 250, before + ' -> ' + after);
await wait(B, 900);
const guestBank = await B.evaluate(() => GWShell.store.s.bank);
check('the guest is shown the host’s bank', guestBank === after, guestBank + ' vs ' + after);

console.log('\nthe same run, the same rooms');
const seeds = await Promise.all([A, B].map((p) => p.evaluate(() => GWShell.store.s.seed)));
check('both are on the same seed', seeds[0] === seeds[1], seeds.join(' vs '));

console.log('\nleaving takes the lobby off the list');
await A.evaluate(() => GWScreens.show('table'));
await wait(A, 300);
await A.click('[data-leave]');
await wait(A, 500);
check('the host is on its own again', await A.evaluate(() => !GWShell.net));
// The guest, still on the table screen, should watch the list empty out.
await B.evaluate(() => { GWShell.disconnect(); GWScreens.show('table'); });
await wait(B, 1200);
const stillListed = await B.evaluate(() =>
  document.querySelectorAll('#netOpenList [data-join]').length);
check('the lobby is gone from the list', stillListed === 0, String(stillListed));

console.log('\nnothing threw');
for (const e of errors) console.log('  ' + e);
check('no page or console errors', errors.length === 0, String(errors.length));

await browser.close();
await broker.close();
console.log(bad ? '\n' + bad + ' failed' : '\nall good');
process.exit(bad ? 1 : 0);
