/* Rooms made of rooms.

   A floor used to be one rectangular hall: machines on slots down the four
   walls, two rows of islands through the middle, pillars on a grid, ceiling
   panels on a grid. Correct, fair to walk, and the same shape four times with
   the lights changed -- there was nowhere on it you could describe to somebody
   else, which is the test a room passes or fails.

   So a floor is now planned as a coarse grid of cells and each cell is built
   by one of the zones below: a pit with a rail round it, a bank of machines in
   a recess, a bar, a lounge, a colonnade, a cashier's cage. Each zone puts up
   its own architecture, asks for its own light, and offers the *slots* it has
   for machines -- so a table stands inside the rail of a pit or in the recess
   of an alcove because that is where the zone said a table goes, rather than
   at a coordinate that happened to be free.

   Two rules the plan keeps, both learned the hard way:

   Every floor gets exactly one bar and at most one cage, because a floor with
   three bars reads as a mistake and a floor with none has nothing on it that
   is not a machine.

   The cell the lift opens into is always the entrance, and the entrance holds
   no machines. Arriving with a slot cabinet in your face is how the first
   version of the lift alcove felt, and the fix is a room rather than a nudge
   to the placement rules.

   Zones only ever use the materials the level hands them, so `mergeStatic`
   folds the whole floor into a handful of draw calls whatever is built. A zone
   that makes its own material is a zone that costs a draw call per instance,
   which is the one thing here that must not happen. */

(function (global) {
  'use strict';

  /* What each floor is made of. Weights, not counts: the plan draws from these
     so the same floor is a different arrangement every run without ever being
     a arrangement the floor's character would not allow. */
  const CHARACTER = {
    lobby: { pit: 3, alcove: 4, lounge: 1, colonnade: 1 },
    velvet: { pit: 4, colonnade: 3, lounge: 2, alcove: 1 },
    vault: { colonnade: 4, pit: 3, lounge: 1 },
    penthouse: { lounge: 3, pit: 3, colonnade: 1 },
  };

  /* Plan the floor.

     Cells are about thirteen metres across, which is the smallest a pit with a
     rail and three tables inside it will fit into. Rows and columns come out
     of the room's own size so a bigger floor gets more spaces rather than
     bigger ones. */
  function plan(opts) {
    const { w, d, rng, floorId, lift } = opts;
    const cols = Math.max(2, Math.round(w / 14));
    const rows = Math.max(2, Math.round(d / 14));
    const cw = w / cols, cd = d / rows;
    const weights = CHARACTER[floorId] || CHARACTER.lobby;

    const cells = [];
    /* Which cell the lift opens into.

       By nearest centre rather than by dividing the coordinate, because the
       lift sits at x = 0 and on a floor with an even number of columns that is
       exactly on a boundary -- floor division and a containment test then
       disagree about which cell it is in, and the entrance was planned into
       one cell while the doors opened into its neighbour. */
    let liftCol = 0, liftRow = 0, bestD = Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = -w / 2 + cw * (c + 0.5), cz = -d / 2 + cd * (r + 0.5);
        const dist = Math.hypot(cx - lift.x, cz - lift.z);
        if (dist < bestD) { bestD = dist; liftCol = c; liftRow = r; }
      }
    }

    // One bar, and a cage only on a floor with room for one -- the Penthouse is
    // four cells, and an entrance plus a bar plus a cage leaves it one room.
    const spare = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c === liftCol && r === liftRow) continue;
        spare.push({ c, r });
      }
    }
    rng.shuffle(spare);
    const bar = spare.shift() || null;
    const cage = cols * rows >= 6 ? spare.shift() : null;

    const pick = () => {
      const keys = Object.keys(weights);
      let total = 0;
      for (const k of keys) total += weights[k];
      let roll = rng.float(0, total);
      for (const k of keys) { if ((roll -= weights[k]) <= 0) return k; }
      return keys[0];
    };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = -w / 2 + cw * (c + 0.5);
        const z = -d / 2 + cd * (r + 0.5);
        let type = 'pit';
        if (c === liftCol && r === liftRow) type = 'entrance';
        else if (bar && c === bar.c && r === bar.r) type = 'bar';
        else if (cage && c === cage.c && r === cage.r) type = 'cage';
        else type = pick();
        // Which way the cell faces: towards the middle of the room, so a pit's
        // tables and an alcove's recess turn to face where people walk.
        const rot = Math.abs(x) > Math.abs(z)
          ? (x > 0 ? Math.PI / 2 : -Math.PI / 2)
          : (z > 0 ? 0 : Math.PI);
        cells.push({ type, x, z, w: cw, d: cd, rot, col: c, row: r });
      }
    }
    return { cells, cols, rows };
  }

  /* --- the zones -----------------------------------------------------------

     Every builder takes the cell and a mason: `slab` for a solid box, `deco`
     for something that is only to look at, `slot` to offer a place a machine
     can stand, `light` to ask for light, and the level's own materials. None
     of them may create geometry any other way. */

  const ZONES = {

    /* Where the lift opens. Deliberately empty of machines: a carpet inlay, a
       sign over the doors, and enough room to turn around in. */
    entrance(cell, m) {
      m.inlay(cell.x, cell.z, Math.min(cell.w, cell.d) * 0.42);
      m.light(cell.x, cell.z, 9, 1.35);
      const f = facing(cell.rot);
      // A pair of planters, so the space reads as a foyer rather than a gap.
      for (const side of [-1, 1]) {
        const px = cell.x + f.rx * side * cell.w * 0.3;
        const pz = cell.z + f.rz * side * cell.d * 0.3;
        m.slab(px, pz, 0.9, 0.9, 0.55, 0, m.mats.trim, 'planter');
        m.deco(px, pz, 1.0, 1.0, 0.12, 0.55, m.mats.panel);
      }
      m.sign('THE FLOOR', cell.x + f.fx * cell.d * 0.36, 2.5,
             cell.z + f.fz * cell.d * 0.36, cell.rot);
    },

    /* A pit: a waist-high rail enclosing three tables, with one gap to walk
       in through. The rail is the thing that makes a group of tables read as a
       place rather than as three tables. */
    pit(cell, m) {
      const rw = cell.w * 0.72, rd = cell.d * 0.72;
      const hw = rw / 2, hd = rd / 2;
      const f = facing(cell.rot);
      const H = 0.92, T = 0.14;
      // Three sides of rail; the fourth is the way in, facing the room.
      const sides = [
        { x: -hw, z: 0, w: T, d: rd },
        { x: hw, z: 0, w: T, d: rd },
        { x: 0, z: -hd, w: rw, d: T },
        { x: 0, z: hd, w: rw, d: T },
      ];
      // Drop whichever side the cell faces, so the gap is towards the middle.
      const gap = Math.abs(f.fx) > Math.abs(f.fz)
        ? (f.fx > 0 ? 1 : 0) : (f.fz > 0 ? 3 : 2);
      sides.forEach((s, i) => {
        if (i === gap) return;
        m.slab(cell.x + s.x, cell.z + s.z, s.w, s.d, H, 0, m.mats.rail, 'rail');
        // A brass cap along the top, which is most of what says "casino".
        m.deco(cell.x + s.x, cell.z + s.z, s.w + 0.1, s.d + 0.1, 0.07, H, m.mats.trim);
      });
      m.inlay(cell.x, cell.z, Math.min(rw, rd) * 0.46);
      // Tables inside, in a row across the way in.
      const along = Math.abs(f.fx) > Math.abs(f.fz) ? 'z' : 'x';
      for (const t of [-0.3, 0.3]) {
        const sx = cell.x + (along === 'x' ? rw * t : 0);
        const sz = cell.z + (along === 'z' ? rd * t : 0);
        m.slot(sx, sz, cell.rot);
      }
      m.slot(cell.x - f.fx * rd * 0.28, cell.z - f.fz * rd * 0.28, cell.rot);
      m.light(cell.x, cell.z, 11, 1.15);
    },

    /* An alcove: a recess of low partitions with a bank of machines in it,
       all facing the same way out. Where slot cabinets live. */
    alcove(cell, m) {
      const f = facing(cell.rot);
      const bw = cell.w * 0.78, bd = cell.d * 0.4;
      // The back wall of the recess, set away from the middle of the room.
      const backX = cell.x - f.fx * cell.d * 0.28;
      const backZ = cell.z - f.fz * cell.d * 0.28;
      const across = Math.abs(f.fx) > Math.abs(f.fz);
      m.slab(backX, backZ, across ? 0.35 : bw, across ? bw : 0.35,
             2.5, 0, m.mats.panel, 'partition');
      // Two returns, so it is a recess and not a wall.
      for (const side of [-1, 1]) {
        const ex = backX + f.rx * side * bw / 2 + f.fx * bd / 2;
        const ez = backZ + f.rz * side * bw / 2 + f.fz * bd / 2;
        m.slab(ex, ez, across ? bd : 0.3, across ? 0.3 : bd, 2.5, 0,
               m.mats.panel, 'partition');
      }
      // A lit band along the back, at eye height.
      m.glow(backX + f.fx * 0.2, backZ + f.fz * 0.2,
             across ? 0.06 : bw * 0.9, across ? bw * 0.9 : 0.06, 1.9);
      // Machines in a row along the back, facing out.
      for (const t of [-0.28, 0, 0.28]) {
        m.slot(backX + f.rx * bw * t + f.fx * 1.1,
               backZ + f.rz * bw * t + f.fz * 1.1, cell.rot);
      }
      m.light(cell.x, cell.z, 8, 1.0);
    },

    /* A bar. No machines: a counter, stools, a backlit shelf of bottles. The
       one place on the floor you are not being charged for standing. */
    bar(cell, m) {
      const f = facing(cell.rot);
      const across = Math.abs(f.fx) > Math.abs(f.fz);
      const len = (across ? cell.d : cell.w) * 0.7;
      const bx = cell.x - f.fx * cell.d * 0.22;
      const bz = cell.z - f.fz * cell.d * 0.22;
      // Counter, and a brass rail along the customer side.
      m.slab(bx, bz, across ? 0.9 : len, across ? len : 0.9, 1.05, 0, m.mats.rail, 'bar');
      m.deco(bx, bz, across ? 1.1 : len + 0.1, across ? len + 0.1 : 1.1, 0.08, 1.05, m.mats.trim);
      // The back shelf: two tiers, lit from behind.
      const sx = bx - f.fx * 1.1, sz = bz - f.fz * 1.1;
      m.slab(sx, sz, across ? 0.4 : len, across ? len : 0.4, 2.6, 0, m.mats.panel, 'shelf');
      for (const y of [1.3, 1.8]) {
        m.glow(sx + f.fx * 0.24, sz + f.fz * 0.24,
               across ? 0.05 : len * 0.94, across ? len * 0.94 : 0.05, y);
        // Bottles, as a row of thin boxes. Cheap, and reads correctly.
        const n = Math.max(4, Math.round(len / 0.55));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n - 0.5;
          m.deco(sx + f.rx * len * t + f.fx * 0.26, sz + f.rz * len * t + f.fz * 0.26,
                 0.13, 0.13, 0.34, y + 0.05, m.mats.glass);
        }
      }
      // Stools on the near side.
      const n = Math.max(3, Math.round(len / 1.3));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        const px = bx + f.rx * len * t + f.fx * 1.0;
        const pz = bz + f.rz * len * t + f.fz * 1.0;
        m.slab(px, pz, 0.42, 0.42, 0.72, 0, m.mats.rail, 'stool');
        m.deco(px, pz, 0.5, 0.5, 0.09, 0.72, m.mats.trim);
      }
      m.sign('BAR', sx, 2.35, sz, cell.rot);
      // A cabinet at the end of the counter. Every casino puts one there, and
      // it stops a bar cell being a room with nothing in it to do.
      m.slot(bx + f.rx * (len / 2 + 1.4) + f.fx * 0.6,
             bz + f.rz * (len / 2 + 1.4) + f.fz * 0.6, cell.rot);
      m.light(bx, bz, 7, 1.5);
    },

    /* The cashier: a cage with a counter and a slot under the glass. Nothing to
       do here, which is the point -- it is where the money is not. */
    cage(cell, m) {
      const f = facing(cell.rot);
      const across = Math.abs(f.fx) > Math.abs(f.fz);
      const len = (across ? cell.d : cell.w) * 0.5;
      const bx = cell.x - f.fx * cell.d * 0.24;
      const bz = cell.z - f.fz * cell.d * 0.24;
      m.slab(bx, bz, across ? 0.7 : len, across ? len : 0.7, 1.1, 0, m.mats.panel, 'cage');
      // Bars from the counter to the ceiling, with a gap at the middle.
      const n = Math.max(5, Math.round(len / 0.4));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        if (Math.abs(t) < 0.08) continue;                // the window
        m.deco(bx + f.rx * len * t, bz + f.rz * len * t, 0.07, 0.07, 1.7, 1.1, m.mats.trim);
      }
      m.deco(bx, bz, across ? 0.8 : len + 0.2, across ? len + 0.2 : 0.8, 0.12, 2.8, m.mats.trim);
      m.sign('CASHIER', bx - f.fx * 0.1, 2.05, bz - f.fz * 0.1, cell.rot);
      // And one in the queue, for the people who changed their mind.
      m.slot(bx + f.rx * (len / 2 + 1.5) + f.fx * 1.0,
             bz + f.rz * (len / 2 + 1.5) + f.fz * 1.0, cell.rot);
      m.light(bx + f.fx * 0.8, bz + f.fz * 0.8, 6, 1.2);
    },

    /* A lounge: a rug, seating, a low table and one machine, for the people
       who came with somebody who is playing. */
    lounge(cell, m) {
      m.rug(cell.x, cell.z, Math.min(cell.w, cell.d) * 0.36);
      const f = facing(cell.rot);
      // A bench along the back, and two chairs facing it.
      const bx = cell.x - f.fx * cell.d * 0.24, bz = cell.z - f.fz * cell.d * 0.24;
      const across = Math.abs(f.fx) > Math.abs(f.fz);
      m.slab(bx, bz, across ? 0.7 : cell.w * 0.44, across ? cell.d * 0.44 : 0.7,
             0.46, 0, m.mats.rail, 'bench');
      m.deco(bx - f.fx * 0.25, bz - f.fz * 0.25,
             across ? 0.22 : cell.w * 0.44, across ? cell.d * 0.44 : 0.22, 0.6, 0.46, m.mats.panel);
      m.slab(cell.x, cell.z, 1.3, 0.8, 0.4, 0, m.mats.trim, 'table');
      for (const side of [-1, 1]) {
        m.slab(cell.x + f.rx * side * 1.6 + f.fx * 0.5,
               cell.z + f.rz * side * 1.6 + f.fz * 0.5, 0.7, 0.7, 0.44, 0, m.mats.rail, 'chair');
      }
      // Two cabinets on the open side. A lounge with one is a waiting room; a
      // small floor also needs the slots, or its hand ends up out on the
      // generic grid rather than in any of its rooms.
      for (const side of [-1, 1]) {
        m.slot(cell.x + f.fx * cell.d * 0.3 + f.rx * side * cell.w * 0.24,
               cell.z + f.fz * cell.d * 0.3 + f.rz * side * cell.w * 0.24,
               cell.rot + Math.PI);
      }
      m.light(cell.x, cell.z, 6, 0.85);
    },

    /* A colonnade: a run of columns with a walkway between them and machines
       in the bays. Turns the middle of a big floor into a route. */
    colonnade(cell, m) {
      const f = facing(cell.rot);
      const across = Math.abs(f.fx) > Math.abs(f.fz);
      const len = (across ? cell.d : cell.w) * 0.82;
      const n = Math.max(3, Math.round(len / 3.2));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        for (const side of [-1, 1]) {
          const cx = cell.x + f.rx * len * t + f.fx * side * cell.d * 0.24;
          const cz = cell.z + f.rz * len * t + f.fz * side * cell.d * 0.24;
          m.column(cx, cz);
        }
      }
      // An inlaid strip down the middle: the route reads from the floor.
      m.strip(cell.x, cell.z, across ? 2.0 : len, across ? len : 2.0);
      // Machines in the bays, alternating sides.
      for (let i = 0; i < n - 1; i++) {
        const t = (i + 1) / n - 0.5;
        const side = i % 2 ? 1 : -1;
        m.slot(cell.x + f.rx * len * t + f.fx * side * cell.d * 0.34,
               cell.z + f.rz * len * t + f.fz * side * cell.d * 0.34,
               cell.rot + (side > 0 ? Math.PI : 0));
      }
      m.light(cell.x, cell.z, 9, 1.05);
    },
  };

  /* Which way is forward and which is sideways, for a cell's rotation. A zone
     is authored facing its own -Z and turned into place, the same convention
     the machines use -- getting this backwards points a bar's stools at the
     wall behind it. */
  function facing(rot) {
    return {
      fx: -Math.sin(rot), fz: -Math.cos(rot),
      rx: Math.cos(rot), rz: -Math.sin(rot),
    };
  }

  function build(cell, mason) {
    const fn = ZONES[cell.type] || ZONES.pit;
    fn(cell, mason);
  }

  global.GWZones = { plan, build, ZONES, CHARACTER };
})(window);
