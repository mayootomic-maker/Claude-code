/* Nibor Second Hand Store, walked to on foot.

   Usage: node gwyf-web/tools/nibor.mjs

   The cosmetics existed for a while as two screens behind a tab row in the back
   office, which is a menu with a shop's name on it. This checks that it is a
   place instead: a shopfront you walk into, a counter you buy at, a flight of
   stairs, and a wardrobe and a bath of paint at the top of them.

   The stairs are the reason this is keys and nothing else. Nothing in the
   building had a top for months and every harness passed the whole time,
   because they all reached past the thing they were testing -- one of them put
   the player on top of a crate by setting their height. So nothing here sets a
   position, a height or a velocity. If the climb can be done here, a person can
   do it; if it cannot, the shop has an upstairs nobody can visit. */
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
const at = () => page.evaluate(() => {
  const st = GWShell.player.state;
  return { x: st.pos.x, z: st.pos.z, y: st.y, grounded: st.grounded };
});

await page.goto('file://' + FILE);
await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 90000 });
await page.click('.titlebtn--primary');
await page.waitForTimeout(400);
const go = await page.$('[data-go]');
if (go) await go.click();
await page.waitForFunction(() => !GWLoading.isOpen(), { timeout: 90000 });
await page.evaluate(() => GWScreens.close(true)).catch(() => {});
await page.waitForTimeout(900);

/* Aim, hold W, let the frame do the rest -- the same steering walk the rest of
   the repository uses. Running, because the lobby is forty metres across and a
   software rasteriser has all night. */
async function walkTo(x, z, seconds) {
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const until = Date.now() + seconds * 1000;
  let closest = Infinity;
  while (Date.now() < until) {
    const d = await page.evaluate((t) => {
      const st = GWShell.player.state;
      const dx = t.x - st.pos.x, dz = t.z - st.pos.z;
      // Aiming is looking, which is a mouse a person has. Nothing here moves
      // the body.
      st.yaw = Math.atan2(-dx, -dz);
      st.viewYaw = st.yaw;
      return Math.hypot(dx, dz);
    }, { x, z });
    closest = Math.min(closest, d);
    if (d < 0.7) break;
    await page.waitForTimeout(110);
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  return closest;
}

/* Where things are, asked of the level rather than worked out from a centre
   and a width. A harness that guesses at the doorway keeps passing after the
   doorway moves. */
const shop = await page.evaluate(() => {
  const f = GWShell.level.shopFront;
  if (!f) return null;
  return { x: f.at.x, z: f.at.z, mezz: f.floor,
           doorX: f.door.x, doorZ: f.door.z,
           stairX: f.stairs.x, stairFoot: f.stairs.foot, stairHead: f.stairs.head,
           mirrorX: f.mirror.x, mirrorZ: f.mirror.plane,
           bathX: f.bath.at.x, bathZ: f.bath.at.z };
});
console.log('\nthere is a shop, and it is a place');
check('the lobby built one', !!shop, shop ? shop.x.toFixed(1) + ',' + shop.z.toFixed(1) : 'none');

const fixtures = await page.evaluate(() => (GWShell.level.anchors || [])
  .filter((a) => a.kind === 'fixture')
  .map((a) => a.action));
check('with a counter and a bath in it',
  fixtures.includes('wardrobe') && fixtures.includes('paint'), fixtures.join(' '));

/* The run starts in the yard, not the lobby: you wake up in a packing crate on
   the wrong side of a concrete partition with one doorway in it. Walking
   straight at the shop from there is walking into that partition, which is
   exactly what a player who did not know the way would do -- so the route goes
   through the door like theirs would. */
console.log('\nyou can get from the crate to the shop');
const SPLIT = -5.0;
await walkTo(SPLIT - 2.5, 0, 12);
await walkTo(SPLIT + 3.0, 0, 8);
const inside = await at();
check('you get through the doorway into the lobby', inside.x > SPLIT + 1,
  'x ' + inside.x.toFixed(1));

console.log('\nyou can walk in and buy something');
// Up to the door, through it, then across to the counter.
await walkTo(shop.doorX, shop.doorZ - 3.0, 16);
await walkTo(shop.doorX, shop.doorZ + 2.6, 8);
await walkTo(shop.x + 2.2, 8.2, 9);
const atTill = await page.waitForFunction(() => {
  const n = GWShell.player.nearest;
  return !!(n && n.anchor && n.anchor.action === 'wardrobe');
}, null, { timeout: 9000 }).then(() => true).catch(() => false);
check('the counter is in reach on foot', atTill);
await page.keyboard.press('KeyE');
await page.waitForTimeout(600);
check('and pressing use opens Nibor’s',
  (await page.evaluate(() => GWScreens.isOpen())) === 'wardrobe',
  String(await page.evaluate(() => GWScreens.isOpen())));
await page.evaluate(() => GWScreens.close(true));
await page.waitForTimeout(400);

/* The stairs. Measured by height off the floor, on foot, with no jump: a
   staircase you have to jump up is a staircase that is really a wall. */
console.log('\nand the stairs go up');
const below = await at();
check('you start on the ground', below.y < 0.4, below.y.toFixed(2) + ' m');
await walkTo(shop.stairX, shop.stairFoot, 10);
await walkTo(shop.stairX, shop.stairHead, 14);
await page.waitForTimeout(900);
const up = await at();
check('and walking them puts you on the mezzanine', up.y > shop.mezz - 0.2,
  up.y.toFixed(2) + ' m of ' + shop.mezz);
check('standing on it, not falling through', up.grounded);

console.log('\nand the mirror has you in it');
await walkTo(shop.mirrorX, shop.mirrorZ - 2.0, 10);
await page.waitForTimeout(700);
const mirror = await page.evaluate(() => {
  if (!GWShell.mirror) return null;
  const g = GWShell.mirror.group;
  const st = GWShell.player.state;
  return { visible: g.visible, x: g.position.x, z: g.position.z,
           me: { x: st.pos.x, z: st.pos.z } };
});
check('there is a reflection', !!mirror, mirror ? '' : 'no mirror body');
check('it is switched on when you are in front of it', !!mirror && mirror.visible);
check('and it stands where your reflection would',
  !!mirror && Math.abs(mirror.x - mirror.me.x) < 0.2,
  mirror ? 'you at x ' + mirror.me.x.toFixed(2) + ', it at ' + mirror.x.toFixed(2) : '');

/* And it has to wear what you wear -- a mirror showing a default body is worse
   than no mirror, because it tells you the hat you just bought did not work. */
const dressed = await page.evaluate(() => {
  const before = GWShell.mirror.wearing.length;
  GWShell.store.meta.worn = Object.assign({}, GWShell.store.meta.worn, { head: 'tophat' });
  GWShell.store.meta.paint = 0x33ff88;
  GWShell.redress();
  return { before, after: GWShell.mirror.wearing.length };
});
check('and wears what the wardrobe put on you',
  dressed.after > 0, dressed.before + ' -> ' + dressed.after + ' worn');

console.log('\nand the bath is up there too');
await walkTo(shop.bathX, shop.bathZ - 2.2, 12);
const atBath = await page.waitForFunction(() => {
  const n = GWShell.player.nearest;
  return !!(n && n.anchor && n.anchor.action === 'paint');
}, null, { timeout: 9000 }).then(() => true).catch(() => false);
check('the bath is in reach from the mezzanine', atBath);
await page.keyboard.press('KeyE');
await page.waitForTimeout(600);
check('and opens the paints',
  (await page.evaluate(() => GWScreens.isOpen())) === 'paint',
  String(await page.evaluate(() => GWScreens.isOpen())));
const bathColour = await page.evaluate(() => {
  GWShell.store.meta.paint = 0xff2288;
  GWShell.redress();
  return GWShell.level.shopFront.bath.mat.color.getHex().toString(16);
});
check('and the paint in it is the colour you chose', bathColour === 'ff2288', bathColour);
await page.evaluate(() => GWScreens.close(true));

console.log('');
for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e);
check('no page or console errors', errors.length === 0, String(errors.length));

await browser.close();
console.log(bad ? '\n' + bad + ' failed' : '\nNibor’s is a shop you can walk into');
process.exitCode = bad ? 1 : 0;
