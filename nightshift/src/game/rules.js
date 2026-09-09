/* Who you are, what you have to do, and when it is over.

   Pure functions on purpose. Dealing roles is the one moment a round can be
   ruined without anybody noticing -- two impostors when the lobby said one,
   a crew of six where nobody got the medic that was switched on -- and the
   only way to be sure is to be able to run the deal ten thousand times
   outside the game. Everything here takes a seeded RNG and returns a plain
   object, so tools/deal.mjs can do exactly that. */

(function (NS) {
  'use strict';

  const U = NS.util;
  const C = NS.config;
  const STATIONS = NS.map.STATIONS;

  const stationById = {};
  for (const s of STATIONS) stationById[s.id] = s;

  const stepsOf = (station) => (station.steps ? station.steps.length : 1);

  /* How many impostors this many players can actually take. Two impostors
     against three crew is not a game, it is a coin toss, so the lobby's
     number is capped rather than obeyed. */
  function impostorCap(playerCount) {
    if (playerCount >= 9) return 3;
    if (playerCount >= 7) return 2;
    return 1;
  }

  /* One player, one role. Chance settings are per-role percentages: a role at
     0 never appears, at 100 always does if there is somebody to take it. Each
     special role is handed out at most once, because two sheriffs shooting
     each other is a bug report waiting to happen. */
  function dealRoles(playerIds, settings, rand, prefer) {
    let ids = U.shuffle(playerIds, rand);
    const impostorCount = Math.min(
      Math.max(1, settings.impostors),
      impostorCap(ids.length),
      Math.max(1, Math.floor((ids.length - 1) / 2)));

    /* One player may be moved to the side they asked for -- practice against
       bots, and nowhere else; the host decides whether that is allowed and
       this only carries it out. It is a move within the shuffle rather than an
       assignment on top of it: dropped at a random index inside the half it
       belongs to, so a forced crewmate can still be the medic or the jester,
       and everybody else's roles are still dealt by the same deck. */
    if (prefer && ids.indexOf(prefer.id) >= 0) {
      const rest = ids.filter((id) => id !== prefer.id);
      const at = prefer.team === 'impostor'
        ? Math.floor(rand() * impostorCount)
        : impostorCount + Math.floor(rand() * (rest.length + 1 - impostorCount));
      rest.splice(at, 0, prefer.id);
      ids = rest;
    }

    const roles = {};
    const impostors = ids.slice(0, impostorCount);
    const crew = ids.slice(impostorCount);

    for (const id of impostors) roles[id] = 'impostor';
    for (const id of crew) roles[id] = 'crewmate';

    /* The jester is taken out of the crew before the crew roles are handed
       out, so it can never land on the same player as the medic. */
    let pool = crew.slice();
    if (settings.roles.jester > 0 && pool.length > 2 && rand() * 100 < settings.roles.jester) {
      roles[pool[0]] = 'jester';
      pool = pool.slice(1);
    }

    for (const role of C.IMPOSTOR_ROLES) {
      const chance = settings.roles[role] || 0;
      if (chance <= 0) continue;
      const plain = impostors.filter((id) => roles[id] === 'impostor');
      if (!plain.length) break;
      if (rand() * 100 < chance) roles[U.pick(plain, rand)] = role;
    }

    for (const role of C.CREW_ROLES) {
      const chance = settings.roles[role] || 0;
      if (chance <= 0) continue;
      const plain = pool.filter((id) => roles[id] === 'crewmate');
      /* Always leave one plain crewmate. A round where every single crew
         member has a power is a different game, and not this one. */
      if (plain.length <= 1) break;
      if (rand() * 100 < chance) roles[U.pick(plain, rand)] = role;
    }

    return roles;
  }

  /* Tasks. Everybody gets the same common tasks -- that is what makes them
     useful, since you can stand next to somebody and watch them do it -- and
     their own draw of short and long ones. */
  function dealTasks(playerIds, settings, rand) {
    const byType = { common: [], short: [], long: [] };
    for (const s of STATIONS) byType[s.type].push(s);

    const common = U.shuffle(byType.common, rand).slice(0, settings.commonTasks);
    const out = {};
    for (const id of playerIds) {
      const shorts = U.shuffle(byType.short, rand).slice(0, settings.shortTasks);
      const longs = U.shuffle(byType.long, rand).slice(0, settings.longTasks);
      out[id] = common.concat(shorts, longs).map((s) => ({
        sid: s.id, step: 0, steps: stepsOf(s), done: false,
      }));
    }
    return out;
  }

  /* The bar counts crew work only. An impostor's list is real enough to walk
     to and stand at -- that is the point of faking -- but finishing it moves
     nothing, and a jester finishing theirs would be helping the people they
     are trying to lose to. */
  function countable(roles) {
    return Object.keys(roles).filter((id) => C.ROLES[roles[id]].team === 'crew');
  }

  function taskTotals(tasks, roles) {
    let total = 0, done = 0;
    for (const id of countable(roles)) {
      for (const t of (tasks[id] || [])) {
        total += t.steps;
        done += Math.min(t.step, t.steps);
      }
    }
    return { total, done };
  }

  /* Called after every death, ejection and completed task. Returns null while
     the round is still live. */
  function winner(state) {
    const alive = [];
    for (const id in state.players) {
      const p = state.players[id];
      if (p.alive && p.connected) alive.push(id);
    }
    const team = (id) => C.ROLES[state.roles[id] || 'crewmate'].team;
    const impostors = alive.filter((id) => team(id) === 'impostor');
    const others = alive.filter((id) => team(id) !== 'impostor');

    if (!impostors.length) return { team: 'crew', reason: 'Every impostor is gone.' };

    const totals = taskTotals(state.tasks, state.roles);
    if (totals.total > 0 && totals.done >= totals.total) {
      return { team: 'crew', reason: 'The crew finished every task.' };
    }
    if (impostors.length >= others.length) {
      return { team: 'impostor', reason: 'The impostors outnumber the crew.' };
    }
    return null;
  }

  NS.rules = {
    stationById, stepsOf, impostorCap, dealRoles, dealTasks, taskTotals, winner, countable,
  };
})(window.NS);
