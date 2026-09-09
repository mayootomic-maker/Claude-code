/* Who do the bots actually kill?

   "I get killed every single time" is the kind of complaint that sounds like
   bad luck and usually is not. It was not here: the impostor bots' target
   search walked the host's player table in insertion order, and the person
   who opened the lobby is always the first row in it. Every crewmate standing
   in range was compared against the human *after* the human had already been
   chosen.

   That is invisible in a playtest -- you die, you shrug, you blame variance --
   so it is measured here instead. The station, the host, the pathfinder and
   the bot minds all run headless at a fixed timestep with no renderer, every
   participant is a bot so that every participant behaves identically, and the
   only thing that distinguishes them is where they sit in the player table.
   If position in that table changes your odds of being murdered, this prints
   it. A fair game is a flat histogram. */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', 'src');

global.window = { NS: {} };
global.localStorage = {
  data: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
  setItem(k, v) { this.data[k] = String(v); },
};
for (const f of ['core/util.js', 'core/config.js', 'world/map.js', 'world/los.js',
                 'game/rules.js', 'game/sabotage.js', 'game/minds.js', 'game/world.js',
                 'game/host.js', 'game/bots.js']) {
  new Function(readFileSync(resolve(src, f), 'utf8'))();
}
const NS = window.NS;
/* The two things the world touches that only exist on a screen. */
NS.audio = { play() {}, footstep() {} };
NS.characters = { idle() {} };
/* Roles go out sealed to real players. There is no browser here to do the
   key exchange and no wire for them to travel down, so this is the host's
   own fallback path: no envelope, delivered in the clear to nobody. */
NS.secrets = { sealTo: () => Promise.resolve(null), publicKey: null };

const ROUNDS = Number(process.argv[2] || 200);
const PLAYERS = Number(process.argv[3] || 9);
const IMPOSTORS = Number(process.argv[4] || 2);
const DT = 1 / 30;
const CAP = 600;                // simulated seconds before a round is abandoned

const firstVictim = new Array(PLAYERS).fill(0);
const murdered = new Array(PLAYERS).fill(0);
const ejected = new Array(PLAYERS).fill(0);
const survived = new Array(PLAYERS).fill(0);
const dealtImpostor = new Array(PLAYERS).fill(0);
let rounds = 0, kills = 0, meetings = 0, crewWins = 0, unfinished = 0;
const why = {};
let taskShare = 0, ejectRight = 0, ejectWrong = 0, ejectSkip = 0;
let firstKillAt = 0, firstKills = 0;

/* Seat 0 is the seat the human occupies in a real lobby: added before any bot,
   and therefore first in Object.keys of the player table. */
const seatOf = (id) => Number(id.slice(3));

for (let r = 0; r < ROUNDS; r++) {
  NS.world.reset();
  NS.bots.clear(NS.host);
  const settings = NS.config.defaults();
  settings.impostors = IMPOSTORS;
  settings.discussionTime = 4;
  settings.votingTime = 20;
  settings.soloRole = 'Random';   // no thumb on the scale while measuring
  NS.host.begin({ send() {}, onLocal() {}, settings });
  NS.bots.fill(PLAYERS, NS.host);
  NS.host.start();
  NS.world.placeAtSpawn(NS.host.list());
  NS.bots.resetForRound();

  for (const id of NS.host.list()) {
    if (NS.host.H.roles[id] === 'impostor') dealtImpostor[seatOf(id)]++;
  }

  const gone = new Set();
  let first = null, was = NS.host.H.phase, t = 0;
  while (t < CAP && !NS.host.H.winner) {
    NS.host.tick(DT);
    const phase = NS.host.H.phase;
    if (phase === 'meeting' && was !== 'meeting') meetings++;
    /* Everybody is put back round the table after a meeting; without it the
       bots would resume from wherever the body was found. */
    if (phase === 'play' && (was === 'eject' || was === 'meeting')) {
      NS.world.placeAtSpawn(NS.host.livingIds());
    }
    was = phase;
    for (const id of NS.host.list()) {
      if (NS.host.H.players[id].alive || gone.has(id)) continue;
      gone.add(id);
      const seat = seatOf(id);
      if (NS.host.H.bodies.some((b) => b.id === id) || NS.host.H.ejected === null) {
        murdered[seat]++;
        kills++;
        if (!first) { first = id; firstVictim[seat]++; firstKillAt += t; firstKills++; }
      } else {
        ejected[seat]++;
        if (NS.config.ROLES[NS.host.H.roles[id] || 'crewmate'].team === 'impostor') ejectRight++;
        else ejectWrong++;
      }
    }
    t += DT;
  }
  for (const id of NS.host.list()) if (NS.host.H.players[id].alive) survived[seatOf(id)]++;
  const totals = NS.rules.taskTotals(NS.host.H.tasks, NS.host.H.roles);
  taskShare += totals.total ? totals.done / totals.total : 0;
  if (NS.host.H.winner) why[NS.host.H.winner.team + ': ' + NS.host.H.winner.reason] =
    (why[NS.host.H.winner.team + ': ' + NS.host.H.winner.reason] || 0) + 1;
  if (!NS.host.H.winner) unfinished++;
  else if (NS.host.H.winner.team === 'crew') crewWins++;
  rounds++;
}

const bar = (n, of) => '#'.repeat(Math.round((n / Math.max(1, of)) * 60));
const pct = (n, of) => (of ? ((n / of) * 100).toFixed(1) : '0.0').padStart(5) + '%';

console.log('\n' + rounds + ' rounds, ' + PLAYERS + ' players, ' + IMPOSTORS + ' impostors');
console.log(kills + ' murders, ' + meetings + ' meetings, crew won '
            + pct(crewWins, rounds) + ', ' + unfinished + ' rounds hit the time cap');
console.log('tasks finished at the end: ' + ((taskShare / rounds) * 100).toFixed(0) + '%');
console.log('ejections: ' + ejectRight + ' impostors, ' + ejectWrong + ' innocents');
for (const k of Object.keys(why).sort((a, b) => why[b] - why[a])) console.log('  ' + why[k] + ' x ' + k);
console.log('first murder lands at ' + (firstKillAt / Math.max(1, firstKills)).toFixed(0) + 's\n');

const firstTotal = firstVictim.reduce((a, b) => a + b, 0);
console.log('First victim of the round, by seat in the player table');
console.log('(seat 0 is the seat the person who opened the lobby sits in)\n');
for (let i = 0; i < PLAYERS; i++) {
  console.log('  seat ' + i + ' ' + pct(firstVictim[i], firstTotal) + '  ' + bar(firstVictim[i], firstTotal));
}

console.log('\nHow a seat\'s round ends');
for (let i = 0; i < PLAYERS; i++) {
  console.log('  seat ' + i + '  murdered ' + pct(murdered[i], rounds)
              + '  ejected ' + pct(ejected[i], rounds)
              + '  still standing ' + pct(survived[i], rounds)
              + '  (impostor ' + pct(dealtImpostor[i], rounds) + ')');
}

/* The verdict. With every seat playing identically, a seat's share of the
   murders should sit near 1/(players-impostors). Twice that is not variance
   at these counts, it is the loop preferring somebody. */
const fair = 1 / (PLAYERS - IMPOSTORS);
let worst = 0, worstSeat = 0;
for (let i = 0; i < PLAYERS; i++) {
  const share = firstVictim[i] / Math.max(1, firstTotal);
  if (share > worst) { worst = share; worstSeat = i; }
}
console.log('\nfair share of first murders ' + (fair * 100).toFixed(1)
            + '%, worst seat is ' + worstSeat + ' at ' + (worst * 100).toFixed(1) + '%');
if (worst > fair * 1.9) {
  console.log('FAIL seat ' + worstSeat + ' is hunted');
  process.exit(1);
}
console.log('ok, no seat is hunted');

/* And the practice dial, which is the other half of the same complaint.

   The shuffle is fair and tools/deal.mjs proves it, but fair at nine players
   means impostor one round in nine. The dial is honoured only when one real
   person is in the lobby and everybody else is a bot, so it is checked here
   rather than in deal.mjs: the gate lives in the host, not in the deal. */
function practiceRound(mode) {
  NS.world.reset();
  NS.bots.clear(NS.host);
  const settings = NS.config.defaults();
  settings.soloRole = mode;
  NS.host.begin({ send() {}, onLocal() {}, settings });
  NS.host.addPlayer('me', { n: 'You', c: 13 });
  NS.world.spawnMe('me', { name: 'You', colorIdx: 13, hatIdx: 0 });
  NS.bots.fill(8, NS.host);
  NS.host.start();
  return NS.config.ROLES[NS.host.H.roles.me || 'crewmate'].team;
}

let dialFails = 0;
for (let i = 0; i < 40; i++) {
  if (practiceRound('Impostor') !== 'impostor') dialFails++;
  if (practiceRound('Crewmate') !== 'crew') dialFails++;
}

/* Rotate: crew, crew, and then the deck is not allowed to deal crew again. */
localStorage.data['nightshift.streak'] = JSON.stringify({ team: 'crew', n: 2 });
let rotated = 0;
for (let i = 0; i < 20; i++) {
  localStorage.data['nightshift.streak'] = JSON.stringify({ team: 'crew', n: 2 });
  if (practiceRound('Rotate') === 'impostor') rotated++;
}
if (rotated !== 20) dialFails++;

/* And it stays out of the way of a real lobby: two people, and the dial is
   ignored however it is set. */
NS.world.reset();
NS.bots.clear(NS.host);
const shared = NS.config.defaults();
shared.soloRole = 'Impostor';
NS.host.begin({ send() {}, onLocal() {}, settings: shared });
NS.host.addPlayer('me', { n: 'You', c: 13 });
NS.world.spawnMe('me', { name: 'You', colorIdx: 13, hatIdx: 0 });
NS.host.addPlayer('friend', { n: 'Sam', c: 12 });
NS.world.players.set('friend', NS.world.entity('friend', { name: 'Sam', colorIdx: 12 }));
NS.bots.fill(7, NS.host);
let asImpostor = 0;
for (let i = 0; i < 60; i++) {
  NS.host.H.phase = 'lobby';
  NS.host.start();
  if (NS.config.ROLES[NS.host.H.roles.me || 'crewmate'].team === 'impostor') asImpostor++;
}
if (asImpostor > 30) dialFails++;

console.log('\npractice dial: forced roles ' + (dialFails ? 'FAILED' : 'held')
            + ', rotate turned ' + rotated + '/20 crew streaks into an impostor round, '
            + 'and with a second real player in the lobby it dealt you impostor '
            + asImpostor + '/60 rounds (a fair share is about 7)');
if (dialFails) { console.log('FAIL the practice dial'); process.exit(1); }
