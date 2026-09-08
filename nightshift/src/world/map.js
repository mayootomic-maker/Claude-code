/* Aurora-7.

   The station is authored as rectangles -- rooms and the corridors between
   them -- and rasterised into a tile grid at load. Rectangles are what a
   person can reason about while tuning a layout ("weapons is too far from
   navigation"); a tile grid is what collision, line of sight and the bots'
   pathfinding all want. Doing both means neither is hand-maintained.

   Corridors deliberately overlap the rooms they join by two tiles. That
   overlap is not slop: the intersection of a corridor and a room IS the
   doorway, computed below rather than placed by hand, which is why the door
   sabotage can seal any room without anybody having authored a door for it. */

(function (NS) {
  'use strict';

  const TILE = 32;
  const W = 112;
  const H = 66;

  /* `tone` picks the floor treatment the renderer draws; `dark` marks rooms
     the station never lit properly, which is where the vision setting bites
     hardest and where people go to be alone with somebody. */
  const ROOMS = [
    { id: 'reactor',     name: 'Reactor',        x: 4,  y: 20, w: 14, h: 16, tone: 'hot' },
    { id: 'upperEngine', name: 'Upper Engine',   x: 20, y: 8,  w: 14, h: 11, tone: 'hot' },
    { id: 'lowerEngine', name: 'Lower Engine',   x: 20, y: 42, w: 14, h: 11, tone: 'hot' },
    { id: 'security',    name: 'Security',       x: 22, y: 25, w: 10, h: 8,  tone: 'cold', dark: true },
    { id: 'medbay',      name: 'MedBay',         x: 38, y: 12, w: 13, h: 11, tone: 'clean' },
    { id: 'electrical',  name: 'Electrical',     x: 38, y: 38, w: 14, h: 12, tone: 'hot',  dark: true },
    { id: 'cafeteria',   name: 'Cafeteria',      x: 56, y: 6,  w: 20, h: 17, tone: 'clean' },
    { id: 'storage',     name: 'Storage',        x: 56, y: 36, w: 16, h: 16, tone: 'plain' },
    { id: 'admin',       name: 'Admin',          x: 76, y: 30, w: 13, h: 10, tone: 'cold' },
    { id: 'weapons',     name: 'Weapons',        x: 84, y: 8,  w: 13, h: 10, tone: 'cold' },
    { id: 'o2',          name: 'O2',             x: 80, y: 20, w: 9,  h: 8,  tone: 'clean' },
    { id: 'navigation',  name: 'Navigation',     x: 98, y: 22, w: 10, h: 12, tone: 'cold' },
    { id: 'shields',     name: 'Shields',        x: 80, y: 46, w: 13, h: 10, tone: 'cold' },
    { id: 'comms',       name: 'Communications', x: 58, y: 54, w: 12, h: 8,  tone: 'plain', dark: true },
  ];

  const HALLS = [
    { x: 16, y: 26, w: 8,  h: 4 },   // reactor  - security
    { x: 24, y: 17, w: 4,  h: 10 },  // upper engine - security
    { x: 24, y: 31, w: 4,  h: 13 },  // security - lower engine
    { x: 32, y: 13, w: 8,  h: 4 },   // upper engine - medbay
    { x: 49, y: 13, w: 9,  h: 4 },   // medbay - cafeteria
    { x: 32, y: 44, w: 8,  h: 4 },   // lower engine - electrical
    { x: 50, y: 42, w: 8,  h: 4 },   // electrical - storage
    { x: 62, y: 21, w: 4,  h: 17 },  // cafeteria - storage (the long spine)
    { x: 74, y: 10, w: 12, h: 4 },   // cafeteria - weapons
    { x: 64, y: 30, w: 14, h: 4 },   // spine - admin
    { x: 83, y: 15, w: 4,  h: 7 },   // weapons - o2
    { x: 87, y: 24, w: 13, h: 4 },   // o2 - navigation
    { x: 100, y: 32, w: 4, h: 18 },  // navigation - south run
    { x: 91, y: 48, w: 12, h: 4 },   // south run - shields
    { x: 84, y: 38, w: 4,  h: 10 },  // admin - shields
    { x: 70, y: 47, w: 12, h: 4 },   // storage - shields
    { x: 62, y: 50, w: 4,  h: 6 },   // storage - comms
    { x: 8,  y: 30, w: 4,  h: 16 },  // west spine, lower
    { x: 8,  y: 44, w: 14, h: 4 },   // west spine - lower engine
    { x: 8,  y: 12, w: 4,  h: 10 },  // west spine, upper
    { x: 8,  y: 12, w: 14, h: 4 },   // west spine - upper engine
  ];

  /* Where the work is. `kind` picks the minigame; `type` decides which pile
     the task is dealt from. A task with two spots is done in two visits --
     fuel is carried from storage to an engine, and the walk between them is
     the point of a long task. */
  const STATIONS = [
    { id: 'wiring1',   kind: 'wiring',      type: 'common', name: 'Fix Wiring',            room: 'electrical', tx: 39, ty: 40 },
    { id: 'wiring2',   kind: 'wiring',      type: 'common', name: 'Fix Wiring',            room: 'cafeteria',  tx: 57, ty: 8 },
    { id: 'wiring3',   kind: 'wiring',      type: 'common', name: 'Fix Wiring',            room: 'security',   tx: 30, ty: 27 },
    { id: 'wiring4',   kind: 'wiring',      type: 'common', name: 'Fix Wiring',            room: 'navigation', tx: 99, ty: 31 },
    { id: 'wiring5',   kind: 'wiring',      type: 'common', name: 'Fix Wiring',            room: 'storage',    tx: 57, ty: 50 },
    { id: 'swipe',     kind: 'swipe',       type: 'common', name: 'Swipe Card',            room: 'admin',      tx: 86, ty: 32 },

    { id: 'calibrate', kind: 'calibrate',   type: 'short',  name: 'Calibrate Distributor', room: 'electrical', tx: 49, ty: 47 },
    { id: 'shieldsT',  kind: 'shields',     type: 'short',  name: 'Prime Shields',         room: 'shields',    tx: 90, ty: 53, visual: true },
    { id: 'chart',     kind: 'chart',       type: 'short',  name: 'Chart Course',          room: 'navigation', tx: 105, ty: 24 },
    { id: 'steering',  kind: 'steering',    type: 'short',  name: 'Stabilise Steering',    room: 'navigation', tx: 99, ty: 24 },
    { id: 'filter',    kind: 'filter',      type: 'short',  name: 'Clean O2 Filter',       room: 'o2',         tx: 81, ty: 26, visual: true },
    { id: 'manifold',  kind: 'manifold',    type: 'short',  name: 'Unlock Manifolds',      room: 'reactor',    tx: 6,  ty: 22 },
    { id: 'telescope', kind: 'telescope',   type: 'short',  name: 'Align Telescope',       room: 'weapons',    tx: 95, ty: 15 },
    { id: 'tempHot',   kind: 'temperature', type: 'short',  name: 'Record Temperature',    room: 'medbay',     tx: 49, ty: 21, arg: 'cold' },
    { id: 'tempCold',  kind: 'temperature', type: 'short',  name: 'Record Temperature',    room: 'upperEngine',tx: 21, ty: 16, arg: 'hot' },
    { id: 'asteroids', kind: 'asteroids',   type: 'short',  name: 'Clear Asteroids',       room: 'weapons',    tx: 86, ty: 10, visual: true },
    { id: 'diagnose',  kind: 'diagnose',    type: 'short',  name: 'Run Diagnostics',       room: 'security',   tx: 24, ty: 31 },
    { id: 'signal',    kind: 'signal',      type: 'short',  name: 'Boost Signal',          room: 'comms',      tx: 67, ty: 59, visual: true },
    { id: 'garbageC',  kind: 'garbage',     type: 'short',  name: 'Empty Garbage',         room: 'cafeteria',  tx: 74, ty: 20 },

    { id: 'reactorT',  kind: 'reactor',     type: 'long',   name: 'Start Reactor',         room: 'reactor',    tx: 12, ty: 28 },
    { id: 'sample',    kind: 'sample',      type: 'long',   name: 'Inspect Sample',        room: 'medbay',     tx: 40, ty: 15 },
    { id: 'scan',      kind: 'scan',        type: 'long',   name: 'Submit Scan',           room: 'medbay',     tx: 45, ty: 20, visual: true },
    { id: 'fuel',      kind: 'fuel',        type: 'long',   name: 'Fuel Engines',          room: 'storage',    tx: 69, ty: 39,
      steps: [{ room: 'storage', tx: 69, ty: 39, verb: 'Fill the can' },
              { room: 'upperEngine', tx: 31, ty: 11, verb: 'Fill upper engine' },
              { room: 'storage', tx: 69, ty: 39, verb: 'Fill the can' },
              { room: 'lowerEngine', tx: 31, ty: 50, verb: 'Fill lower engine' }] },
    { id: 'divert',    kind: 'divert',      type: 'long',   name: 'Divert Power',          room: 'electrical', tx: 44, ty: 48,
      steps: [{ room: 'electrical', tx: 44, ty: 48, verb: 'Divert the power' },
              { room: 'navigation', tx: 102, ty: 32, verb: 'Accept diverted power' }] },
    { id: 'trash',     kind: 'chute',       type: 'long',   name: 'Empty Chute',           room: 'storage',    tx: 60, ty: 50, visual: true,
      steps: [{ room: 'cafeteria', tx: 74, ty: 20, verb: 'Empty the cafeteria bin' },
              { room: 'storage', tx: 60, ty: 50, verb: 'Open the chute' }] },
  ];

  /* Vent networks. Each group is a ring you can move around from inside.
     Their shape is the impostor's whole map knowledge -- which rooms are two
     seconds apart when everybody else thinks they are thirty. */
  const VENT_GROUPS = [
    [{ room: 'reactor', tx: 6, ty: 33 }, { room: 'upperEngine', tx: 32, ty: 10 }, { room: 'lowerEngine', tx: 32, ty: 51 }],
    [{ room: 'electrical', tx: 40, ty: 48 }, { room: 'medbay', tx: 39, ty: 13 }, { room: 'security', tx: 23, ty: 31 }],
    [{ room: 'cafeteria', tx: 58, ty: 20 }, { room: 'admin', tx: 77, ty: 38 }],
    [{ room: 'weapons', tx: 95, ty: 9 }, { room: 'navigation', tx: 106, ty: 32 }, { room: 'shields', tx: 91, ty: 47 }],
    [{ room: 'storage', tx: 57, ty: 37 }, { room: 'comms', tx: 59, ty: 60 }, { room: 'o2', tx: 87, ty: 21 }],
  ];

  /* Fixed points the sabotages hang off. Reactor and O2 need two people at
     once, which is the only thing in the game that cannot be solved alone. */
  const SABOTAGE_SPOTS = {
    reactorLeft:  { room: 'reactor', tx: 5,  ty: 27 },
    reactorRight: { room: 'reactor', tx: 16, ty: 27 },
    o2Left:       { room: 'o2', tx: 87, ty: 26 },
    o2Right:      { room: 'admin', tx: 78, ty: 32 },
    lights:       { room: 'electrical', tx: 50, ty: 40 },
    comms:        { room: 'comms', tx: 60, ty: 56 },
  };

  const EMERGENCY = { room: 'cafeteria', tx: 66, ty: 14 };
  const SPAWN = { tx: 66, ty: 14, radius: 3.4 };

  /* ---- rasterising ------------------------------------------------------ */

  const FLOOR = new Uint8Array(W * H);      // 1 where you may stand
  const ROOM_AT = new Int8Array(W * H).fill(-1);
  const at = (tx, ty) => ty * W + tx;

  function fill(rect, roomIndex) {
    const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
    const x1 = Math.min(W, rect.x + rect.w), y1 = Math.min(H, rect.y + rect.h);
    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        FLOOR[at(tx, ty)] = 1;
        if (roomIndex >= 0) ROOM_AT[at(tx, ty)] = roomIndex;
      }
    }
  }

  HALLS.forEach((h) => fill(h, -1));
  ROOMS.forEach((r, i) => fill(r, i));

  /* A doorway is where a corridor crosses a room's edge. Intersecting every
     corridor with every room finds all of them, in the right places, without
     anybody typing a door coordinate. */
  const DOORS = {};
  function intersect(a, b) {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
  }
  for (const room of ROOMS) {
    const doors = [];
    for (const hall of HALLS) {
      const hit = intersect(hall, room);
      if (!hit) continue;
      /* Only the mouth counts. A corridor that runs deep into a room (the
         spine clips the corner of security) would otherwise seal half of it. */
      if (hit.w > 6 && hit.h > 6) continue;
      doors.push(hit);
    }
    if (doors.length) DOORS[room.id] = doors;
  }

  const SEALABLE = Object.keys(DOORS).filter((id) => DOORS[id].length >= 2 && DOORS[id].length <= 4);

  /* ---- lookups ---------------------------------------------------------- */

  const roomById = {};
  ROOMS.forEach((r, i) => { roomById[r.id] = r; r.index = i; r.cx = (r.x + r.w / 2) * TILE; r.cy = (r.y + r.h / 2) * TILE; });

  const closed = new Set();          // tile indices sealed by the door sabotage
  function sealRoom(roomId, on) {
    const doors = DOORS[roomId];
    if (!doors) return;
    for (const d of doors) {
      for (let ty = d.y; ty < d.y + d.h; ty++) {
        for (let tx = d.x; tx < d.x + d.w; tx++) {
          if (on) closed.add(at(tx, ty)); else closed.delete(at(tx, ty));
        }
      }
    }
  }
  const clearDoors = () => closed.clear();

  function solidTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true;
    const i = at(tx, ty);
    return !FLOOR[i] || closed.has(i);
  }

  /* World coordinates, which is what everything above this file speaks. */
  const solid = (wx, wy) => solidTile(Math.floor(wx / TILE), Math.floor(wy / TILE));

  function roomAt(wx, wy) {
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return null;
    const i = ROOM_AT[at(tx, ty)];
    return i < 0 ? null : ROOMS[i];
  }

  const toWorld = (t) => ({ x: (t.tx + 0.5) * TILE, y: (t.ty + 0.5) * TILE });

  /* Slide along walls rather than stopping dead against them: the axes are
     resolved separately, so walking into a corner at an angle still moves you
     along the wall you are not pushing into. Anything else feels like the
     game is fighting you, and on a thumbstick it is unplayable. */
  const RADIUS = 11;
  function move(x, y, dx, dy) {
    let nx = x, ny = y;
    if (dx) {
      const tryX = x + dx;
      const edge = tryX + Math.sign(dx) * RADIUS;
      if (!solid(edge, y - RADIUS + 2) && !solid(edge, y + RADIUS - 2) && !solid(edge, y)) nx = tryX;
    }
    if (dy) {
      const tryY = y + dy;
      const edge = tryY + Math.sign(dy) * RADIUS;
      if (!solid(nx - RADIUS + 2, edge) && !solid(nx + RADIUS - 2, edge) && !solid(nx, edge)) ny = tryY;
    }
    return { x: nx, y: ny };
  }

  /* Breadth-first over the tile grid, used only by the bots. The map is 7392
     tiles and a bot re-plans about once a second, so there is nothing here
     worth the complexity of A* -- and a wrong heuristic on a map with loops
     produces bots that walk into walls, which people notice immediately. */
  const parent = new Int32Array(W * H);
  const stamp = new Int32Array(W * H);
  let generation = 0;
  const queue = new Int32Array(W * H);

  function path(fromX, fromY, toX, toY) {
    const start = at(Math.floor(fromX / TILE), Math.floor(fromY / TILE));
    const goal = at(Math.floor(toX / TILE), Math.floor(toY / TILE));
    if (start === goal) return [];
    generation++;
    let head = 0, tail = 0;
    queue[tail++] = start;
    stamp[start] = generation;
    parent[start] = -1;
    while (head < tail) {
      const node = queue[head++];
      if (node === goal) {
        const out = [];
        for (let n = node; n !== -1 && n !== start; n = parent[n]) {
          out.push({ x: ((n % W) + 0.5) * TILE, y: (Math.floor(n / W) + 0.5) * TILE });
        }
        out.reverse();
        return out;
      }
      const tx = node % W, ty = (node / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = tx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = ty + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (solidTile(nx, ny)) continue;
        const next = at(nx, ny);
        if (stamp[next] === generation) continue;
        stamp[next] = generation;
        parent[next] = node;
        queue[tail++] = next;
      }
    }
    return null;
  }

  NS.map = {
    TILE, W, H, ROOMS, HALLS, STATIONS, VENT_GROUPS, SABOTAGE_SPOTS,
    EMERGENCY, SPAWN, DOORS, SEALABLE, FLOOR, roomById, RADIUS,
    at, solid, solidTile, roomAt, toWorld, move, path, sealRoom, clearDoors,
    pixelWidth: W * TILE, pixelHeight: H * TILE,
    isClosed: (tx, ty) => closed.has(at(tx, ty)),
  };
})(window.NS);
