/* The one device that decides.

   Somebody has to be right about whether that kill landed, and it cannot be
   the person who threw it. So one player -- whoever opened the lobby -- runs
   this, and every other device asks it for permission and mirrors what comes
   back. The host is also a player with a game to play, so nothing here is
   allowed to be expensive: it runs inside the same frame loop as the
   renderer, on somebody's phone.

   Positions are the deliberate exception. Clients own their own and the host
   reads them out of the same world mirror everybody else has, roughly a tenth
   of a second stale, which is why kill range is checked with a margin. The
   alternative is a server that rewinds time to validate a hit, and that is a
   very long way to go to stop a fourteen-year-old standing slightly too far
   away from somebody they were going to kill anyway. */

(function (NS) {
  'use strict';

  const U = NS.util;
  const C = NS.config;
  const M = NS.map;
  const R = NS.rules;
  const SAB = NS.sabotage;

  const SNAPSHOT_EVERY = 480;    // ms between full snapshots when nothing changed
  const KILL_GRACE = 1.45;       // how much further than the setting a kill may land
  const EJECT_SECONDS = 5.5;
  const REVEAL_SECONDS = 5;

  const H = {
    active: false, seq: 0, phase: 'lobby',
    settings: C.defaults(),
    players: {}, roles: {}, tasks: {},
    bodies: [], sabotage: null, meeting: null, ejected: null, winner: null,
    killCooldown: {}, abilityCooldown: {}, abilityUsed: {},
    emergenciesUsed: {}, emergencyCooldown: 0, sabotageCooldown: 0,
    shields: {}, invisible: {}, shifted: {}, watching: new Set(),
    closedRooms: {}, revealLeft: 0, ejectLeft: 0, log: [], startedAt: 0,
    lastSnapshot: 0, dirty: true, seed: 1,
  };

  let send = function () {};
  let onLocal = function () {};

  /* ---- lifecycle --------------------------------------------------------- */

  function begin(opts) {
    H.active = true;
    send = opts.send;
    onLocal = opts.onLocal || function () {};
    H.settings = C.sanitise(opts.settings);
    H.phase = 'lobby';
    H.players = {};
    H.seq = 0;
    reset();
    H.dirty = true;
  }

  function reset() {
    H.roles = {}; H.tasks = {}; H.bodies = []; H.sabotage = null;
    H.meeting = null; H.ejected = null; H.winner = null;
    H.killCooldown = {}; H.abilityCooldown = {}; H.abilityUsed = {};
    H.emergenciesUsed = {}; H.emergencyCooldown = 0; H.sabotageCooldown = 0;
    H.shields = {}; H.invisible = {}; H.shifted = {}; H.watching = new Set();
    H.closedRooms = {}; H.log = []; H.startedAt = 0;
    if (NS.minds) NS.minds.reset();
    M.clearDoors();
  }

  function stop() { H.active = false; }

  /* People outrank bots for a colour. A bot holding the shade somebody wants
     would otherwise block the round with a message about a clash the player
     cannot do anything about. */
  function freeBotColour(wanted, botId) {
    const taken = {};
    for (const id of list()) if (id !== botId) taken[H.players[id].colorIdx] = true;
    for (let i = 0; i < C.COLORS.length; i++) if (!taken[i]) return i;
    return wanted;
  }

  function yieldColour(wanted, claimant) {
    for (const id of list()) {
      const other = H.players[id];
      if (id === claimant || !other.bot || other.colorIdx !== wanted) continue;
      other.colorIdx = freeBotColour(wanted, id);
      H.dirty = true;
    }
  }

  /* Two people called Sam is a meeting nobody can hold: half the argument is
     about which Sam. The second one keeps their name with a number on it, and
     their own device tells them so rather than leaving them to notice. */
  function uniqueName(wanted, id) {
    const clean = U.cleanName(wanted, C.NAME_MAX) || 'Someone';
    const taken = (name) => list().some((other) =>
      other !== id && H.players[other].name.toLowerCase() === name.toLowerCase());
    if (!taken(clean)) return clean;
    for (let n = 2; n <= 20; n++) {
      const suffix = ' ' + n;
      const candidate = clean.slice(0, C.NAME_MAX - suffix.length) + suffix;
      if (!taken(candidate)) return candidate;
    }
    return clean;
  }

  function addPlayer(id, info) {
    const existing = H.players[id];
    if (existing) {
      existing.connected = true;
      if (info) {
        if (info.n) existing.name = uniqueName(info.n, id);
        if (Number.isFinite(info.c)) {
          existing.colorIdx = U.clamp(info.c | 0, 0, C.COLORS.length - 1);
          if (!existing.bot) yieldColour(existing.colorIdx, id);
        }
        if (Number.isFinite(info.h)) existing.hatIdx = U.clamp(info.h | 0, 0, C.HATS.length - 1);
        if (info.k) existing.key = String(info.k).slice(0, 200);
      }
      H.dirty = true;
      return existing;
    }
    if (Object.keys(H.players).length >= C.MAX_PLAYERS) return null;
    /* Arriving mid-round used to be a closed door -- the code was right and
       the round was under way, so nothing happened and the join screen sat
       there. Now you come in as a spectator: you can walk the station, watch,
       and talk to the other ghosts, and the next round deals you in. Being
       able to do nothing is a fine outcome; being told nothing is not. */
    const midRound = H.phase !== 'lobby';
    const p = {
      id,
      name: uniqueName(info && info.n, id),
      colorIdx: Number.isFinite(info && info.c) ? U.clamp(info.c | 0, 0, C.COLORS.length - 1) : 0,
      hatIdx: Number.isFinite(info && info.h) ? U.clamp(info.h | 0, 0, C.HATS.length - 1) : 0,
      key: info && info.k ? String(info.k).slice(0, 200) : null,
      alive: !midRound, ghost: midRound, spectator: midRound,
      bot: !!(info && info.bot), connected: true, ready: false,
    };
    if (midRound) {
      /* A crew role with no tasks: counted by nothing, and safe to look up. */
      H.roles[id] = 'crewmate';
      H.tasks[id] = [];
    }
    H.players[id] = p;
    H.dirty = true;
    return p;
  }

  function dropPlayer(id) {
    const p = H.players[id];
    if (!p) return;
    if (H.phase === 'lobby') delete H.players[id];
    else {
      /* Mid-round, a disconnect is a death: the body count has to keep adding
         up or the crew is chasing somebody who is not there. */
      p.connected = false;
      p.alive = false;
      p.ghost = true;
    }
    H.dirty = true;
    checkWin();
  }

  const list = () => Object.keys(H.players);
  const livingIds = () => list().filter((id) => H.players[id].alive && H.players[id].connected);

  /* ---- starting a round --------------------------------------------------- */

  function canStart() {
    const n = list().filter((id) => H.players[id].connected).length;
    if (n < C.MIN_PLAYERS) return 'Needs ' + C.MIN_PLAYERS + ' players. There are ' + n + '.';
    const taken = {};
    for (const id of list()) {
      const c = H.players[id].colorIdx;
      if (taken[c]) return 'Two players picked the same colour.';
      taken[c] = true;
    }
    return null;
  }

  function start() {
    if (H.phase !== 'lobby') return;
    const problem = canStart();
    if (problem) { onLocal({ t: 'refused', why: problem }); return; }

    reset();
    H.seed = (Math.random() * 0x7fffffff) | 0;
    const rand = U.mulberry32(H.seed);
    const ids = list().filter((id) => H.players[id].connected);
    for (const id of ids) {
      H.players[id].alive = true;
      H.players[id].ghost = false;
      H.players[id].spectator = false;
    }
    H.roles = R.dealRoles(ids, H.settings, rand);
    H.tasks = R.dealTasks(ids, H.settings, rand);
    for (const id of ids) H.killCooldown[id] = H.settings.killCooldown + 5;

    H.startedAt = U.now();
    H.phase = 'reveal';
    H.revealLeft = REVEAL_SECONDS;
    H.dirty = true;
    deliverRoles();
    snapshot(true);
  }

  /* Each player's role goes out sealed to them alone -- see net/crypto.js for
     why that is worth doing on a broadcast bus. Bots are told nothing because
     they are the host; their roles are already in H.roles. */
  function deliverRoles() {
    for (const id of list()) {
      const p = H.players[id];
      if (!p.connected || p.bot) continue;
      /* Impostors are told about each other here and nowhere else. It has to
         travel inside the sealed payload: a teammate list in the snapshot
         would be a list of impostors sitting on every device in the room. */
      const mates = C.ROLES[H.roles[id]].team === 'impostor'
        ? list().filter((other) => other !== id
            && C.ROLES[H.roles[other] || 'crewmate'].team === 'impostor')
        : [];
      const payload = { role: H.roles[id], tasks: H.tasks[id], mates };
      NS.secrets.sealTo(p.key, payload).then((sealed) => {
        if (sealed) send('sys', { t: 'R', to: id, s: sealed });
        else send('sys', { t: 'R', to: id, plain: payload, clear: true });
      });
    }
  }

  /* ---- incoming ----------------------------------------------------------- */

  function handle(from, msg) {
    if (!H.active || !msg || typeof msg !== 'object') return;
    const fn = ACTIONS[msg.t];
    if (fn) fn(from, msg);
  }

  const ACTIONS = {
    hello(from, msg) { addPlayer(from, msg); },

    profile(from, msg) {
      const p = H.players[from];
      if (!p || H.phase !== 'lobby') return;
      if (msg.n) p.name = uniqueName(msg.n, from);
      if (Number.isFinite(msg.c)) {
        const wanted = U.clamp(msg.c | 0, 0, C.COLORS.length - 1);
        yieldColour(wanted, from);
        const clash = list().some((id) => id !== from && H.players[id].colorIdx === wanted);
        if (!clash) p.colorIdx = wanted;
      }
      if (Number.isFinite(msg.h)) p.hatIdx = U.clamp(msg.h | 0, 0, C.HATS.length - 1);
      if (msg.k) p.key = String(msg.k).slice(0, 200);
      H.dirty = true;
    },

    ready(from, msg) {
      const p = H.players[from];
      if (!p) return;
      p.ready = !!msg.v;
      H.dirty = true;
    },

    task(from, msg) {
      if (H.phase !== 'play') return;
      const p = H.players[from];
      if (!p || !p.connected) return;
      if (p.ghost && !H.settings.ghostsDoTasks) return;
      const mine = H.tasks[from];
      if (!mine) return;
      const task = mine.find((t) => t.sid === msg.sid && !t.done);
      if (!task) return;
      /* Only the step you are on, and only from where that step happens. A
         client that lost a message would otherwise be able to skip one. */
      if ((msg.step | 0) !== task.step) return;
      const station = R.stationById[task.sid];
      const spot = station.steps ? station.steps[task.step] : station;
      const w = M.toWorld(spot);
      const at = NS.world.players.get(from);
      if (at && !p.bot && U.dist(at.x, at.y, w.x, w.y) > NS.world.USE_RANGE * 2.2) return;

      task.step++;
      if (task.step >= task.steps) task.done = true;
      H.dirty = true;
      /* Only the crew get the animation. A visual task is a task somebody can
         stand and watch you finish, which is worth nothing if the person
         faking it can play the same animation. */
      if (station.visual && H.settings.visualTasks
          && C.ROLES[H.roles[from] || 'crewmate'].team === 'crew') {
        send('sys', { t: 'E', e: 'visual', by: from, sid: task.sid });
      }
      checkWin();
    },

    kill(from, msg) {
      if (H.phase !== 'play') return;
      const killer = H.players[from];
      const victim = H.players[msg.target];
      if (!killer || !victim || !killer.alive || !victim.alive || victim.ghost) return;
      if (!C.ROLES[H.roles[from] || 'crewmate'].kill) return;
      if ((H.killCooldown[from] || 0) > 0) return;
      if (H.invisible[msg.target] || H.invisible[from]) return;
      if (C.ROLES[H.roles[msg.target] || 'crewmate'].team === 'impostor') return;

      const a = NS.world.players.get(from);
      const b = NS.world.players.get(msg.target);
      if (!a || !b) return;
      const range = (C.KILL_RANGE[H.settings.killRange] || C.KILL_RANGE.Normal) * KILL_GRACE;
      if (U.dist(a.x, a.y, b.x, b.y) > range) return;

      H.killCooldown[from] = H.settings.killCooldown;

      if (H.shields[msg.target]) {
        /* The shield is spent, both of them are told, and nobody else is.
           A medic who could see every failed attempt would be a camera. */
        delete H.shields[msg.target];
        send('sys', { t: 'E', e: 'shielded', by: from, target: msg.target, x: b.x, y: b.y });
        H.dirty = true;
        return;
      }
      die(msg.target, from, b.x, b.y, a.x < b.x ? 1 : -1);
    },

    shoot(from) {
      if (H.phase !== 'play') return;
      const sheriff = H.players[from];
      if (!sheriff || !sheriff.alive || H.roles[from] !== 'sheriff') return;
      if ((H.abilityCooldown[from] || 0) > 0) return;
      const a = NS.world.players.get(from);
      if (!a) return;
      const range = C.KILL_RANGE.Long;
      let target = null, best = range * range;
      for (const id of livingIds()) {
        if (id === from) continue;
        const b = NS.world.players.get(id);
        if (!b || H.invisible[id]) continue;
        const d = U.dist2(a.x, a.y, b.x, b.y);
        if (d < best && NS.los.clear(a.x, a.y, b.x, b.y)) { best = d; target = id; }
      }
      if (!target) return;
      H.abilityCooldown[from] = H.settings.killCooldown + 10;
      const hit = NS.world.players.get(target);
      send('sys', { t: 'E', e: 'shot', by: from, target, x: hit.x, y: hit.y });
      /* Shooting a crewmate kills the sheriff instead. It is the only way the
         role is survivable to be around: a sheriff who could fire freely
         would just be a second impostor for the crew to be afraid of. */
      if (C.ROLES[H.roles[target] || 'crewmate'].team === 'impostor') die(target, from, hit.x, hit.y, 0);
      else die(from, from, a.x, a.y, 0);
    },

    shield(from, msg) {
      if (H.phase !== 'play') return;
      if (H.roles[from] !== 'medic' || H.abilityUsed[from]) return;
      const target = H.players[msg.target];
      if (!target || !target.alive) return;
      H.abilityUsed[from] = true;
      H.shields[msg.target] = from;
      H.dirty = true;
      send('sys', { t: 'E', e: 'shield', by: from, target: msg.target });
    },

    ability(from, msg) {
      if (H.phase !== 'play') return;
      const role = H.roles[from];
      const p = H.players[from];
      if (!p || !p.alive || (H.abilityCooldown[from] || 0) > 0) return;
      if (msg.k === 'vanish' && role === 'phantom') {
        H.invisible[from] = 8;
        H.abilityCooldown[from] = 35;
        send('sys', { t: 'E', e: 'vanish', by: from, on: 1 });
      } else if (msg.k === 'shift' && role === 'shapeshifter') {
        const target = H.players[msg.target];
        if (!target || !target.alive) return;
        H.shifted[from] = { as: msg.target, left: 22 };
        H.abilityCooldown[from] = 30;
        send('sys', { t: 'E', e: 'shift', by: from, as: msg.target });
      } else return;
      H.dirty = true;
    },

    vent(from, msg) {
      if (H.phase !== 'play') return;
      const p = H.players[from];
      const role = C.ROLES[H.roles[from] || 'crewmate'];
      if (!p || !p.alive || !(role.kill || role.ability === 'vent')) return;
      const group = M.VENT_GROUPS[msg.g];
      const spot = group && group[msg.i];
      if (spot && NS.minds) {
        const w = M.toWorld(spot);
        NS.minds.witnessVent(H, from, w.x, w.y);
      }
      send('sys', { t: 'E', e: 'vent', by: from, a: msg.a, g: msg.g, i: msg.i });
    },

    report(from, msg) {
      if (H.phase !== 'play') return;
      const p = H.players[from];
      if (!p || !p.alive) return;
      const body = H.bodies.find((b) => b.id === msg.body);
      if (!body) return;
      const at = NS.world.players.get(from);
      if (at && !p.bot && U.dist(at.x, at.y, body.x, body.y) > 140) return;
      openMeeting('body', from, body.id);
    },

    emergency(from) {
      if (H.phase !== 'play') return;
      const p = H.players[from];
      if (!p || !p.alive) return;
      if (H.emergencyCooldown > 0) return;
      if ((H.emergenciesUsed[from] || 0) >= H.settings.emergencies) return;
      if (H.sabotage && SAB.SABOTAGES[H.sabotage.kind].critical) return;
      H.emergenciesUsed[from] = (H.emergenciesUsed[from] || 0) + 1;
      openMeeting('emergency', from, null);
    },

    sabotage(from, msg) {
      if (H.phase !== 'play') return;
      if (!C.ROLES[H.roles[from] || 'crewmate'].kill) return;
      if (H.sabotageCooldown > 0) return;
      if (msg.k === 'doors') {
        const room = M.roomById[msg.room];
        if (!room || M.SEALABLE.indexOf(msg.room) < 0) return;
        if (H.closedRooms[msg.room]) return;
        H.closedRooms[msg.room] = SAB.SABOTAGES.doors.seconds;
        M.sealRoom(msg.room, true);
        H.sabotageCooldown = 10;
        send('sys', { t: 'E', e: 'doors', room: msg.room });
        H.dirty = true;
        return;
      }
      if (H.sabotage) return;
      const def = SAB.SABOTAGES[msg.k];
      if (!def || SAB.MENU.indexOf(msg.k) < 0) return;
      H.sabotage = { kind: msg.k, remaining: def.seconds, done: def.spots.map(() => false), holds: {} };
      record('sabotage', { name: def.name });
      H.sabotageCooldown = 25;
      send('sys', { t: 'E', e: 'sabotage', k: msg.k });
      H.dirty = true;
    },

    fix(from, msg) {
      if (!H.sabotage || H.phase !== 'play') return;
      const def = SAB.SABOTAGES[H.sabotage.kind];
      const i = msg.i | 0;
      if (i < 0 || i >= def.spots.length) return;
      if (def.fix === 'hold') {
        /* Both pads, at the same time. Held is a timestamp that decays, so
           letting go registers even if the "released" message never arrives. */
        H.sabotage.holds[i] = msg.on ? { by: from, at: 1.1 } : null;
      } else {
        H.sabotage.done[i] = true;
      }
      H.dirty = true;
      settleSabotage();
    },

    /* Somebody at the cameras makes every camera on the station blink. It is
       the only reason watching them is fair, so it is authoritative rather
       than drawn locally by the watcher. */
    watching(from, msg) {
      const p = H.players[from];
      if (!p || !p.alive) { H.watching.delete(from); return; }
      if (msg.on) H.watching.add(from); else H.watching.delete(from);
      H.dirty = true;
    },

    vote(from, msg) {
      if (H.phase !== 'meeting' || !H.meeting || H.meeting.stage !== 'vote') return;
      const p = H.players[from];
      if (!p || !p.alive || H.meeting.votes[from] !== undefined) return;
      if (msg.s) {
        NS.secrets.openFrom(p.key, msg.s).then((plain) => {
          if (plain && H.meeting && H.meeting.votes[from] === undefined) {
            recordVote(from, plain.target);
          }
        });
      } else {
        recordVote(from, msg.target);
      }
    },
  };

  function recordVote(from, target) {
    if (!H.meeting || H.meeting.stage !== 'vote') return;
    const valid = target === 'skip' || (H.players[target] && H.players[target].alive);
    H.meeting.votes[from] = valid ? target : 'skip';
    H.dirty = true;
    send('sys', { t: 'E', e: 'voted', by: from });
    const waiting = livingIds().filter((id) => H.meeting.votes[id] === undefined);
    if (!waiting.length) H.meeting.time = Math.min(H.meeting.time, 1.2);
  }

  /* ---- death, meetings, endings ------------------------------------------- */

  /* A short account of the round, kept so the end screen can show what
     actually happened. Everybody spends the last ten minutes arguing from
     fragments; this is the only moment anyone gets to see the whole thing, and
     it is worth more than another leaderboard. Capped, because a long round
     with bots is a lot of lines and this rides in a snapshot. */
  function record(kind, data) {
    if (H.log.length >= 40) return;
    H.log.push(Object.assign({
      k: kind,
      t: Math.max(0, Math.round((U.now() - H.startedAt) / 1000)),
    }, data));
  }

  function roomNameAt(x, y) {
    const room = M.roomAt(x, y);
    return room ? room.name : 'a corridor';
  }

  function die(id, byId, x, y, facing) {
    const p = H.players[id];
    if (!p || !p.alive) return;
    p.alive = false;
    p.ghost = true;
    H.bodies.push({ id, x, y, colorIdx: p.colorIdx, hatIdx: p.hatIdx, by: byId, facing: facing || 0 });
    const killer = H.players[byId];
    record('kill', {
      by: killer ? killer.name : null,
      who: p.name,
      where: roomNameAt(x, y),
      self: byId === id,
    });
    delete H.invisible[id];
    delete H.shifted[id];
    if (NS.minds) NS.minds.witnessKill(H, byId, id, x, y);
    send('sys', { t: 'E', e: 'kill', by: byId, target: id, x, y });
    H.dirty = true;
    checkWin();
  }

  function openMeeting(reason, by, bodyId) {
    if (NS.minds) {
      const found = bodyId && H.bodies.find((b) => b.id === bodyId);
      if (found) NS.minds.noteBody(H, by, found);
    }
    H.sabotage = null;
    for (const roomId in H.closedRooms) M.sealRoom(roomId, false);
    H.closedRooms = {};
    H.bodies = [];
    H.invisible = {};
    H.shifted = {};
    H.phase = 'meeting';
    H.watching.clear();
    H.emergencyCooldown = H.settings.emergencyCooldown;
    H.meeting = {
      reason, by, bodyId,
      stage: H.settings.discussionTime > 0 ? 'discuss' : 'vote',
      time: H.settings.discussionTime > 0 ? H.settings.discussionTime : H.settings.votingTime,
      votes: {},
    };
    if (NS.minds) NS.minds.meetingOpened(H);
    record('meeting', {
      by: H.players[by] ? H.players[by].name : null,
      reason,
      who: bodyId && H.players[bodyId] ? H.players[bodyId].name : null,
    });
    send('sys', { t: 'E', e: 'meeting', reason, by, body: bodyId });
    H.dirty = true;
  }

  function tallyVotes() {
    const counts = {};
    for (const voter in H.meeting.votes) {
      const target = H.meeting.votes[voter];
      counts[target] = (counts[target] || 0) + 1;
    }
    let top = null, topCount = 0, tied = false;
    for (const key in counts) {
      if (counts[key] > topCount) { top = key; topCount = counts[key]; tied = false; }
      else if (counts[key] === topCount) tied = true;
    }
    const ejectedId = (!top || tied || top === 'skip') ? null : top;
    const wasTie = tied && top !== null;

    H.ejected = {
      id: ejectedId,
      name: ejectedId ? H.players[ejectedId].name : null,
      colorIdx: ejectedId ? H.players[ejectedId].colorIdx : 0,
      hatIdx: ejectedId ? H.players[ejectedId].hatIdx : 0,
      impostor: ejectedId ? C.ROLES[H.roles[ejectedId] || 'crewmate'].team === 'impostor' : false,
      role: ejectedId ? H.roles[ejectedId] : null,
      tie: wasTie,
      skipped: top === 'skip',
      votes: Object.keys(H.meeting.votes).map((v) => [v, H.meeting.votes[v]]),
      remaining: 0,
    };

    if (ejectedId) {
      const p = H.players[ejectedId];
      p.alive = false;
      p.ghost = true;
      if (H.roles[ejectedId] === 'jester') {
        H.ejected.remaining = 0;
        H.phase = 'eject';
        H.ejectLeft = EJECT_SECONDS;
        H.winner = { team: 'jester', reason: H.players[ejectedId].name + ' wanted exactly this.', by: ejectedId };
        H.meeting = null;
        H.dirty = true;
        return;
      }
    }
    H.ejected.remaining = list().filter((id) =>
      H.players[id].alive && H.players[id].connected
      && C.ROLES[H.roles[id] || 'crewmate'].team === 'impostor').length;

    record('eject', {
      who: ejectedId ? H.players[ejectedId].name : null,
      impostor: H.ejected.impostor,
      tie: wasTie,
    });

    H.phase = 'eject';
    H.ejectLeft = EJECT_SECONDS;
    H.meeting = null;
    H.dirty = true;
    checkWin();
  }

  function checkWin() {
    if (H.winner || H.phase === 'lobby') return;
    const found = R.winner({ players: H.players, roles: H.roles, tasks: H.tasks });
    if (found) H.winner = found;
  }

  function finish() {
    H.phase = 'end';
    H.meeting = null;
    H.sabotage = null;
    for (const roomId in H.closedRooms) M.sealRoom(roomId, false);
    H.closedRooms = {};
    H.dirty = true;
    snapshot(true);
  }

  function settleSabotage() {
    const active = H.sabotage;
    if (!active) return;
    const def = SAB.SABOTAGES[active.kind];
    let fixed = false;
    if (def.fix === 'hold') {
      fixed = def.spots.every((_, i) => active.holds[i] && active.holds[i].at > 0);
    } else if (def.spots.length) {
      fixed = active.done.every(Boolean);
    }
    if (fixed) {
      H.sabotage = null;
      H.sabotageCooldown = Math.min(H.sabotageCooldown, 12);
      send('sys', { t: 'E', e: 'fixed', k: def.id });
      H.dirty = true;
    }
  }

  /* ---- the clock ---------------------------------------------------------- */

  function tick(dt) {
    if (!H.active) return;

    for (const id in H.killCooldown) if (H.killCooldown[id] > 0) H.killCooldown[id] -= dt;
    for (const id in H.abilityCooldown) if (H.abilityCooldown[id] > 0) H.abilityCooldown[id] -= dt;
    if (H.emergencyCooldown > 0) H.emergencyCooldown -= dt;
    if (H.sabotageCooldown > 0) H.sabotageCooldown -= dt;

    for (const id of Array.from(H.watching)) {
      const watcher = H.players[id];
      if (!watcher || !watcher.alive || !watcher.connected) { H.watching.delete(id); H.dirty = true; }
    }
    for (const id in H.invisible) {
      H.invisible[id] -= dt;
      if (H.invisible[id] <= 0) { delete H.invisible[id]; H.dirty = true; send('sys', { t: 'E', e: 'vanish', by: id, on: 0 }); }
    }
    for (const id in H.shifted) {
      H.shifted[id].left -= dt;
      if (H.shifted[id].left <= 0) { delete H.shifted[id]; H.dirty = true; send('sys', { t: 'E', e: 'shift', by: id, as: null }); }
    }
    for (const roomId in H.closedRooms) {
      H.closedRooms[roomId] -= dt;
      if (H.closedRooms[roomId] <= 0) {
        delete H.closedRooms[roomId];
        M.sealRoom(roomId, false);
        H.dirty = true;
      }
    }

    if (H.phase === 'reveal') {
      H.revealLeft -= dt;
      if (H.revealLeft <= 0) {
        H.phase = 'play';
        H.dirty = true;
        snapshot(true);
      }
    } else if (H.phase === 'play') {
      if (H.sabotage) {
        const def = SAB.SABOTAGES[H.sabotage.kind];
        for (const i in H.sabotage.holds) {
          const hold = H.sabotage.holds[i];
          if (hold) { hold.at -= dt; if (hold.at <= 0) H.sabotage.holds[i] = null; }
        }
        settleSabotage();
        if (H.sabotage && def.critical) {
          H.sabotage.remaining -= dt;
          if (H.sabotage.remaining <= 0) {
            H.winner = { team: 'impostor', reason: def.lose };
          }
        }
      }
      /* Timers above get the real elapsed time so a throttled background tab
         does not slow the round down. Bots get a capped one, because moving
         them a whole second in one step teleports them through walls. */
      if (NS.minds) NS.minds.observe(dt, H);
      if (NS.bots) NS.bots.step(Math.min(dt, 0.1), H);
      if (H.winner) finish();
    } else if (H.phase === 'meeting' && H.meeting) {
      H.meeting.time -= dt;
      if (H.meeting.time <= 0) {
        if (H.meeting.stage === 'discuss') {
          H.meeting.stage = 'vote';
          H.meeting.time = H.settings.votingTime;
          H.dirty = true;
        } else {
          tallyVotes();
        }
      }
      if (NS.bots) NS.bots.meeting(dt, H);
      /* The bots argue. Their lines go out on the ordinary chat channel,
         attributed to the bot rather than to the host's own player. */
      if (NS.minds) {
        NS.minds.speak(dt, H, (botId, text) => {
          send('chat', { t: 'msg', text, as: botId });
        });
      }
    } else if (H.phase === 'eject') {
      H.ejectLeft -= dt;
      if (H.ejectLeft <= 0) {
        if (H.winner) finish();
        else {
          H.phase = 'play';
          H.ejected = null;
          for (const id of livingIds()) H.killCooldown[id] = Math.max(H.killCooldown[id] || 0, 10);
          H.dirty = true;
          snapshot(true);
        }
      }
    }

    const now = U.now();
    if (H.dirty || now - H.lastSnapshot > SNAPSHOT_EVERY) snapshot();
  }

  /* ---- the snapshot ------------------------------------------------------- */

  function snapshot(force) {
    H.lastSnapshot = U.now();
    H.dirty = false;
    H.seq++;
    const totals = R.taskTotals(H.tasks, H.roles);
    const players = list().map((id) => {
      const p = H.players[id];
      let flags = 0;
      if (p.alive) flags |= 1;
      if (p.ghost) flags |= 2;
      if (p.bot) flags |= 4;
      if (!p.connected) flags |= 8;
      if (p.ready) flags |= 16;
      if (H.shields[id]) flags |= 32;
      return [id, p.name, p.colorIdx, p.hatIdx, flags];
    });

    const msg = {
      t: 'S', q: H.seq, ph: H.phase, st: H.settings, pl: players,
      td: totals.done, tt: totals.total,
      sb: H.sabotage ? {
        k: H.sabotage.kind,
        r: Math.max(0, Math.round(H.sabotage.remaining * 10) / 10),
        d: H.sabotage.done,
        h: Object.keys(H.sabotage.holds).filter((i) => H.sabotage.holds[i]).map(Number),
      } : null,
      cd: Object.keys(H.closedRooms),
      bo: H.bodies.map((b) => [b.id, Math.round(b.x), Math.round(b.y), b.colorIdx, b.hatIdx, b.facing]),
      iv: Object.keys(H.invisible),
      cw: H.watching.size ? 1 : 0,
      sh: Object.keys(H.shifted).map((id) => [id, H.shifted[id].as]),
      mt: H.meeting ? {
        r: H.meeting.reason, by: H.meeting.by, bd: H.meeting.bodyId,
        s: H.meeting.stage, t: Math.max(0, Math.round(H.meeting.time * 10) / 10),
        vd: Object.keys(H.meeting.votes),
      } : null,
      ej: H.ejected,
      wn: H.winner ? {
        tm: H.winner.team, rs: H.winner.reason,
        rl: list().map((id) => [id, H.roles[id] || 'crewmate']),
        lg: H.log,
      } : null,
      rv: H.phase === 'reveal' ? Math.max(0, Math.round(H.revealLeft * 10) / 10) : 0,
    };
    send('sys', msg);
    if (force) H.dirty = false;
  }

  /* What the host's own client needs that never goes on the wire: cooldowns
     are per player and only ever shown to that player, so they ride the local
     path instead of thirteen other people's snapshots. */
  function localExtras(id) {
    return {
      kill: Math.max(0, H.killCooldown[id] || 0),
      ability: Math.max(0, H.abilityCooldown[id] || 0),
      abilityUsed: !!H.abilityUsed[id],
      emergencies: H.settings.emergencies - (H.emergenciesUsed[id] || 0),
      emergencyCooldown: Math.max(0, H.emergencyCooldown),
      sabotageCooldown: Math.max(0, H.sabotageCooldown),
    };
  }

  NS.host = {
    H, begin, stop, start, tick, handle, addPlayer, dropPlayer, snapshot,
    canStart, localExtras, die, list, livingIds,
    setSettings(s) { H.settings = C.sanitise(s); H.dirty = true; },
    get phase() { return H.phase; },
  };
})(window.NS);
