/* Drive the built game in a real browser and photograph it.

   Unit tests pass happily on code that renders a black rectangle. This opens
   the same file a player opens, plays a practice round through every screen
   the game has, and fails on any console error or page error along the way. */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = 'file://' + resolve(here, '..', 'nightshift.html');
const shots = resolve(here, '..', 'shots');
mkdirSync(shots, { recursive: true });

const PHONE = process.argv.includes('--phone');
const size = PHONE ? { width: 402, height: 874 } : { width: 1280, height: 800 };
const prefix = PHONE ? 'phone-' : '';

const problems = [];
let step = 0;

async function shot(page, name) {
  step++;
  const file = resolve(shots, prefix + String(step).padStart(2, '0') + '-' + name + '.png');
  await page.screenshot({ path: file });
  console.log('  shot ' + name);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({ viewport: size, deviceScaleFactor: 2, hasTouch: PHONE, isMobile: PHONE });
const page = await context.newPage();

page.on('console', (m) => {
  if (m.type() !== 'error' && m.type() !== 'warning') return;
  const text = m.text();
  /* The font host is unreachable in this container by design, and a file://
     page has no favicon. Neither is the game's problem. */
  if (/fonts\.googleapis|favicon|ERR_/.test(text)) return;
  problems.push('console ' + m.type() + ': ' + text);
});
page.on('pageerror', (e) => problems.push('page error: ' + e.message + '\n' + (e.stack || '')));

console.log('opening ' + file);
await page.goto(file, { waitUntil: 'load' });
await page.waitForSelector('.screen--title', { timeout: 20000 });
await page.waitForTimeout(1400);
await shot(page, 'title');

/* A name, a colour and a hat, then straight into practice. */
await page.fill('.field', 'Robin');
await page.click('.swatch:nth-child(3)');
await page.click('.hat-btn:nth-child(4)');
await page.waitForTimeout(250);
await shot(page, 'dressed');

await page.evaluate(() => window.NS.screens.showHelp());
await page.waitForTimeout(400);
await shot(page, 'help');
await page.evaluate(() => { const sheet = document.querySelector('.sheet'); if (sheet) sheet.remove(); });

await page.click('.btn--quiet');
await page.waitForSelector('.screen--lobby', { timeout: 10000 });
await page.waitForTimeout(700);
await shot(page, 'lobby');

/* More bots, so a round has enough people for the roles to matter. */
for (let i = 0; i < 5; i++) {
  await page.click('.bot-row .btn:last-of-type');
  await page.waitForTimeout(120);
}
await page.waitForTimeout(400);
await shot(page, 'lobby-full');

await page.click('.lobby-buttons .btn--primary');
await page.waitForSelector('.reveal', { timeout: 10000 });
await page.waitForTimeout(900);
await shot(page, 'reveal');

const role = await page.evaluate(() => window.NS.world.myRole);
console.log('  dealt role: ' + role);

await page.waitForSelector('.reveal', { state: 'detached', timeout: 15000 });
await page.waitForTimeout(700);
await shot(page, 'play');

/* Walk for a moment so the camera, the animation and the light all move. */
await page.keyboard.down('KeyD');
await page.waitForTimeout(900);
await page.keyboard.up('KeyD');
await page.keyboard.down('KeyS');
await page.waitForTimeout(700);
await page.keyboard.up('KeyS');
await shot(page, 'walked');

await page.evaluate(() => window.NS.hud.showTasks());
await page.waitForTimeout(400);
await shot(page, 'tasklist');
await page.evaluate(() => window.NS.hud.closeOverlay());

await page.evaluate(() => window.NS.hud.showMap(false));
await page.waitForTimeout(500);
await shot(page, 'map');
await page.evaluate(() => window.NS.hud.closeOverlay());

for (const panel of ['showAdmin', 'showCameras', 'showVitals']) {
  await page.evaluate((fn) => window.NS.hud[fn](), panel);
  await page.waitForTimeout(700);
  await shot(page, panel.replace('show', '').toLowerCase());
  await page.evaluate(() => window.NS.hud.closeOverlay());
  await page.waitForTimeout(120);
}

/* Every minigame, opened directly. Walking to twenty-one consoles would be a
   test of the pathfinder, not of the panels. */
const kinds = ['wiring', 'swipe', 'calibrate', 'shields', 'chart', 'steering', 'filter',
               'manifold', 'telescope', 'temperature', 'asteroids', 'diagnose', 'signal',
               'reactor', 'sample', 'divert', 'fuel', 'lightsFix', 'codeFix', 'tuneFix'];
for (const kind of kinds) {
  await page.evaluate((k) => window.NS.minigames.start(k, {}), kind);
  await page.waitForTimeout(320);
  await shot(page, 'task-' + kind);
  await page.evaluate(() => window.NS.minigames.close(true));
  await page.waitForTimeout(90);
}

/* The half-size station the fallback allocates on a device that will not give
   us thirty megabytes of canvas. Everything that blits it has to map the
   source rectangle through that scale, and getting one of them wrong shows up
   as a station in the wrong place rather than as an error. */
await page.evaluate(() => window.NS.station.rebuild(0.6));
await page.waitForTimeout(700);
await shot(page, 'half-scale-station');
const halfScale = await page.evaluate(() => window.NS.station.scale);
if (halfScale !== 0.6) problems.push('the station fallback did not take: scale ' + halfScale);
await page.evaluate(() => window.NS.hud.showCameras());
await page.waitForTimeout(600);
await shot(page, 'half-scale-cameras');
await page.evaluate(() => window.NS.hud.closeOverlay());
await page.evaluate(() => window.NS.station.rebuild());
await page.waitForTimeout(600);

await page.evaluate(() => window.NS.hud.showOptions());
await page.waitForTimeout(400);
await shot(page, 'options');
await page.evaluate(() => window.NS.hud.closeOverlay());

/* A meeting, a vote, an ejection. The bots are playing the whole time this
   runs and can be mid-meeting of their own when we ask for one, so wait for a
   phase we can actually act from rather than assuming. */
/* A bot may have called a meeting while the screenshots were being taken, and
   a full discussion plus vote outlasts any sane wait. Cut it short rather than
   race it: what is being tested next is the meeting we ask for. */
await page.evaluate(() => {
  const H = window.NS.host.H;
  /* Both, not just the clock: running the discussion out only opens the vote,
     which is the game working and the harness waiting another ninety seconds. */
  if (H.meeting) { H.meeting.stage = 'vote'; H.meeting.time = 0.2; H.dirty = true; }
});
try {
  await page.waitForFunction(() => window.NS.world.state.phase === 'play', null, { timeout: 45000 });
} catch (e) {
  console.log('  stuck: ' + await page.evaluate(() => JSON.stringify({
    phase: window.NS.world.state.phase,
    hostPhase: window.NS.host.H.phase,
    winner: window.NS.host.H.winner,
    meeting: window.NS.host.H.meeting && { s: window.NS.host.H.meeting.stage, t: Math.round(window.NS.host.H.meeting.time) },
    alive: window.NS.host.livingIds().length,
    players: window.NS.host.list().length,
    td: window.NS.world.state.tasksDone, tt: window.NS.world.state.tasksTotal,
  })));
  throw e;
}
/* A reactor meltdown ends the round in forty-five seconds unless two people
   put a hand on a pad at each end of the map. Crew bots ignored it entirely at
   first, which made a bot game unwinnable and looked like nothing at all --
   the round simply ended. Broken on purpose here, and the fix is measured. */
const impostor = await page.evaluate(() => {
  const H = window.NS.host.H;
  return Object.keys(H.roles).find((id) => window.NS.config.ROLES[H.roles[id]].kill
    && H.players[id] && H.players[id].alive) || null;
});
if (impostor) {
  await page.evaluate((id) => {
    const H = window.NS.host.H;
    H.sabotageCooldown = 0;
    window.NS.host.handle(id, { t: 'sabotage', k: 'reactor' });
  }, impostor);
  await page.waitForTimeout(600);
  const started = await page.evaluate(() => !!window.NS.world.state.sabotage);
  if (!started) problems.push('the reactor sabotage would not start');
  else {
    await shot(page, 'meltdown');
    try {
      await page.waitForFunction(() => !window.NS.world.state.sabotage
        || window.NS.world.state.phase !== 'play', null, { timeout: 44000 });
    } catch (e) { /* falls through to the check below */ }
    const fixed = await page.evaluate(() => ({
      sabotage: window.NS.world.state.sabotage,
      phase: window.NS.world.state.phase,
    }));
    if (fixed.sabotage) problems.push('the bots never repaired the reactor');
    else if (fixed.phase !== 'play') problems.push('the reactor ended the round: ' + fixed.phase);
    else console.log('  the bots repaired the reactor');
  }
}

/* The bots have been playing this whole time and may well have killed us,
   which is the game working. Photograph being dead, then stand back up so the
   meeting screens can be driven from a living player. */
if (await page.evaluate(() => !window.NS.world.me.alive)) {
  await shot(page, 'ghost');
  await page.evaluate(() => {
    const H = window.NS.host.H;
    const me = H.players[window.NS.session.myId];
    me.alive = true;
    me.ghost = false;
    H.bodies = H.bodies.filter((b) => b.id !== window.NS.session.myId);
    H.dirty = true;
  });
  await page.waitForTimeout(700);
}

await page.evaluate(() => {
  /* A meeting the bots called during the screenshots leaves the emergency
     button on cooldown, which is the game behaving correctly and the harness
     needing to say what it wants. Clear it and ask again. */
  const H = window.NS.host.H;
  H.emergencyCooldown = 0;
  H.emergenciesUsed = {};
  window.NS.host.handle(window.NS.session.myId, { t: 'emergency' });
});
await page.waitForTimeout(300);
if (await page.evaluate(() => window.NS.world.state.phase !== 'meeting')) {
  problems.push('the emergency meeting was refused: '
    + await page.evaluate(() => JSON.stringify({
      phase: window.NS.host.H.phase,
      alive: window.NS.host.H.players[window.NS.session.myId].alive,
      cooldown: window.NS.host.H.emergencyCooldown,
    })));
}
await page.waitForSelector('.meeting', { timeout: 10000 });
await page.waitForTimeout(900);
await shot(page, 'meeting-discussion');

await page.evaluate(() => {
  window.NS.host.H.meeting.stage = 'vote';
  window.NS.host.H.meeting.time = 12;
  window.NS.host.H.dirty = true;
});
await page.waitForTimeout(700);

/* On a narrow screen the chat is behind a tab, exactly as a player finds it. */
const chatTab = await page.$('.meeting-tabs .tab:nth-child(2)');
if (chatTab && await chatTab.isVisible()) { await chatTab.click(); await page.waitForTimeout(300); }

await page.fill('.chat-input', 'Reactor, on my own, nothing to report');
await page.click('.chat-send');
await page.waitForTimeout(400);
await page.click('.chip:nth-child(2)');
await page.waitForTimeout(400);
await shot(page, 'meeting-chat');

const crewTab = await page.$('.meeting-tabs .tab:nth-child(1)');
if (crewTab && await crewTab.isVisible()) { await crewTab.click(); await page.waitForTimeout(300); }
await shot(page, 'meeting-vote');

const votable = await page.$$('.vote-row:not(.is-dead) .vote-btn:not([disabled])');
if (votable.length) { await votable[0].click(); await page.waitForTimeout(500); }
await shot(page, 'meeting-voted');

await page.waitForSelector('.eject', { timeout: 30000 });
await page.waitForTimeout(1600);
await shot(page, 'eject');

await page.waitForTimeout(5000);
await shot(page, 'after-meeting');

/* Force an ending so the last screen is covered too. */
await page.evaluate(() => {
  const H = window.NS.host.H;
  H.winner = { team: 'crew', reason: 'Every impostor is gone.' };
  H.phase = 'end';
  H.dirty = true;
});
await page.waitForSelector('.screen--end', { timeout: 10000 });
await page.waitForTimeout(800);
await shot(page, 'end');

const recap = await page.$('.recap-wrap');
if (!recap) problems.push('the end screen showed no round recap');
else {
  await recap.evaluate((node) => { node.open = true; });
  await page.waitForTimeout(400);
  await shot(page, 'end-recap');
}

await browser.close();

if (problems.length) {
  console.log('\nFAILED with ' + problems.length + ' problem(s):');
  for (const p of problems.slice(0, 12)) console.log('\n' + p);
  process.exit(1);
}
console.log('\nclean: no console errors, no page errors, ' + step + ' screens photographed');
