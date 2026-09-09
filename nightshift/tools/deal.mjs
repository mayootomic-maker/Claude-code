/* Deal ten thousand rounds and check none of them is broken.

   Role assignment is the one moment a round can be ruined without anybody
   noticing: two impostors when the lobby said one, a crew of six where the
   medic that was switched on never appeared, a lobby of four where three of
   them are lying. None of that shows up in a playtest reliably, because it is
   the tail of a distribution. So it is checked here instead, at every player
   count the game allows, against the invariants the rules are supposed to
   guarantee -- and it prints the actual frequencies, so a chance dial set to
   40% can be seen to mean 40%. */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', 'src');
global.window = { NS: {} };
for (const f of ['core/util.js', 'core/config.js', 'world/map.js', 'game/rules.js']) {
  new Function(readFileSync(resolve(src, f), 'utf8'))();
}
const { util: U, config: C, rules: R } = window.NS;

const ROUNDS = 10000;
let failures = 0;
const fail = (why) => { console.log('  FAIL ' + why); failures++; };

for (const count of [4, 5, 6, 7, 8, 9, 10, 12, 14]) {
  const ids = [];
  for (let i = 0; i < count; i++) ids.push('p' + i);

  for (const wanted of [1, 2, 3]) {
    const settings = C.defaults();
    settings.impostors = wanted;
    /* Every optional role on, so the checks see them. */
    for (const key of C.ROLE_SETTINGS) settings.roles[key] = 50;

    const seen = {};
    let worstRatio = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const rand = U.mulberry32(round * 2654435761 + count * 31 + wanted);
      const roles = R.dealRoles(ids, settings, rand);

      if (Object.keys(roles).length !== count) fail('not everybody got a role');

      const teams = { crew: 0, impostor: 0, jester: 0 };
      const used = {};
      for (const id of ids) {
        const role = roles[id];
        if (!C.ROLES[role]) { fail('unknown role ' + role); break; }
        teams[C.ROLES[role].team]++;
        used[role] = (used[role] || 0) + 1;
        seen[role] = (seen[role] || 0) + 1;
      }

      if (teams.impostor < 1) fail('a round with no impostor at ' + count);
      if (teams.impostor > R.impostorCap(count)) fail('over the cap at ' + count);
      if (teams.impostor >= teams.crew + teams.jester) {
        fail('impostors start at or past parity: ' + teams.impostor + ' v ' + (teams.crew + teams.jester) + ' at ' + count);
      }
      /* Every special role is at most one player. Two sheriffs shooting each
         other is a bug report waiting to happen. */
      for (const role of C.CREW_ROLES.concat(C.IMPOSTOR_ROLES, ['jester'])) {
        if ((used[role] || 0) > 1) fail('two of ' + role + ' at ' + count);
      }
      /* And there is always a plain crewmate left, so the crew is never all
         powers. */
      if (!used.crewmate) fail('no plain crewmate left at ' + count);

      worstRatio = Math.max(worstRatio, teams.impostor / count);
    }

    const line = [];
    for (const role of Object.keys(seen).sort()) {
      line.push(role + ' ' + ((seen[role] / ROUNDS) * 100).toFixed(0) + '%');
    }
    console.log(count + ' players, ' + wanted + ' asked for: ' + line.join('  '));
  }
}

/* And the tasks. A player with nothing to do is a player who cannot be told
   apart from an impostor pretending. */
for (const count of [4, 8, 14]) {
  const ids = [];
  for (let i = 0; i < count; i++) ids.push('p' + i);
  const settings = C.defaults();
  const rand = U.mulberry32(7);
  const tasks = R.dealTasks(ids, settings, rand);
  const wanted = settings.commonTasks + settings.shortTasks + settings.longTasks;
  for (const id of ids) {
    if (!tasks[id] || tasks[id].length !== wanted) fail('wrong task count for ' + id);
    const seen = {};
    for (const t of tasks[id]) {
      if (seen[t.sid]) fail('the same task dealt twice to ' + id);
      seen[t.sid] = true;
      if (t.steps < 1) fail('a task with no steps');
    }
  }
  /* Common tasks are the ones you can stand and watch somebody do, so they
     have to be the same for everybody or they are worth nothing. */
  const first = tasks[ids[0]].slice(0, settings.commonTasks).map((t) => t.sid).join(',');
  for (const id of ids) {
    if (tasks[id].slice(0, settings.commonTasks).map((t) => t.sid).join(',') !== first) {
      fail('common tasks differ between players');
    }
  }
}

/* The practice dial. It moves one player and nothing else: the round still
   has the number of impostors the lobby asked for, everybody else is still
   dealt by the shuffle, and a forced crewmate can still draw a crew power --
   which is the difference between preferring a side and being handed a part. */
{
  const ids = [];
  for (let i = 0; i < 9; i++) ids.push('p' + i);
  const settings = C.defaults();
  settings.impostors = 2;
  let asImpostor = 0, asCrew = 0, powered = 0;
  for (let n = 0; n < 4000; n++) {
    const rand = U.mulberry32(n + 1);
    const roles = R.dealRoles(ids, settings, rand, { id: 'p3', team: 'impostor' });
    if (C.ROLES[roles.p3].team === 'impostor') asImpostor++;
    if (Object.keys(roles).filter((id) => C.ROLES[roles[id]].team === 'impostor').length !== 2) {
      fail('the impostor count moved when a role was preferred');
      break;
    }
  }
  for (let n = 0; n < 4000; n++) {
    const rand = U.mulberry32(n + 1);
    const roles = R.dealRoles(ids, settings, rand, { id: 'p3', team: 'crew' });
    if (C.ROLES[roles.p3].team === 'crew') asCrew++;
    if (roles.p3 !== 'crewmate') powered++;
  }
  if (asImpostor !== 4000) fail('asked for impostor, got it ' + asImpostor + '/4000 times');
  if (asCrew !== 4000) fail('asked for crew, got it ' + asCrew + '/4000 times');
  if (powered < 200) fail('a preferred crewmate never draws a crew power');
  console.log('\npractice dial: impostor when asked ' + asImpostor + '/4000, crew when asked '
              + asCrew + '/4000, of which ' + Math.round((powered / 4000) * 100) + '% still drew a power');
}

console.log(failures ? '\n' + failures + ' FAILURES' : '\nall clear: ' + (ROUNDS * 27) + ' deals, every invariant held');
process.exit(failures ? 1 : 0);
