/* Can you emote, and does anybody see it?

   Usage: node gwyf-web/tools/emotes.mjs

   An emote has three places to go and only one of them is easy to check. Your
   own hands have to do it, because from where you are stood the whole of you is
   two mittens in the corners of the frame -- a button that only works on other
   people's screens is a button that looks broken. It has to reach the other
   players. And the room has to answer, or it is an animation rather than an
   emote.

   So this opens two windows on the local transport and drives the first one
   with the keyboard. Nothing calls `shell.emote` directly: if a key does not
   reach it, that is the bug. The second window is asked what it saw, by
   measuring where the other player's hands actually are -- a peer that received
   the message and did nothing with it would pass a test that asked whether the
   message arrived. */
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
const context = await browser.newContext({ viewport: { width: 760, height: 540 } });

let bad = 0;
const check = (what, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + what + (detail ? '   ' + detail : ''));
  if (!ok) bad++;
};

async function openWindow(label) {
  const page = await context.newPage();
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

async function sitDown(page, name, asHost) {
  await page.evaluate(() => GWScreens.show('table'));
  await page.waitForSelector('.sheet input', { timeout: 20000 });
  await page.fill('.sheet input', name);
  const button = await page.$(`.sheet button:text-is("${asHost ? 'Host here' : 'Join here'}")`);
  if (!button) return false;
  await button.click();
  await page.waitForTimeout(1400);
  await page.evaluate(() => GWScreens.close(true)).catch(() => {});
  return true;
}

console.log('');
const host = await openWindow('host');
const guest = await openWindow('guest');
check('two windows opened', !!host && !!guest);
await sitDown(host, 'Ari', true);
await sitDown(guest, 'Bex', false);
await host.waitForTimeout(2500);

const vocab = await host.evaluate(() => GWShell.emotes.map((m) => m.id + ':' + m.key));
console.log('the vocabulary is one list');
check('there are emotes, each on its own key', vocab.length >= 6
  && new Set(vocab.map((v) => v.split(':')[1])).size === vocab.length, vocab.join(' '));

/* Your own hands. Measured before and during, from the hand meshes rather than
   from a flag: a wave that sets `emoting` and moves nothing is the failure this
   is here for. */
console.log('\nyour own hands do it');
const restY = await host.evaluate(() => GWShell.hands.hands[0].position.y);
await host.keyboard.press('Digit1');            // Wave
await host.waitForTimeout(450);
const waveY = await host.evaluate(() => GWShell.hands.hands[0].position.y);
const naming = await host.evaluate(() => GWShell.hands.emoting);
check('pressing 1 starts a wave', naming === 'greet', String(naming));
check('and the hand actually comes up', waveY > restY + 0.005,
  restY.toFixed(4) + ' -> ' + waveY.toFixed(4));

/* Waited for rather than timed.

   A gesture runs on the frame clock, and `dt` is clamped at a tenth of a
   second so a stalled tab cannot teleport anybody. Two windows on a software
   rasteriser render at a few frames a second, so a 1.6-second wave takes four
   or five seconds of wall clock -- correctly, in slow motion. A test that
   sleeps for the gesture's stated length and then asserts it is over is
   measuring this machine's frame rate. */
const ended = await host.waitForFunction(() => !GWShell.hands.emoting,
  null, { timeout: 30000 }).then(() => true).catch(() => false);
check('the wave finishes on its own', ended);
const afterY = await host.evaluate(() => GWShell.hands.hands[0].position.y);
check('and the hand goes back down', Math.abs(afterY - restY) < 0.004,
  restY.toFixed(4) + ' -> ' + afterY.toFixed(4));

/* The other window. Same question, asked of the body it drew for the host. */
console.log('\nand the others see it');
const peerRest = await guest.evaluate(() => {
  const p = Array.from(GWShell.net.peers.values()).find((x) => x.body);
  return p ? p.body.hands[0].position.y : null;
});
check('the guest has drawn the host', peerRest !== null, String(peerRest));
await host.keyboard.press('Digit4');            // Cheer, both hands well up
await guest.waitForTimeout(700);
const peerUp = await guest.evaluate(() => {
  const p = Array.from(GWShell.net.peers.values()).find((x) => x.body);
  return p ? { y: p.body.hands[0].position.y, playing: p.emote } : null;
});
check('and sees the cheer arrive', !!peerUp && peerUp.playing === 'cheer',
  peerUp ? String(peerUp.playing) : 'no body');
check('and moves their arms for it', !!peerUp && peerRest !== null
  && peerUp.y > peerRest + 0.02,
  peerRest === null ? '' : peerRest.toFixed(3) + ' -> ' + (peerUp ? peerUp.y.toFixed(3) : '?'));

const peerEnded = await guest.waitForFunction(() => {
  const p = Array.from(GWShell.net.peers.values()).find((x) => x.body);
  return !!p && !p.emote;
}, null, { timeout: 30000 }).then(() => true).catch(() => false);
check('it finishes at their end too', peerEnded);
const peerBack = await guest.evaluate(() => {
  const p = Array.from(GWShell.net.peers.values()).find((x) => x.body);
  return p ? p.body.hands[0].position.y : null;
});
check('and puts their arms down again',
  peerBack !== null && Math.abs(peerBack - peerRest) < 0.02,
  peerBack === null ? '' : peerRest.toFixed(3) + ' -> ' + peerBack.toFixed(3));

/* The wheel. It is how you learn the keys, so what it lists has to be what the
   keys do -- a wheel with its own copy of the list is the whole hazard. */
console.log('\nand the wheel says what the keys do');
await host.keyboard.press('KeyG');
await host.waitForTimeout(300);
const wheel = await host.evaluate(() => {
  if (!GWEmotes.isOpen()) return null;
  return Array.from(document.querySelectorAll('#emoteWheel .emotes__pick')).map((b) =>
    b.dataset.emote + ':' + b.querySelector('.emotes__key').textContent);
});
check('G opens it', wheel !== null);
check('and every wedge matches the vocabulary',
  !!wheel && wheel.join(' ') === vocab.join(' '), wheel ? wheel.join(' ') : '');
// Clicking one has to fire it, not just look like a button.
await host.click('#emoteWheel .emotes__pick[data-emote="dance"]');
await host.waitForTimeout(300);
check('clicking a wedge does the emote',
  (await host.evaluate(() => GWShell.hands.emoting)) === 'dance');
check('and closes the wheel', !(await host.evaluate(() => GWEmotes.isOpen())));

console.log('\nand a number key is not a stake button');
await host.evaluate(() => GWScreens.show('shop'));
await host.waitForTimeout(400);
await host.keyboard.press('Digit1');
await host.waitForTimeout(250);
check('nothing emotes while a screen is up',
  (await host.evaluate(() => GWShell.hands.emoting)) !== 'greet');
await host.evaluate(() => GWScreens.close(true));

console.log('');
for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e);
check('no page or console errors', errors.length === 0, String(errors.length));

await browser.close();
console.log(bad ? '\n' + bad + ' failed' : '\nemotes reach everybody');
process.exitCode = bad ? 1 : 0;
