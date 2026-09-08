/* Somebody to play against when there is nobody to play against.

   These exist for two reasons and neither is a demo. One player opening the
   page should get a game rather than an empty station, and a class of nine
   who want three impostors should be able to have them. So bots are real
   participants: they are in the host's player table, they are dealt roles
   from the same shuffle, they can be voted out, and they can win.

   They are not clever and are not trying to be. A bot walks to its tasks,
   stands at them for as long as the task would take a person, and reports a
   body it can actually see. An impostor bot kills when it is alone with
   somebody, which is the one behaviour that makes the game work -- a bot that
   killed in front of witnesses would be found instantly and a bot that never
   killed would never be found at all. What they cannot do is lie in the
   meeting, and the game does not pretend otherwise: their votes are visibly
   simple, and the lobby says these are practice bots. */

(function (NS) {
  'use strict';

  const U = NS.util;
  const C = NS.config;
  const M = NS.map;
  const R = NS.rules;

  const NAMES = ['Ada', 'Bo', 'Cass', 'Dev', 'Eli', 'Fern', 'Gus', 'Hana', 'Ike',
                 'Jo', 'Kit', 'Lex', 'Mo', 'Nia', 'Ozz', 'Pim', 'Rae', 'Sol', 'Tam', 'Vic'];

  const brains = new Map();

  function clear() {
    for (const id of brains.keys()) NS.world.players.delete(id);
    brains.clear();
  }

  /* Bots take the colours and names nobody else has, so a lobby never shows
     two Cass or two Cobalt. */
  function fill(count, host) {
    clear();
    const takenNames = {};
    const takenColors = {};
    for (const id of Object.keys(host.H.players)) {
      /* Only the people. The bots from the last fill were just cleared, and
         counting their colours as taken shrank the pool every time somebody
         pressed the + button. */
      if (host.H.players[id].bot) continue;
      takenNames[host.H.players[id].name.toLowerCase()] = true;
      takenColors[host.H.players[id].colorIdx] = true;
    }
    const names = NAMES.filter((n) => !takenNames[n.toLowerCase()]);
    const colors = C.COLORS.map((_, i) => i).filter((i) => !takenColors[i]);
    const rand = Math.random;

    for (let i = 0; i < count; i++) {
      if (!names.length || !colors.length) break;
      const id = 'bot' + i;
      const name = names.splice(Math.floor(rand() * names.length), 1)[0];
      const colorIdx = colors.splice(Math.floor(rand() * colors.length), 1)[0];
      host.addPlayer(id, { n: name, c: colorIdx, h: Math.floor(rand() * C.HATS.length), bot: true });
      const spot = M.toWorld(M.SPAWN);
      const entity = NS.world.entity(id, {
        name, colorIdx, hatIdx: host.H.players[id].hatIdx, bot: true,
        x: spot.x, y: spot.y, tx: spot.x, ty: spot.y,
      });
      NS.world.players.set(id, entity);
      brains.set(id, {
        id, entity, path: null, step: 0, goal: null,
        busy: 0, think: rand() * 1.5, votes: -1, panic: 0, ventCool: 8 + rand() * 20,
      });
    }
    return brains.size;
  }

  const entities = () => Array.from(brains.values()).map((b) => b.entity);

  /* ---- moving ------------------------------------------------------------- */

  function repath(brain, x, y) {
    const found = M.path(brain.entity.x, brain.entity.y, x, y);
    brain.path = found;
    brain.step = 0;
    brain.goal = { x, y };
  }

  /* String-pulling: rather than walk the tile centres one by one, look ahead
     for the furthest waypoint still in a straight line and head for that. Grid
     paths without it read as a bot, which for once is the thing to avoid. */
  function advance(brain, dt, speed) {
    const e = brain.entity;
    if (!brain.path || brain.step >= brain.path.length) { e.moving = false; return true; }
    let target = brain.path[brain.step];
    for (let i = Math.min(brain.path.length - 1, brain.step + 10); i > brain.step; i--) {
      if (NS.los.clear(e.x, e.y, brain.path[i].x, brain.path[i].y)) { brain.step = i; target = brain.path[i]; break; }
    }
    const dx = target.x - e.x, dy = target.y - e.y;
    const len = Math.hypot(dx, dy);
    if (len < 9) { brain.step++; return brain.step >= brain.path.length; }
    const move = Math.min(len, speed * dt);
    const moved = M.move(e.x, e.y, (dx / len) * move, (dy / len) * move);
    if (Math.abs(moved.x - e.x) < 0.01 && Math.abs(moved.y - e.y) < 0.01) {
      /* Wedged on a corner. Throw the path away rather than vibrate: the next
         think tick will pick a new one. */
      brain.path = null;
      return true;
    }
    e.x = moved.x; e.y = moved.y;
    if (dx > 1) e.dir = 1; else if (dx < -1) e.dir = -1;
    e.moving = true;
    e.tx = e.x; e.ty = e.y;
    return false;
  }

  /* ---- deciding ----------------------------------------------------------- */

  function alone(brain, host, exceptId) {
    const e = brain.entity;
    for (const id of host.livingIds()) {
      if (id === brain.id || id === exceptId) continue;
      const other = NS.world.players.get(id);
      if (!other) continue;
      if (U.dist2(e.x, e.y, other.x, other.y) < 420 * 420 && NS.los.clear(e.x, e.y, other.x, other.y)) return false;
    }
    return true;
  }

  function nextTaskSpot(brain, host) {
    const mine = host.H.tasks[brain.id];
    if (!mine) return null;
    const task = mine.find((t) => !t.done);
    if (!task) return null;
    const station = R.stationById[task.sid];
    const spot = station.steps ? station.steps[task.step] : station;
    return { task, world: M.toWorld(spot) };
  }

  function wander(brain) {
    const room = NS.util.pick(M.ROOMS, Math.random);
    repath(brain, room.cx + (Math.random() - 0.5) * 80, room.cy + (Math.random() - 0.5) * 80);
  }

  function step(dt, H) {
    const host = NS.host;
    if (H.phase !== 'play') {
      for (const brain of brains.values()) brain.entity.moving = false;
      return;
    }
    const speed = H.settings.playerSpeed * NS.world.BASE_SPEED * 0.94;

    for (const brain of brains.values()) {
      const p = H.players[brain.id];
      if (!p) continue;
      const e = brain.entity;
      e.alive = p.alive;
      e.ghost = p.ghost;
      if (!p.alive) { e.moving = false; continue; }

      if (brain.busy > 0) {
        brain.busy -= dt;
        e.moving = false;
        if (brain.busy <= 0 && brain.pending) {
          host.handle(brain.id, brain.pending);
          brain.pending = null;
        }
        continue;
      }

      const role = C.ROLES[H.roles[brain.id] || 'crewmate'];

      /* A body in the open gets reported. Crew only -- an impostor bot walking
         past its own work and calling a meeting was the single most obvious
         tell in testing. */
      if (role.team !== 'impostor') {
        for (const body of H.bodies) {
          if (U.dist2(e.x, e.y, body.x, body.y) < 200 * 200 && NS.los.clear(e.x, e.y, body.x, body.y)) {
            repath(brain, body.x, body.y);
            if (U.dist(e.x, e.y, body.x, body.y) < 90) {
              brain.busy = 0.5 + Math.random() * 0.8;
              brain.pending = { t: 'report', body: body.id };
            }
            break;
          }
        }
      }

      if (role.kill) {
        brain.ventCool -= dt;
        const cooldown = H.killCooldown[brain.id] || 0;
        if (cooldown <= 0) {
          const range = (C.KILL_RANGE[H.settings.killRange] || 108) * 0.9;
          for (const id of host.livingIds()) {
            if (id === brain.id) continue;
            if (C.ROLES[H.roles[id] || 'crewmate'].team === 'impostor') continue;
            const other = NS.world.players.get(id);
            if (!other) continue;
            if (U.dist2(e.x, e.y, other.x, other.y) < range * range
                && NS.los.clear(e.x, e.y, other.x, other.y) && alone(brain, host, id)) {
              host.handle(brain.id, { t: 'kill', target: id });
              brain.busy = 0.8;
              brain.path = null;
              break;
            }
          }
        }
        /* Sabotage on a timer rather than a plan. It moves the crew around,
           which is most of what sabotage is for. */
        if (!H.sabotage && H.sabotageCooldown <= 0 && Math.random() < dt * 0.05) {
          host.handle(brain.id, { t: 'sabotage', k: U.pick(NS.sabotage.MENU, Math.random) });
        }
      }

      if (!brain.path || brain.step >= (brain.path ? brain.path.length : 0)) {
        const next = role.team === 'crew' ? nextTaskSpot(brain, host) : null;
        if (next) {
          if (U.dist(e.x, e.y, next.world.x, next.world.y) < 40) {
            /* Standing at the console for as long as it would take a person,
               so watching a bot do a task tells you what watching a player
               doing that task looks like. */
            brain.busy = 2 + Math.random() * 3;
            brain.pending = { t: 'task', sid: next.task.sid, step: next.task.step };
            brain.path = null;
          } else if (!brain.goal || U.dist(brain.goal.x, brain.goal.y, next.world.x, next.world.y) > 12) {
            repath(brain, next.world.x, next.world.y);
          } else wander(brain);
        } else wander(brain);
      }

      advance(brain, dt, speed);
    }
  }

  /* ---- meetings ----------------------------------------------------------- */

  function meeting(dt, H) {
    if (!H.meeting || H.meeting.stage !== 'vote') return;
    for (const brain of brains.values()) {
      const p = H.players[brain.id];
      if (!p || !p.alive) continue;
      if (H.meeting.votes[brain.id] !== undefined) continue;
      if (brain.votes < 0) brain.votes = 3 + Math.random() * (H.settings.votingTime * 0.5);
      brain.votes -= dt;
      if (brain.votes > 0) continue;
      brain.votes = -1;

      const alive = NS.host.livingIds().filter((id) => id !== brain.id);
      const mine = C.ROLES[H.roles[brain.id] || 'crewmate'].team;
      let target = 'skip';
      if (mine === 'impostor') {
        const crew = alive.filter((id) => C.ROLES[H.roles[id] || 'crewmate'].team !== 'impostor');
        /* Vote with the room where possible: whoever already has votes on
           them. It is not deduction, but it stops impostor bots from handing
           themselves in by voting alone. */
        const counts = {};
        for (const v in H.meeting.votes) counts[H.meeting.votes[v]] = (counts[H.meeting.votes[v]] || 0) + 1;
        crew.sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
        if (crew.length) target = counts[crew[0]] ? crew[0] : U.pick(crew, Math.random);
      } else if (H.meeting.reason === 'body' && alive.length && Math.random() < 0.55) {
        target = U.pick(alive, Math.random);
      }
      NS.host.handle(brain.id, { t: 'vote', target });
    }
    for (const brain of brains.values()) if (H.meeting.votes[brain.id] !== undefined) brain.votes = -1;
  }

  function resetForRound() {
    for (const brain of brains.values()) {
      brain.path = null; brain.goal = null; brain.busy = 0;
      brain.pending = null; brain.votes = -1;
    }
  }

  NS.bots = { fill, clear, step, meeting, entities, resetForRound, count: () => brains.size };
})(window.NS);
