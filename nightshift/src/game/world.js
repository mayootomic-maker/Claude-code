/* Everything this device believes about the station right now.

   Split by who owns what, because getting that wrong is what makes a
   multiplayer game feel broken:

     - **You own your own position.** You walk locally at full frame rate and
       tell everyone where you ended up. Nothing round-trips before you move,
       so the game feels the same on a slow school wifi as on a wire.
     - **The host owns everything that can be argued about.** Who is alive,
       whose task counted, who is on trial. Those arrive as snapshots and this
       file only ever mirrors them -- it never decides one for itself.

   The seam matters: a client that decided locally that its kill landed would
   show a body that the rest of the room does not have. So a kill here is a
   request, and the body appears when the host says it did. */

(function (NS) {
  'use strict';

  const U = NS.util;
  const C = NS.config;
  const M = NS.map;

  const BASE_SPEED = 168;        // px per second at speed 1.0
  const GHOST_BONUS = 1.18;

  const world = {
    me: null,
    players: new Map(),          // id -> entity, real and bot alike
    bodies: [],
    state: {
      phase: 'lobby', seq: 0, settings: C.defaults(),
      tasksDone: 0, tasksTotal: 0, sabotage: null, meeting: null, cameras: false,
      ejected: null, winner: null, closedRooms: [],
    },
    myRole: null,
    myTasks: [],
    hostId: null,
    localAlive: true,
    /* Set while a minigame, the map or a meeting is up: you stop walking but
       the world does not stop moving around you. */
    frozen: false,
  };

  function entity(id, opts) {
    return Object.assign({
      id, name: 'Someone', colorIdx: 0, hatIdx: 0,
      x: 0, y: 0, tx: 0, ty: 0, dir: 1, moving: false, bob: 0, walk: 0,
      alive: true, ghost: false, inVent: false, invisible: false,
      shiftIdx: -1, shielded: false, connected: true, bot: false, isMe: false,
      lastSeen: 0, trail: [],
    }, opts || {});
  }

  function reset() {
    world.players.clear();
    world.bodies.length = 0;
    world.me = null;
    world.myRole = null;
    world.myTasks = [];
    world.state.phase = 'lobby';
    world.state.winner = null;
    world.state.sabotage = null;
    world.state.meeting = null;
    world.state.ejected = null;
    M.clearDoors();
  }

  function spawnMe(id, profile) {
    const spot = M.toWorld(M.SPAWN);
    world.me = entity(id, {
      isMe: true,
      name: profile.name,
      colorIdx: profile.colorIdx,
      hatIdx: profile.hatIdx,
      x: spot.x, y: spot.y, tx: spot.x, ty: spot.y,
    });
    world.players.set(id, world.me);
    return world.me;
  }

  /* Everyone stands in a ring around the emergency table at the start of a
     round and after every meeting. Ordering by id rather than by join order
     means every device puts the same person in the same place, so a screenshot
     of the drop matches on all fourteen screens. */
  function placeAtSpawn(ids) {
    const order = ids.slice().sort();
    const centre = M.toWorld(M.SPAWN);
    order.forEach((id, i) => {
      const p = world.players.get(id);
      if (!p) return;
      const a = (i / Math.max(1, order.length)) * Math.PI * 2 - Math.PI / 2;
      const r = M.SPAWN.radius * M.TILE;
      p.x = p.tx = centre.x + Math.cos(a) * r;
      p.y = p.ty = centre.y + Math.sin(a) * r * 0.72;
      p.dir = Math.cos(a) >= 0 ? 1 : -1;
      p.trail.length = 0;
    });
  }

  /* ---- presence: the compact form of a player ---------------------------- */

  function encode(me) {
    return {
      n: me.name, c: me.colorIdx, h: me.hatIdx,
      x: Math.round(me.x), y: Math.round(me.y),
      d: me.dir, m: me.moving ? 1 : 0,
      v: me.inVent ? 1 : 0, i: me.invisible ? 1 : 0,
      s: me.shiftIdx,
    };
  }

  /* Presence arrives from strangers on a public bus. Every field is clamped
     to something drawable here rather than trusted -- an x of NaN would take
     the camera with it, and a name of ten thousand characters would take the
     frame rate. */
  function adopt(id, raw, isMe) {
    if (!raw || typeof raw !== 'object') return null;
    let p = world.players.get(id);
    if (!p) {
      p = entity(id, { isMe: !!isMe });
      const spot = M.toWorld(M.SPAWN);
      p.x = p.tx = spot.x; p.y = p.ty = spot.y;
      world.players.set(id, p);
    }
    if (p.isMe) return p;        // never let the wire move you
    p.name = U.cleanName(raw.n, C.NAME_MAX) || 'Someone';
    p.colorIdx = U.clamp(raw.c | 0, 0, C.COLORS.length - 1);
    p.hatIdx = U.clamp(raw.h | 0, 0, C.HATS.length - 1);
    const nx = Number(raw.x), ny = Number(raw.y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      p.tx = U.clamp(nx, 0, M.pixelWidth);
      p.ty = U.clamp(ny, 0, M.pixelHeight);
    }
    p.dir = raw.d < 0 ? -1 : 1;
    p.moving = !!raw.m;
    p.inVent = !!raw.v;
    p.invisible = !!raw.i;
    p.shiftIdx = Number.isFinite(raw.s) ? U.clamp(raw.s | 0, -1, C.COLORS.length - 1) : -1;
    p.lastSeen = U.now();
    return p;
  }

  /* Bots ride in the host's own presence rather than in the snapshot: the
     snapshot goes out twice a second, which is fine for who is alive and
     terrible for where somebody is standing. Four numbers each, so a full
     lobby of bots costs about the same as one more player. */
  function encodeBots(bots) {
    return bots.map((b) => [Math.round(b.x), Math.round(b.y), b.dir, b.moving ? 1 : 0]);
  }
  function adoptBots(raw) {
    if (!Array.isArray(raw)) return;
    for (let i = 0; i < raw.length; i++) {
      const row = raw[i];
      if (!Array.isArray(row)) continue;
      const p = world.players.get('bot' + i);
      if (!p || p.isMe) continue;
      const nx = Number(row[0]), ny = Number(row[1]);
      if (Number.isFinite(nx) && Number.isFinite(ny)) {
        p.tx = U.clamp(nx, 0, M.pixelWidth);
        p.ty = U.clamp(ny, 0, M.pixelHeight);
      }
      p.dir = row[2] < 0 ? -1 : 1;
      p.moving = !!row[3];
      p.lastSeen = U.now();
    }
  }

  /* ---- walking ----------------------------------------------------------- */

  function speedFor(p) {
    const s = world.state.settings.playerSpeed * BASE_SPEED;
    return p.ghost ? s * GHOST_BONUS : s;
  }

  function canWalk() {
    const st = world.state;
    if (world.frozen) return false;
    if (st.phase === 'meeting' || st.phase === 'end' || st.phase === 'reveal') return false;
    if (!world.me) return false;
    if (world.me.inVent) return false;
    return true;
  }

  function step(dt, input) {
    const me = world.me;
    if (!me) return;

    if (canWalk() && (input.x || input.y)) {
      const len = Math.hypot(input.x, input.y) || 1;
      const speed = speedFor(me) * dt;
      const dx = (input.x / len) * speed;
      const dy = (input.y / len) * speed;
      /* Ghosts walk through the station; that is the whole compensation for
         being dead, and it is what makes finishing tasks as a ghost bearable. */
      if (me.ghost) {
        me.x = U.clamp(me.x + dx, 8, M.pixelWidth - 8);
        me.y = U.clamp(me.y + dy, 8, M.pixelHeight - 8);
      } else {
        const moved = M.move(me.x, me.y, dx, dy);
        me.x = moved.x;
        me.y = moved.y;
      }
      me.moving = true;
      if (dx > 0.02) me.dir = 1;
      else if (dx < -0.02) me.dir = -1;
      if (!me.ghost && !me.inVent) NS.audio.play('step');
    } else {
      me.moving = false;
    }
    me.tx = me.x; me.ty = me.y;

    /* Everyone else is drawn where they were last heard from, eased rather
       than snapped. Fourteen at ten updates a second is a stutter without
       this, and a rubber band with too much of it. */
    const ease = Math.min(1, dt * 15);
    for (const p of world.players.values()) {
      if (p.isMe) continue;
      const far = U.dist2(p.x, p.y, p.tx, p.ty);
      if (far > 240 * 240) { p.x = p.tx; p.y = p.ty; p.trail.length = 0; }  // vented, ejected, or a meeting
      else { p.x += (p.tx - p.x) * ease; p.y += (p.ty - p.y) * ease; }
    }

    /* Footsteps from everybody else, quieter with distance and deliberately
       not blocked by walls. Hearing somebody you cannot see is most of what a
       dark corridor is for, and both sides of the game get to use it. */
    const EARSHOT = 360;
    const now = U.now();
    for (const p of world.players.values()) {
      p.walk += (p.moving ? dt * 7.5 : 0);
      NS.characters.idle(p, dt, now);
      if (p.isMe || !p.moving || p.ghost || p.inVent || !p.connected) continue;
      p.stepClock = (p.stepClock || 0) + dt;
      if (p.stepClock < 0.27) continue;
      p.stepClock = 0;
      const d = U.dist(me.x, me.y, p.x, p.y);
      if (d < EARSHOT) NS.audio.footstep(1 - d / EARSHOT);
    }
  }

  /* ---- what is within reach --------------------------------------------- */

  const USE_RANGE = 62;

  function myTask(sid) {
    return world.myTasks.find((t) => t.sid === sid && !t.done) || null;
  }

  /* The step of a task you are on decides where it wants you next, so a
     two-stop task shows its console only at the stop you owe. */
  function taskSpot(task) {
    const station = NS.rules.stationById[task.sid];
    if (!station) return null;
    const spot = station.steps ? station.steps[Math.min(task.step, station.steps.length - 1)] : station;
    return M.toWorld(spot);
  }

  function nearestVent() {
    if (!world.me) return null;
    let best = null, bestD = USE_RANGE * USE_RANGE;
    NS.map.VENT_GROUPS.forEach((group, gi) => {
      group.forEach((v, vi) => {
        const w = M.toWorld(v);
        const d = U.dist2(world.me.x, world.me.y, w.x, w.y);
        if (d < bestD) { bestD = d; best = { group: gi, index: vi, x: w.x, y: w.y }; }
      });
    });
    return best;
  }

  function nearestBody() {
    if (!world.me) return null;
    let best = null, bestD = (USE_RANGE + 20) * (USE_RANGE + 20);
    for (const b of world.bodies) {
      const d = U.dist2(world.me.x, world.me.y, b.x, b.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  function killTarget() {
    const me = world.me;
    if (!me || !world.myRole || !C.ROLES[world.myRole].kill) return null;
    if (!me.alive || me.invisible) return null;
    const range = C.KILL_RANGE[world.state.settings.killRange] || C.KILL_RANGE.Normal;
    let best = null, bestD = range * range;
    for (const p of world.players.values()) {
      if (p.isMe || !p.alive || p.ghost || p.inVent) continue;
      if (world.teamOf(p.id) === 'impostor') continue;
      const d = U.dist2(me.x, me.y, p.x, p.y);
      if (d < bestD && NS.los.clear(me.x, me.y, p.x, p.y)) { bestD = d; best = p; }
    }
    return best;
  }

  world.teamOf = function (id) {
    if (world.state.roles && world.state.roles[id]) return C.ROLES[world.state.roles[id]].team;
    if (id === (world.me && world.me.id)) return C.ROLES[world.myRole || 'crewmate'].team;
    return null;
  };

  /* The one contextual action, resolved every frame. Among Us has a fixed set
     of buttons and greys out the ones that do not apply; the same idea, but
     the Use button also has to say what it is about to do, because on a phone
     there is no hover to explain it. */
  function context() {
    const me = world.me;
    const out = { use: null, report: null, kill: null, vent: null, emergency: null, sabotageFix: null };
    if (!me) return out;
    const st = world.state;
    const playing = st.phase === 'play';
    if (!playing) return out;

    if (!me.inVent) {
      for (const task of world.myTasks) {
        if (task.done) continue;
        const spot = taskSpot(task);
        if (!spot) continue;
        if (U.dist2(me.x, me.y, spot.x, spot.y) < USE_RANGE * USE_RANGE) {
          out.use = { kind: 'task', task, station: NS.rules.stationById[task.sid], x: spot.x, y: spot.y };
          break;
        }
      }
      if (!out.use) {
        for (const console of M.CONSOLES) {
          const w = M.toWorld(console);
          if (U.dist2(me.x, me.y, w.x, w.y) < USE_RANGE * USE_RANGE) {
            out.use = { kind: 'console', console, x: w.x, y: w.y };
            break;
          }
        }
      }
      if (!out.use && !me.ghost) {
        const button = M.toWorld(M.EMERGENCY);
        if (U.dist2(me.x, me.y, button.x, button.y) < (USE_RANGE + 16) * (USE_RANGE + 16)) {
          out.emergency = { x: button.x, y: button.y };
        }
      }
      if (!me.ghost) {
        const fix = NS.sabotage.fixAt(me.x, me.y);
        if (fix) out.sabotageFix = fix;
      }
    }

    if (me.alive && !me.ghost) {
      const canVent = world.myRole && (C.ROLES[world.myRole].kill || C.ROLES[world.myRole].ability === 'vent');
      if (canVent) {
        if (me.inVent) out.vent = { kind: 'exit' };
        else {
          const v = nearestVent();
          if (v) out.vent = Object.assign({ kind: 'enter' }, v);
        }
      }
      if (!me.inVent) {
        out.report = nearestBody();
        out.kill = killTarget();
      }
    }
    return out;
  }

  Object.assign(world, {
    entity, reset, spawnMe, placeAtSpawn, encode, adopt, encodeBots, adoptBots,
    step, context, nearestVent, nearestBody, killTarget, myTask, taskSpot,
    speedFor, canWalk, USE_RANGE, BASE_SPEED,
    alivePlayers() {
      const out = [];
      for (const p of world.players.values()) if (p.alive && p.connected) out.push(p);
      return out;
    },
  });

  NS.world = world;
})(window.NS);
