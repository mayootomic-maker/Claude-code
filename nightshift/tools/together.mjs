/* Two players, two tabs, the real networked code.

   Everything the solo drive covers runs on one device where the host and the
   player are the same person, which is exactly the half of the game least
   likely to be wrong. This runs the other half: one tab hosts, another joins
   with a code, and the round is played across the seam -- presence, snapshots,
   the sealed role delivery, a task counted on one device and read on the
   other, and a vote cast on one and tallied on the other.

   It uses the same-computer transport so it needs no network, but every layer
   above that transport is the one a class would be using. */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + resolve(here, '..', 'nightshift.html') + '#local';

const problems = [];
let checks = 0;
function check(ok, what) {
  checks++;
  console.log((ok ? '  ok   ' : '  FAIL ') + what);
  if (!ok) problems.push(what);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });

function watch(page, who) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/fonts\.googleapis|favicon|ERR_/.test(t)) return;
    problems.push(who + ' console: ' + t);
  });
  page.on('pageerror', (e) => problems.push(who + ' page error: ' + e.message));
}

const host = await context.newPage();
watch(host, 'host');
const guest = await context.newPage();
watch(guest, 'guest');

async function arrive(page, name) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('.screen--title', { timeout: 20000 });
  await page.fill('.field', name);
}

await arrive(host, 'Ada');
await arrive(guest, 'Bo');

await host.click('.btn--primary.btn--big');
await host.waitForSelector('.screen--lobby', { timeout: 10000 });
const code = (await host.textContent('.code strong')).trim();
console.log('host opened lobby ' + code);
check(/^[A-Z0-9]{4}$/.test(code), 'the code is four readable characters');

await guest.fill('.field--code', code);
await guest.click('.join-row .btn--ghost');
await guest.waitForSelector('.screen--lobby', { timeout: 10000 });
await guest.waitForTimeout(1600);

const hostSeesGuest = await host.evaluate(() =>
  Array.from(window.NS.world.players.values()).some((p) => p.name === 'Bo'));
const guestSeesHost = await guest.evaluate(() =>
  Array.from(window.NS.world.players.values()).some((p) => p.name === 'Ada'));
check(hostSeesGuest, 'the host sees the guest arrive');
check(guestSeesHost, 'the guest sees the host');

/* Two bots so the round has the four players the rules require. */
for (let i = 0; i < 2; i++) { await host.click('.bot-row .btn:last-of-type'); await host.waitForTimeout(150); }
await host.waitForTimeout(900);

const guestSeesBots = await guest.evaluate(() => window.NS.world.players.size);
check(guestSeesBots >= 4, 'the guest sees the host\'s bots (' + guestSeesBots + ' players)');

/* The guest's settings must follow the host's, since only the host has the
   sliders and everyone has to be playing the same game. */
await host.evaluate(() => window.NS.host.setSettings(
  Object.assign({}, window.NS.host.H.settings, { killCooldown: 42 })));
await host.waitForTimeout(900);
const guestCooldown = await guest.evaluate(() => window.NS.world.state.settings.killCooldown);
check(guestCooldown === 42, 'settings changed by the host reach the guest (' + guestCooldown + 's)');

const blocked = await host.evaluate(() => window.NS.host.canStart());
check(!blocked, 'nothing blocks the start: ' + (blocked || 'ready'));
await host.click('.lobby-buttons .btn--primary');
await host.waitForSelector('.reveal', { timeout: 10000 });
await guest.waitForSelector('.reveal', { timeout: 10000 });
check(true, 'both devices start the round together');

const roles = await Promise.all([
  host.evaluate(() => window.NS.world.myRole),
  guest.evaluate(() => window.NS.world.myRole),
]);
console.log('  host is ' + roles[0] + ', guest is ' + roles[1]);
check(!!roles[0] && !!roles[1], 'both were dealt a role');
check(!!(await guest.evaluate(() => window.NS.secrets.available)), 'the guest could use real encryption');

/* The sealed role must not be readable off the wire. Nothing but the host's
   own table should ever have carried the guest's role in the clear. */
const leak = await guest.evaluate(() => {
  const state = window.NS.world.state;
  const known = Object.keys(state.roles || {});
  return known.filter((id) => id !== window.NS.session.myId);
});
check(roles[1] === 'crewmate' ? leak.length === 0 : true,
  'a crewmate guest learns nobody else\'s role');

const guestTasks = await guest.evaluate(() => window.NS.world.myTasks.length);
check(guestTasks > 0, 'the guest was dealt ' + guestTasks + ' tasks');

await host.waitForSelector('.reveal', { state: 'detached', timeout: 15000 });
await guest.waitForTimeout(600);

/* Presence: the guest walks, and the host has to see it move. */
const before = await host.evaluate(() => {
  const p = Array.from(window.NS.world.players.values()).find((q) => q.name === 'Bo');
  return p ? Math.round(p.x) : null;
});
await guest.keyboard.down('KeyA');
await guest.waitForTimeout(1300);
await guest.keyboard.up('KeyA');
await host.waitForTimeout(700);
const after = await host.evaluate(() => {
  const p = Array.from(window.NS.world.players.values()).find((q) => q.name === 'Bo');
  return p ? Math.round(p.x) : null;
});
check(before !== null && after !== null && Math.abs(after - before) > 20,
  'the host watches the guest walk (' + before + ' -> ' + after + ')');

/* A task finished on the guest has to move the bar on the host. */
const barBefore = await host.evaluate(() => window.NS.host.H ? window.NS.world.state.tasksDone : -1);
const counted = await guest.evaluate(() => {
  const task = window.NS.world.myTasks.find((t) => !t.done);
  if (!task) return false;
  const spot = window.NS.world.taskSpot(task);
  window.NS.world.me.x = spot.x;
  window.NS.world.me.y = spot.y;
  return { sid: task.sid, step: task.step };
});
if (counted) {
  await guest.waitForTimeout(400);
  await guest.evaluate((t) => window.NS.session.link.send('act', { t: 'task', sid: t.sid, step: t.step }), counted);
  await host.waitForTimeout(1200);
}
const barAfter = await host.evaluate(() => window.NS.world.state.tasksDone);
check(!counted || barAfter > barBefore || roles[1] !== 'crewmate',
  'a task done on the guest counts on the host (' + barBefore + ' -> ' + barAfter + ')');

/* A meeting on the host, a vote on the guest, tallied on the host. */
await host.evaluate(() => {
  const H = window.NS.host.H;
  H.emergencyCooldown = 0;
  H.emergenciesUsed = {};
  window.NS.host.handle(window.NS.session.myId, { t: 'emergency' });
});
await guest.waitForSelector('.meeting', { timeout: 10000 });
check(true, 'the meeting opens on the guest too');

await host.evaluate(() => {
  const H = window.NS.host.H;
  H.meeting.stage = 'vote';
  H.meeting.time = 40;
  H.dirty = true;
});
await guest.waitForTimeout(900);

const guestAlive = await guest.evaluate(() => !!(window.NS.world.me && window.NS.world.me.alive));
if (guestAlive) {
  const button = await guest.$('.vote-row--skip .vote-btn:not([disabled])');
  check(!!button, 'the guest\'s vote buttons unlock when voting opens');
  if (button) {
    await button.click();
    await host.waitForTimeout(1500);
    const tally = await host.evaluate(() => {
      const m = window.NS.host.H.meeting;
      return m ? Object.keys(m.votes).length : -1;
    });
    check(tally > 0, 'the guest\'s sealed vote reached the host and was opened');
  }
} else {
  console.log('  (the guest was killed before the vote; skipping the vote check)');
}

/* The host tab is not the focused one while all of the above runs, so this
   whole file is also a standing check that a backgrounded host keeps the round
   alive. It did not, once: the game was on requestAnimationFrame, which a
   hidden tab stops. Measured explicitly here so it cannot come back. */
const seqBefore = await host.evaluate(() => window.NS.host.H.seq);
await guest.bringToFront();
await guest.waitForTimeout(2500);
const seqAfter = await host.evaluate(() => window.NS.host.H.seq);
check(seqAfter - seqBefore > 3,
  'a host in a background tab keeps running (' + (seqAfter - seqBefore) + ' snapshots in 2.5s)');

await host.screenshot({ path: resolve(here, '..', 'shots', 'two-host.png') });

/* And the thing that used to be silence: the host closes their tab. The round
   cannot continue -- the new host would know nobody's role -- but the guest has
   to be told, and has to end up somewhere they can play again rather than
   frozen in a meeting whose clock has stopped. */
await host.close();
await guest.waitForFunction(
  () => window.NS.world.state.phase === 'lobby' && window.NS.session.isHost,
  null, { timeout: 25000 },
).then(() => check(true, 'losing the host drops the guest into a lobby they now host'))
  .catch(async () => {
    check(false, 'the guest was left stranded when the host closed: '
      + await guest.evaluate(() => JSON.stringify({
        phase: window.NS.world.state.phase, isHost: window.NS.session.isHost,
      })));
  });
await guest.waitForTimeout(600);
await guest.screenshot({ path: resolve(here, '..', 'shots', 'two-handover.png') });
await browser.close();

if (problems.length) {
  console.log('\n' + problems.length + ' problem(s):');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log('\nclean: ' + checks + ' checks across two devices, no console or page errors');
