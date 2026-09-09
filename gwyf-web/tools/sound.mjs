/* Is there a room, and can you hear it?

   Usage: node gwyf-web/tools/sound.mjs

   `audio.js` was a hundred and fifty lines of one-shots: the building made a
   noise when something happened and was silent the rest of the time. A bed was
   added for that, and the trouble with an ambient bed is that a working one and
   a missing one look identical from everywhere except the speakers -- which is
   the same shape of mistake as a world where nothing had a top.

   So nothing here asserts that a string was assigned. It taps the master bus
   and measures what is on it: silent before the first gesture, audible after,
   different on every floor, louder in a crowd than alone, and actually silent
   when muted. Chromium is told to allow audio without a gesture so the page
   can be driven, but the game's own unlock still has to run for anything to
   exist at all. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '..', 'gamble-with-your-friends.html');
if (!existsSync(FILE)) { console.error('build it first'); process.exit(1); }

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
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

/* The loudest thing on the bus over a second and a bit. A single reading can
   land in the trough of a swell -- the babble breathes over ten seconds, on
   purpose -- so one sample proving silence would be a lie. */
async function loudest(ms) {
  return page.evaluate((span) => new Promise((done) => {
    let peak = 0;
    const until = performance.now() + span;
    const step = () => {
      peak = Math.max(peak, GWShell.audio.level());
      if (performance.now() < until) requestAnimationFrame(step);
      else done(peak);
    };
    step();
  }), ms);
}

await page.goto('file://' + FILE);
await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 90000 });

console.log('\nnothing plays before you touch anything');
const beforeUnlock = await page.evaluate(() => GWShell.audio.level());
check('the bus is silent until the first gesture', beforeUnlock === 0,
  beforeUnlock.toFixed(5));

await page.click('.titlebtn--primary');
await page.waitForTimeout(400);
const go = await page.$('[data-go]');
if (go) await go.click();
await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 90000 });
await page.evaluate(() => GWScreens.close(true)).catch(() => {});
await page.waitForTimeout(2500);

console.log('\nand then the room is there');
const room = await page.evaluate(() => GWShell.audio.room);
check('a room is playing', !!room, String(room));
const inRoom = await loudest(1400);
check('and you can hear it', inRoom > 0.002, 'peak ' + inRoom.toFixed(4));

console.log('\nevery floor is a different room');
await page.evaluate(() => { GWShell.store.s.mods.allFloors = true; });
const ids = [];
const levels = [];
for (let f = 0; f < 4; f++) {
  await page.evaluate((n) => GWShell.enterFloor(n), f);
  await page.waitForFunction(() => !GWLoading.isOpen() && GWShell.mode === 'world',
    { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2600);
  ids.push(await page.evaluate(() => GWShell.audio.room));
  levels.push(await loudest(900));
}
check('each floor names its own room', new Set(ids).size === 4, ids.join(' '));
check('and every one of them is audible', levels.every((l) => l > 0.002),
  levels.map((l) => l.toFixed(4)).join(' '));

/* The crowd. Standing in the middle of a floor with people on it has to be
   louder than standing in an empty one, and it has to be measured from where
   the people actually are rather than from a count of the floor -- so this
   empties the crowd rather than moving the player, and compares. */
console.log('\nand a crowd you can hear');
const withCrowd = await page.evaluate(async () => {
  // Let the eased babble settle on whatever is actually near.
  await new Promise((r) => setTimeout(r, 1800));
  return GWShell.audio.crowd;
});
const peopleNear = await page.evaluate(() => {
  const me = GWShell.player.state.pos;
  return GWShell.crew.people.filter((p) => p.pos
    && Math.hypot(p.pos.x - me.x, p.pos.z - me.z) < 16).length;
});
check('people near you make the room louder', withCrowd > 0,
  peopleNear + ' within earshot, babble at ' + withCrowd.toFixed(3));

const alone = await page.evaluate(async () => {
  // Walk the crowd off to the far corner rather than deleting them: the
  // question is whether distance is what the level is made of.
  for (const p of GWShell.crew.people) { p.pos.x = 900; p.pos.z = 900; }
  await new Promise((r) => setTimeout(r, 2200));
  return GWShell.audio.crowd;
});
check('and walking away from them makes it quieter', alone < withCrowd,
  withCrowd.toFixed(3) + ' -> ' + alone.toFixed(3));

console.log('\nand mute means mute');
await page.evaluate(() => GWShell.audio.setMuted(true));
await page.waitForTimeout(500);
const muted = await loudest(1200);
check('the bus goes properly silent', muted < 0.0005, 'peak ' + muted.toFixed(5));
await page.evaluate(() => GWShell.audio.setMuted(false));
await page.waitForTimeout(1200);
const back = await loudest(1200);
check('and comes back when you unmute', back > 0.002, 'peak ' + back.toFixed(4));

console.log('');
for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e);
check('no page or console errors', errors.length === 0, String(errors.length));

await browser.close();
console.log(bad ? '\n' + bad + ' failed' : '\nthe building makes a noise');
process.exitCode = bad ? 1 : 0;
