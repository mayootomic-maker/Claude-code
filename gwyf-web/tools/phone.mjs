/* The game on a phone, driven by taps.

   Usage: node gwyf-web/tools/phone.mjs

   The touch build was written when the map was one hall and the only verb was
   Use. Since then the yard grew a parkour with a ticket on the last crate,
   Nibor's grew a mezzanine, crouch went into the accessibility settings, and
   emotes went on G -- and nobody came back here. A phone could reach every part
   of this game except the ticket, because there was no jump button.

   So this drives it as a phone: a real touchscreen context, the stick pushed
   with a finger, the buttons tapped. Nothing calls into the player controller.
   If the climb can be done here it can be done on a phone, and if the buttons
   are under each other or off the bottom of a small screen, a tap lands on the
   wrong one and this says so. */
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';
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
// A real phone profile: touch, no hover, a coarse pointer -- which is exactly
// what `GWTouch.coarse()` tests for before it shows anything at all.
const context = await browser.newContext(Object.assign({}, devices['iPhone 12'], {
  isMobile: true, hasTouch: true,
}));
const page = await context.newPage();
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
const at = () => page.evaluate(() => {
  const st = GWShell.player.state;
  return { x: st.pos.x, z: st.pos.z, y: st.y, h: st.height, grounded: st.grounded };
});

await page.goto('file://' + FILE);
await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 120000 });
await page.tap('.titlebtn--primary');
await page.waitForTimeout(500);
const go = await page.$('[data-go]');
if (go) await go.tap();
await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 120000 });
await page.evaluate(() => GWScreens.close(true)).catch(() => {});
await page.waitForTimeout(900);

console.log('\nthe phone build turns itself on');
check('the touch layer is showing',
  await page.evaluate(() => !document.getElementById('touchLayer').hidden));
check('and the page knows it is a phone',
  await page.evaluate(() => document.documentElement.classList.contains('is-touch')));

/* Every control has to be on the screen and not underneath another one. A
   button half off the bottom of a 390-point-wide phone is a button that does
   not exist, and two that overlap are one button with a surprise in it. */
console.log('\nand every control is reachable with a thumb');
const boxes = await page.evaluate(() => {
  const ids = ['touchStick', 'touchJump', 'touchCrouch', 'touchEmote', 'touchUse'];
  const out = {};
  for (const id of ids) {
    const r = document.getElementById(id).getBoundingClientRect();
    out[id] = { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  return { boxes: out, vw: innerWidth, vh: innerHeight };
});
const list = Object.entries(boxes.boxes);
const offscreen = list.filter(([, r]) =>
  r.x < 0 || r.y < 0 || r.x + r.w > boxes.vw + 1 || r.y + r.h > boxes.vh + 1);
check('all of them are on the screen', offscreen.length === 0,
  offscreen.map(([n]) => n).join(' ') || (boxes.vw + 'x' + boxes.vh));
const tooSmall = list.filter(([, r]) => Math.min(r.w, r.h) < 40);
check('and big enough to hit', tooSmall.length === 0,
  tooSmall.map(([n, r]) => n + ' ' + Math.round(Math.min(r.w, r.h)) + 'px').join(' '));
let overlaps = [];
for (let i = 0; i < list.length; i++) {
  for (let j = i + 1; j < list.length; j++) {
    const a = list[i][1], b = list[j][1];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
      overlaps.push(list[i][0] + '/' + list[j][0]);
    }
  }
}
check('and none of them is under another', overlaps.length === 0, overlaps.join(' '));

/* Walking, with a finger on the stick rather than by writing to the stick's
   own fields -- which is the difference between testing the controls and
   testing the thing behind them. */
async function push(dx, dy, ms) {
  const r = boxes.boxes.touchStick;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  await page.touchscreen.tap(cx, cy);       // wakes the audio context too
  const t = await page.evaluateHandle(() => null);
  await t.dispose();
  await page.evaluate(async ([ox, oy, ddx, ddy, span]) => {
    const pad = document.getElementById('touchStick');
    const id = 7;
    const ev = (type, x, y) => pad.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: true,
      clientX: x, clientY: y, bubbles: true, cancelable: true,
    }));
    ev('pointerdown', ox, oy);
    ev('pointermove', ox + ddx, oy + ddy);
    await new Promise((r2) => setTimeout(r2, span));
    ev('pointerup', ox + ddx, oy + ddy);
  }, [cx, cy, dx, dy, ms]);
}

console.log('\nthe stick walks you');
const before = await at();
await push(0, -70, 1600);
await page.waitForTimeout(300);
const after = await at();
const moved = Math.hypot(after.x - before.x, after.z - before.z);
check('pushing it forward moves you', moved > 1.5, moved.toFixed(2) + ' m');

console.log('\nand the buttons do what they say');
const duckR = boxes.boxes.touchCrouch;
const standing = (await at()).h;
await page.evaluate((r) => {
  const b = document.getElementById('touchCrouch');
  b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, pointerType: 'touch',
    clientX: r.x + r.w / 2, clientY: r.y + r.h / 2, bubbles: true, cancelable: true }));
}, duckR);
await page.waitForTimeout(700);
const ducked = (await at()).h;
check('Duck ducks', ducked < standing - 0.15,
  standing.toFixed(2) + ' -> ' + ducked.toFixed(2) + ' m');
await page.evaluate((r) => {
  const b = document.getElementById('touchCrouch');
  b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, pointerType: 'touch',
    clientX: r.x + r.w / 2, clientY: r.y + r.h / 2, bubbles: true, cancelable: true }));
}, duckR);
await page.waitForTimeout(700);
check('and letting go stands you back up', (await at()).h > standing - 0.05);

/* Jump, which is the whole reason this pass happened: the ticket in the yard
   sits on top of a run of crates and there was no way to leave the ground. */
console.log('\nand Jump leaves the ground');
const groundY = (await at()).y;
const jumpR = boxes.boxes.touchJump;
await page.touchscreen.tap(jumpR.x + jumpR.w / 2, jumpR.y + jumpR.h / 2);
let apex = groundY;
for (let i = 0; i < 14; i++) {
  apex = Math.max(apex, (await at()).y);
  await page.waitForTimeout(55);
}
check('a tap gets you off the floor', apex > groundY + 0.25,
  apex.toFixed(2) + ' m at the apex');
await page.waitForTimeout(900);
check('and you land again', Math.abs((await at()).y - groundY) < 0.2);

console.log('\nand the emote wheel opens from a thumb');
const emR = boxes.boxes.touchEmote;
await page.touchscreen.tap(emR.x + emR.w / 2, emR.y + emR.h / 2);
await page.waitForTimeout(400);
check('the button opens it', await page.evaluate(() => GWEmotes.isOpen()));
const wedge = await page.evaluate(() => {
  const b = document.querySelector('#emoteWheel .emotes__pick');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { id: b.dataset.emote, x: r.x + r.width / 2, y: r.y + r.height / 2,
           on: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
});
check('and its wedges fit on a phone screen', !!wedge && wedge.on,
  wedge ? wedge.id : 'no wedges');
if (wedge && wedge.on) {
  await page.touchscreen.tap(wedge.x, wedge.y);
  await page.waitForTimeout(400);
  check('tapping one plays it',
    (await page.evaluate(() => GWShell.hands.emoting)) === wedge.id);
}
await page.evaluate(() => GWEmotes.close());

console.log('');
for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e);
check('no page or console errors', errors.length === 0, String(errors.length));

await browser.close();
console.log(bad ? '\n' + bad + ' failed' : '\nthe phone build has every verb the game has');
process.exitCode = bad ? 1 : 0;
