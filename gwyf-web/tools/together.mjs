/* Two windows, playing together, driven entirely through the interface.

   This exists because the first version of the multiplayer tests called
   `GWShell.connect()` straight from the console and never touched a button. It
   passed, cleanly, while the screen those buttons live on was rendering nothing
   at all -- the builder returned `body` where every other screen returns `html`,
   so `sheet.innerHTML` was set to undefined. The transport worked perfectly and
   the feature did not exist.

   So: no reaching past the interface. Everything here clicks what a person
   would click. */
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
const context = await browser.newContext({ viewport: { width: 1150, height: 760 } });

async function openWindow(label) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(label + ' pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    /* The web fonts are the one request this page makes, and in this container
       it goes through a TLS-intercepting proxy the browser does not trust. The
       page falls back to the system stack, which is what it is meant to do
       offline; it is not the game failing. */
    if (/fonts\.(googleapis|gstatic)|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_CERT_AUTHORITY_INVALID/.test(m.text())) return;
    errors.push(label + ' console: ' + m.text());
  });
  await page.goto('file://' + FILE);
  await page.waitForSelector('#title:not([hidden])', { timeout: 90000 });
  return page;
}

/* Click through the title and the briefing the way a player does. */
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

const A = await openWindow('host');
await A.evaluate(() => localStorage.clear());
await A.reload();
await A.waitForSelector('#title:not([hidden])', { timeout: 90000 });
await intoTheGame(A);
const B = await openWindow('guest');
await intoTheGame(B);

// --- the screen itself opens and has something on it
await A.click('#btnTable');
await A.waitForTimeout(400);
const sheet = await A.evaluate(() => {
  const el = document.querySelector('.screen .sheet');
  return {
    exists: !!el,
    text: el ? el.textContent.trim().slice(0, 60) : '',
    buttons: el ? [...el.querySelectorAll('button')].map((b) => b.textContent.trim()) : [],
    hasNameField: !!document.getElementById('netName'),
  };
});
check('the screen renders', sheet.exists && sheet.text.length > 10, sheet.text);
check('it has a name field', sheet.hasNameField);
check('it offers hosting and joining', sheet.buttons.some((b) => /host/i.test(b))
  && sheet.buttons.some((b) => /join/i.test(b)), sheet.buttons.join(' / '));

// --- host from the interface
await A.fill('#netName', 'Ari');
await A.click('[data-local="host"]');
await A.waitForTimeout(700);
check('hosting starts a session', await A.evaluate(() => !!GWShell.net));
check('and says so on screen', await A.evaluate(() =>
  /hosting/i.test(document.querySelector('.screen .sheet')?.textContent || '')));

// --- join from the interface, in the other window
await B.click('#btnTable');
await B.waitForTimeout(400);
await B.fill('#netName', 'Bex');
await B.click('[data-local="join"]');
await B.waitForTimeout(1600);
check('joining starts a session', await B.evaluate(() => !!GWShell.net));

// --- they can see each other, by name, on the screen
const rosterA = await A.evaluate(() => document.querySelector('.screen .sheet')?.textContent || '');
const rosterB = await B.evaluate(() => document.querySelector('.screen .sheet')?.textContent || '');
check('the host sees the guest by name', /Bex/.test(rosterA), rosterA.replace(/\s+/g, ' ').slice(0, 90));
check('the guest sees the host by name', /Ari/.test(rosterB), rosterB.replace(/\s+/g, ' ').slice(0, 90));

// --- close the screen and play: the money is shared
await A.click('[data-close]');
await B.click('[data-close]');
await A.waitForTimeout(300);
const before = await A.evaluate(() => GWShell.store.s.bank);
await B.evaluate(() => { GWShell.net.stake(100); GWShell.net.resolve('coinflip', 100, 0, 'Coin Toss'); });
await A.waitForTimeout(1200);
const after = await A.evaluate(() => GWShell.store.s.bank);
/* A lost hand does not cost the whole stake any more: the house pays comps on
   every stake whatever happens. Read off GWConfig rather than written down, so
   changing the rate does not quietly turn this into a test of a number nobody
   maintains. */
const comps = await A.evaluate(() => GWConfig.COMPS);
check('a guest losing moves the host’s bank', after === before - 100 + 100 * comps,
  before + ' -> ' + after + ' (100 staked, ' + (comps * 100).toFixed(0) + '% comped)');

// --- and the other player has a body in the world
const seen = await B.evaluate(() => {
  const p = [...GWShell.net.peers.values()][0];
  return p ? { name: p.name, drawn: !!p.body } : null;
});
check('the other player is drawn in the room', !!(seen && seen.drawn), JSON.stringify(seen));

// --- leaving works too
await B.click('#btnTable');
await B.waitForTimeout(400);
await B.click('[data-leave]');
await B.waitForTimeout(600);
check('leaving the table ends the session', await B.evaluate(() => !GWShell.net));

// Four WebGL pages at once is more than a software rasteriser will carry: the
// fifth never finishes loading. The first pair is done with, so it goes.
await A.close();
await B.close();

/* --- and the other-computer path, through its own paste boxes ------------
   Driven in one browser because two machines are not available here, but every
   step is the one a person performs: press Host a game, copy the block of text
   out of the box, paste it into the other window, copy the reply back. */
{
  const H = await openWindow('peer-host');
  await H.evaluate(() => localStorage.clear());
  await H.reload();
  await H.waitForSelector('#title:not([hidden])', { timeout: 90000 });
  await intoTheGame(H);
  const G = await openWindow('peer-guest');
  await intoTheGame(G);

  await H.click('#btnTable');
  await H.waitForTimeout(300);
  await H.fill('#netName', 'Ari');
  await H.click('[data-peer="host"]');
  // Gathering candidates takes a moment, and the box is empty until it is done.
  await H.waitForFunction(() => {
    const t = document.getElementById('netOffer');
    return t && t.value.length > 100;
  }, { timeout: 30000 });
  const offer = await H.inputValue('#netOffer');
  check('the host gets a code to send', offer.length > 100, offer.length + ' characters');

  await G.click('#btnTable');
  await G.waitForTimeout(300);
  await G.fill('#netName', 'Bex');
  await G.click('[data-peer="join"]');
  await G.waitForSelector('#netOffer', { timeout: 15000 });
  await G.fill('#netOffer', offer);
  await G.click('[data-answer]');
  await G.waitForFunction(() => {
    const t = document.getElementById('netAnswer');
    return t && t.value.length > 100;
  }, { timeout: 30000 });
  const answer = await G.inputValue('#netAnswer');
  check('the guest gets a reply to send back', answer.length > 100, answer.length + ' characters');

  await H.fill('#netAnswer', answer);
  await H.click('[data-accept]');
  await H.waitForTimeout(6000);
  check('the two browsers connect', await H.evaluate(() => !!(GWShell.net && GWShell.net.kind === 'peer')));
  const names = await H.evaluate(() => GWShell.net.roster().map((p) => p.name));
  check('and know each other by name', names.includes('Bex'), names.join(', '));

  const was = await H.evaluate(() => GWShell.store.s.bank);
  await G.evaluate(() => { GWShell.net.stake(250); GWShell.net.resolve('dice', 250, 0, 'Over / Under'); });
  await H.waitForTimeout(1500);
  const now = await H.evaluate(() => GWShell.store.s.bank);
  const rate = await H.evaluate(() => GWConfig.COMPS);
  check('money crosses the connection', now === was - 250 + 250 * rate,
    was + ' -> ' + now);
  await H.close();
  await G.close();
}

await browser.close();
if (errors.length) {
  console.error('\n' + errors.length + ' ERROR(S):');
  for (const e of [...new Set(errors)].slice(0, 10)) console.error('  ' + e);
  bad += errors.length;
}
console.log(bad ? '\n' + bad + ' PROBLEM(S)' : '\nplay together works end to end');
process.exitCode = bad ? 1 : 0;
