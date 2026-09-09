/* Watch the bots argue.

   The meeting is the game, and a meeting where nobody says anything is a
   waiting room. This starts a practice round, kills somebody in front of
   witnesses, calls everyone in, and prints what the bots actually said and how
   they voted -- which is the only way to tell whether the reasoning in
   game/minds.js is reasoning or is decoration. */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + resolve(here, '..', 'nightshift.html');
const problems = [];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => problems.push('page error: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts|favicon|ERR_/.test(m.text())) problems.push(m.text()); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.screen--title', { timeout: 20000 });
await page.fill('.field', 'Robin');
await page.click('.btn--quiet');
await page.waitForSelector('.screen--lobby', { timeout: 10000 });
for (let i = 0; i < 6; i++) { await page.click('.bot-row .btn:last-of-type'); await page.waitForTimeout(90); }
await page.click('.lobby-buttons .btn--primary');
await page.waitForSelector('.reveal', { state: 'detached', timeout: 20000 });

/* Let them wander so their memories have something in them. */
await page.waitForTimeout(14000);

const setup = await page.evaluate(() => {
  const H = window.NS.host.H;
  const C = window.NS.config;
  const alive = window.NS.host.livingIds();
  const killer = alive.find((id) => C.ROLES[H.roles[id] || 'crewmate'].kill);
  const victim = alive.find((id) => id !== killer && C.ROLES[H.roles[id] || 'crewmate'].team === 'crew');
  if (!killer || !victim) return null;
  /* Put the killer on the victim and a couple of onlookers in the room, so
     there is something to witness and something to lie about. */
  const k = window.NS.world.players.get(killer);
  const v = window.NS.world.players.get(victim);
  k.x = v.x + 20; k.y = v.y;
  const watchers = alive.filter((id) => id !== killer && id !== victim).slice(0, 2);
  for (let i = 0; i < watchers.length; i++) {
    const w = window.NS.world.players.get(watchers[i]);
    w.x = v.x + 60 + i * 40; w.y = v.y;
  }
  H.killCooldown[killer] = 0;
  window.NS.host.handle(killer, { t: 'kill', target: victim });
  return {
    killer: H.players[killer].name,
    victim: H.players[victim].name,
    watchers: watchers.map((id) => H.players[id].name),
    room: (window.NS.map.roomAt(v.x, v.y) || {}).name,
  };
});

if (!setup) { console.log('no impostor to work with'); await browser.close(); process.exit(1); }
console.log(setup.killer + ' killed ' + setup.victim + ' in ' + setup.room
  + ', watched by ' + setup.watchers.join(' and '));

await page.waitForTimeout(1200);

/* A witness reports it. */
await page.evaluate(() => {
  const H = window.NS.host.H;
  const body = H.bodies[0];
  if (!body) return;
  const finder = window.NS.host.livingIds().find((id) => H.players[id].bot);
  const f = window.NS.world.players.get(finder);
  f.x = body.x; f.y = body.y;
  window.NS.host.handle(finder, { t: 'report', body: body.id });
});

await page.waitForFunction(() => window.NS.world.state.phase === 'meeting', null, { timeout: 10000 });
console.log('\n--- the meeting ---');
await page.waitForTimeout(24000);

const chat = await page.evaluate(() => window.NS.meeting.history.map((m) => (m.system ? '   * ' + m.text : m.name + ': ' + m.text)));
for (const row of chat) console.log('  ' + row);

/* Open the vote and let them decide. */
await page.evaluate(() => {
  const H = window.NS.host.H;
  H.meeting.stage = 'vote';
  H.meeting.time = 18;
  H.dirty = true;
});
await page.waitForFunction(() => window.NS.world.state.phase === 'eject', null, { timeout: 40000 });
const outcome = await page.evaluate(() => {
  const H = window.NS.host.H;
  const e = H.ejected;
  return {
    out: e && e.name, impostor: e && e.impostor, tie: e && e.tie,
    votes: (e && e.votes || []).map(([voter, target]) =>
      (H.players[voter] ? H.players[voter].name : voter) + ' -> '
      + (target === 'skip' ? 'skip' : (H.players[target] ? H.players[target].name : target))),
  };
});
console.log('\n--- the vote ---');
for (const v of outcome.votes) console.log('  ' + v);
console.log('  => ' + (outcome.out ? (outcome.out + (outcome.impostor ? ' (impostor)' : ' (innocent)')) : 'nobody'));
console.log('  the killer was ' + setup.killer);

const spoke = chat.filter((c) => !c.startsWith('   *')).length;
if (spoke < 4) problems.push('the bots barely spoke: ' + spoke + ' lines');

await browser.close();
if (problems.length) { console.log('\nproblems:'); problems.forEach((p) => console.log('  - ' + p)); process.exit(1); }
console.log('\nclean');
