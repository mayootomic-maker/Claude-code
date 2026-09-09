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

  function forget(id, host) {
    NS.world.players.delete(id);
    brains.delete(id);
    if (host && host.H.players[id]) delete host.H.players[id];
  }

  function clear(host) {
    for (const id of Array.from(brains.keys())) forget(id, host);
  }

  /* Adding and removing rather than rebuilding.

     Re-rolling every bot each time somebody pressed + meant a bot that was
     Fern a moment ago was now Ada, while the host's player table still had the
     old name on the old id -- and the deduplicator, doing its job, handed
     somebody "Fern 2". Existing bots keep who they are; only the difference is
     made. */
  function fill(count, host) {
    for (const id of Array.from(brains.keys())) {
      if (Number(id.slice(3)) >= count) forget(id, host);
    }

    const takenNames = {};
    const takenColors = {};
    for (const id of Object.keys(host.H.players)) {
      takenNames[host.H.players[id].name.toLowerCase()] = true;
      takenColors[host.H.players[id].colorIdx] = true;
    }
    const names = NAMES.filter((n) => !takenNames[n.toLowerCase()]);
    const colors = C.COLORS.map((_, i) => i).filter((i) => !takenColors[i]);
    const rand = Math.random;

    for (let i = 0; i < count; i++) {
      const id = 'bot' + i;
      if (brains.has(id)) continue;
      if (!names.length || !colors.length) break;
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
        id, entity, path: null, step: 0, goal: null, order: i,
        busy: 0, think: rand() * 1.5, votes: -1, hold: 0, ventCool: 8 + rand() * 20,
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

  /* The nearest job they still owe, not the first one on the list. Dealing the
     list in order sent every bot down the same corridor at the same moment and
     parked seven of them in Storage, which reads as a bug even though each one
     was behaving correctly on its own. */
  function nextTaskSpot(brain, host) {
    const mine = host.H.tasks[brain.id];
    if (!mine) return null;
    const e = brain.entity;
    let best = null, bestD = Infinity;
    for (const task of mine) {
      if (task.done) continue;
      const station = R.stationById[task.sid];
      if (!station) continue;
      const spot = station.steps ? station.steps[task.step] : station;
      const world = M.toWorld(spot);
      const d = U.dist2(e.x, e.y, world.x, world.y);
      if (d < bestD) { bestD = d; best = { task, world }; }
    }
    return best;
  }

  /* Which broken thing this bot is walking to, if any. Spots are handed out by
     the bot's own index so two of them go to the two reactor pads instead of
     both going to the left one -- a meltdown needs a person at each end, and a
     crew of bots that all queued at the same pad lost every single time. */
  function sabotageTarget(brain, H) {
    const active = H.sabotage;
    if (!active) return null;
    const def = NS.sabotage.SABOTAGES[active.kind];
    if (!def || !def.fix || !def.spots.length) return null;
    const open = [];
    for (let i = 0; i < def.spots.length; i++) {
      if (def.fix !== 'hold' && active.done && active.done[i]) continue;
      open.push(i);
    }
    if (!open.length) return null;
    const index = open[brain.order % open.length];
    const w = M.toWorld(M.SABOTAGE_SPOTS[def.spots[index]]);
    return { index, x: w.x, y: w.y, fix: def.fix, critical: def.critical };
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

      /* A broken station comes before a task list. Only the crew care --
         an impostor bot walking across the map to repair its own sabotage was
         the loudest tell in the game. */
      if (role.team !== 'impostor') {
        const fix = sabotageTarget(brain, H);
        if (fix) {
          const reach = NS.sabotage.REACH * 0.75;
          if (U.dist(e.x, e.y, fix.x, fix.y) < reach) {
            e.moving = false;
            brain.path = null;
            brain.hold -= dt;
            if (brain.hold <= 0) {
              /* A hold decays at the host, so it has to be renewed; a panel is
                 done once, after a pause long enough to look like a person
                 reading it. */
              brain.hold = fix.fix === 'hold' ? 0.5 : 1.6;
              host.handle(brain.id, { t: 'fix', i: fix.index, on: true });
            }
            continue;
          }
          if (!brain.path || !brain.goal || U.dist(brain.goal.x, brain.goal.y, fix.x, fix.y) > 16) {
            repath(brain, fix.x, fix.y);
            brain.hold = fix.fix === 'hold' ? 0 : 1.2;
          }
          advance(brain, dt, speed);
          continue;
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
              escape(brain, host);
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
        /* Impostors walk their fake list too. The host counts nothing for
           them and plays no visual, so the only thing it changes is that they
           are standing where a working crewmate would be standing. */
        const next = nextTaskSpot(brain, host);
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

  /* Leaving through the vent is most of what makes an impostor frightening:
     the body is in Electrical and they were in Navigation. Bots do it when
     there is one to hand, because a killer that always walks away down the
     corridor is a killer you can catch by walking the corridor. */
  function escape(brain, host) {
    const e = brain.entity;
    let best = null, bestD = 150 * 150, group = -1, index = -1;
    M.VENT_GROUPS.forEach((vents, gi) => {
      vents.forEach((v, vi) => {
        const w = M.toWorld(v);
        const d = U.dist2(e.x, e.y, w.x, w.y);
        if (d < bestD) { bestD = d; best = w; group = gi; index = vi; }
      });
    });
    if (!best) return;
    const vents = M.VENT_GROUPS[group];
    const exits = vents.map((_, i) => i).filter((i) => i !== index);
    if (!exits.length) return;
    const exit = exits[Math.floor(Math.random() * exits.length)];
    const out = M.toWorld(vents[exit]);
    e.x = e.tx = out.x;
    e.y = e.ty = out.y;
    brain.path = null;
    brain.goal = null;
    host.handle(brain.id, { t: 'vent', a: 'in', g: group, i: index });
    host.handle(brain.id, { t: 'vent', a: 'out', g: group, i: exit });
  }

  /* ---- meetings ----------------------------------------------------------- */

  function meeting(dt, H) {
    if (!H.meeting || H.meeting.stage !== 'vote') return;
    for (const brain of brains.values()) {
      const p = H.players[brain.id];
      if (!p || !p.alive) continue;
      if (H.meeting.votes[brain.id] !== undefined) continue;
      /* Spread across the time that is actually left. Using the lobby's
         voting time meant a shortened vote closed with most of them still
         thinking about it. */
      if (brain.votes < 0) {
        brain.votes = 2 + Math.random() * Math.max(3, Math.min(22, H.meeting.time * 0.55));
      }
      brain.votes -= dt;
      if (brain.votes > 0) continue;
      brain.votes = -1;

      /* The vote comes out of what the bot saw and what it has heard in the
         meeting -- see game/minds.js. It used to be a coin toss, which made
         the argument decorative. */
      const target = NS.minds ? NS.minds.voteFor(H, brain.id) : 'skip';
      NS.host.handle(brain.id, { t: 'vote', target });
    }
    for (const brain of brains.values()) if (H.meeting.votes[brain.id] !== undefined) brain.votes = -1;
  }

  function resetForRound() {
    for (const brain of brains.values()) {
      brain.path = null; brain.goal = null; brain.busy = 0;
      brain.pending = null; brain.votes = -1; brain.hold = 0;
    }
  }

  NS.bots = { fill, clear, step, meeting, entities, resetForRound, count: () => brains.size };
})(window.NS);
