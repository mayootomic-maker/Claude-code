/* A floor of the tower, built to be walked around.

   Each floor is a hall: outer walls, a ceiling with lights in it, pillars, a
   lift alcove, and a set of anchors where machines stand. The anchors are
   chosen from candidate slots by the run's own seeded RNG, so a floor is laid
   out differently every time you take the lift to it -- which is what the game
   this is a port of does, and what stops the third day being a memory test.

   Placement is constrained rather than random: a machine only lands somewhere
   its actual footprint fits, clear of the walls, the lift and everything
   already placed. A random layout that buries the roulette table in a pillar
   is worse than a fixed one. */

(function (global) {
  'use strict';

  const C = global.GWConfig;
  /* Tall enough for what stands in the room.

     The plinko case, the crash monitor and the ladder are all over four metres
     from the carpet once a machine is stood on it, and a 4.2m ceiling put their
     tops through it. Measure the furniture, then build the room. */
  const WALL_H = 5.4;
  const WALL_T = 0.4;

  /* How much room each machine needs, in its own local space, before rotation.
     Declared rather than measured: a bounding box of the built object would
     include the ladder's pit ring and the crash monitor's gridlines and fence
     off half the room. */
  const FOOTPRINT = {
    coinflip: { w: 3.4, d: 3.4 }, dice: { w: 5.2, d: 5.2 },
    slots: { w: 2.3, d: 1.8 }, duckrace: { w: 6.0, d: 3.8 },
    roulette: { w: 4.2, d: 4.2 }, blackjack: { w: 4.6, d: 4.6 },
    highlow: { w: 4.3, d: 4.3 }, plinko: { w: 3.0, d: 1.4 },
    crash: { w: 3.2, d: 1.4 }, mines: { w: 4.5, d: 4.5 },
    ladder: { w: 3.6, d: 4.0 }, chamber: { w: 3.0, d: 3.0 },
    wheel: { w: 2.8, d: 1.6 }, cups: { w: 3.2, d: 3.2 },
    scratcher: { w: 2.0, d: 1.5 }, war: { w: 3.4, d: 3.4 },
  };

  /* Dark shell, bright carpet, warm metal.

     The room should recede and the lit tables should carry the eye. A first
     pass had walls only a little darker than the carpet and the whole floor
     came out as one orange smear with the machines lost in it. */
  /* The four rooms, drawn from what the real game's floors actually are.

     Reference: a classic Vegas floor in oxblood and plum under warm neon; a
     black-light floor that is all magenta and cyan over bare purple concrete; a
     white-marble atrium with glass and gold; and a gold rotunda in red and
     gilt. The first pass here was warm charcoal and gold on all four, which
     made the whole tower one room repeated with the lights changed.

     Dark shell, bright carpet: the room should recede and the lit tables should
     carry the eye. An earlier pass had walls only a little darker than the
     carpet and a floor came out as one smear with the machines lost in it. */
  const THEME = {
    // Floor 0 -- the classic floor. Paisley red-and-gold carpet, maroon walls.
    lobby: { carpet: '#b03a52', wall: 0x35131f, trim: 0xe0ad46, neon: 0xffbf6b, ceiling: 0x160810 },
    // Floor 1 -- the black-light room. Magenta and cyan over purple concrete.
    velvet: { carpet: '#5d2e79', wall: 0x2b0e42, trim: 0x2ee6ff, neon: 0xff3fd0, ceiling: 0x120520 },
    // Floor 2 -- the marble atrium. Pale stone, glass, teal shadow, gold trim.
    vault: { carpet: '#9fb6b2', wall: 0x16283c, trim: 0xdfcb94, neon: 0x8fe6ff, ceiling: 0x0c1524 },
    // Floor 3 -- the gold rotunda. Red-and-gold mosaic under a gilt ceiling.
    penthouse: { carpet: '#8a2731', wall: 0x2a1410, trim: 0xe0b060, neon: 0xffd98a, ceiling: 0x180b08 },
  };

  /* Big enough for their machines with room to walk between them.

     The first pass had a 24x18 lobby and put pillars on a grid that landed on
     exactly the slots the machines wanted, so only two of the four fitted and
     the other two silently vanished. A dice table is five metres across; the
     room has to be sized for what stands in it. */
  const SIZE = {
    lobby: { w: 56, d: 40 }, velvet: { w: 52, d: 38 },
    vault: { w: 44, d: 32 }, penthouse: { w: 30, d: 26 },
  };

  /* How many of each machine a floor puts out.

     A real casino floor is banks of the same machine, not one of each, and at
     one apiece these rooms were four tables in a hall you could cross in six
     seconds. More copies also gives the heat system somewhere to send you: the
     pit shutting the coin toss matters less when there are three of them, and
     it matters in the right way -- you walk. The count comes down as you climb,
     because the top of the building is meant to feel like fewer, larger,
     worse decisions. */
  const COPIES = { lobby: 3, velvet: 3, vault: 3, penthouse: 2 };

  function build(opts) {
    const floorDef = C.FLOORS[opts.floor];
    /* The hand this floor is showing tonight, dealt by the caller. A floor
       names a pool rather than a fixed four now, so the builder has to be told
       which of them it is standing rather than reading the pool itself and
       standing all of it. */
    const games = opts.games || C.gamesOn(opts.floor, 0);
    const theme = THEME[floorDef.id];
    const size = SIZE[floorDef.id];
    const rng = opts.rng;
    const W = size.w, D = size.d;
    const halfW = W / 2, halfD = D / 2;

    const group = new THREE.Group();
    const solids = new global.GWCollision.World();
    solids.setBounds(-halfW, -halfD, halfW, halfD);
    const disposables = [];
    /* Where this room would like light rather than the lights themselves.
       stage.js owns a small fixed pool and deals it to the nearest of these --
       see the comment there for why the count has to stay constant. */
    const sites = { points: [], spots: [] };

    const track = (thing) => { disposables.push(thing); return thing; };

    /* --- shell ------------------------------------------------------------ */

    const carpetTex = GWStage.carpetTexture(theme.carpet);
    carpetTex.repeat.set(W / 3, D / 3);
    const carpet = new THREE.Mesh(
      track(new THREE.PlaneGeometry(W, D)),
      track(new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 0.97 }))
    );
    carpet.rotation.x = -Math.PI / 2;
    carpet.receiveShadow = true;
    group.add(carpet);

    const ceiling = new THREE.Mesh(
      track(new THREE.PlaneGeometry(W, D)),
      track(new THREE.MeshStandardMaterial({ color: theme.ceiling, roughness: 0.95 }))
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_H;
    group.add(ceiling);

    const wallMat = track(new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.82 }));
    const trimMat = track(new THREE.MeshStandardMaterial({
      color: theme.trim, metalness: 0.85, roughness: 0.32,
    }));

    function slab(x, z, w, d, h, y, mat, solid) {
      const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), mat);
      mesh.position.set(x, y + h / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      if (solid) solids.add(x, z, w / 2, d / 2, solid);
      return mesh;
    }

    // Four walls, and a dado rail so they are not four blank slabs.
    slab(0, -halfD, W, WALL_T, WALL_H, 0, wallMat, 'wall');
    slab(0, halfD, W, WALL_T, WALL_H, 0, wallMat, 'wall');
    slab(-halfW, 0, WALL_T, D, WALL_H, 0, wallMat, 'wall');
    slab(halfW, 0, WALL_T, D, WALL_H, 0, wallMat, 'wall');
    for (const [x, z, w, d] of [[0, -halfD + 0.22, W, 0.1], [0, halfD - 0.22, W, 0.1],
                                [-halfW + 0.22, 0, 0.1, D], [halfW - 0.22, 0, 0.1, D]]) {
      slab(x, z, w, d, 0.09, 1.05, trimMat, null);
      slab(x, z, w, d, 0.16, 0, trimMat, null);      // skirting
    }

    const panelMat = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.wall).multiplyScalar(1.9), roughness: 0.7,
    }));
    const addPanel = (x, z, w, d, h, y, kind) =>
      slab(x, z, w, d, h, y, kind === 'rail' ? trimMat : panelMat, null);
    const skin = 0.22;              // how far the panels stand off the wall
    panelRun(addPanel, { x1: -halfW + 1.5, z1: -halfD + skin, x2: halfW - 1.5, z2: -halfD + skin,
                         inward: { x: 0, z: 1 }, height: WALL_H - 1.6 });
    panelRun(addPanel, { x1: -halfW + 1.5, z1: halfD - skin, x2: halfW - 1.5, z2: halfD - skin,
                         inward: { x: 0, z: -1 }, height: WALL_H - 1.6 });
    panelRun(addPanel, { x1: -halfW + skin, z1: -halfD + 1.5, x2: -halfW + skin, z2: halfD - 1.5,
                         inward: { x: 1, z: 0 }, height: WALL_H - 1.6 });
    panelRun(addPanel, { x1: halfW - skin, z1: -halfD + 1.5, x2: halfW - skin, z2: halfD - 1.5,
                         inward: { x: -1, z: 0 }, height: WALL_H - 1.6 });

    /* --- ceiling lights --------------------------------------------------- */

    const glowMat = track(new THREE.MeshBasicMaterial({ color: theme.neon }));
    /* One texture for every halo on the floor; the material is cloned per lamp
       so a table can tint its own. Clones share a shader configuration, so
       forty of them still compile once -- what costs is forty *different*
       configurations, not forty materials. */
    const haloMat = track(new THREE.SpriteMaterial({
      map: track(glowTexture()),
      color: theme.neon,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    }));
    const cols = Math.max(2, Math.round(W / 6));
    const rows = Math.max(2, Math.round(D / 6));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = -halfW + W * (i + 0.5) / cols;
        const z = -halfD + D * (j + 0.5) / rows;
        const panel = new THREE.Mesh(track(new THREE.PlaneGeometry(2.4, 0.34)), glowMat);
        panel.rotation.x = Math.PI / 2;
        panel.position.set(x, WALL_H - 0.03, z);
        group.add(panel);
        // A light in every other panel. The panels carry the look; these carry
        // the room, and without enough of them the floor between the tables is
        // a dark corridor you cannot see your way across.
        if ((i + j) % 2 === 0) {
          sites.points.push({ at: new THREE.Vector3(x, WALL_H - 0.4, z),
                              colour: theme.neon, intensity: 22, distance: 14 });
        }
      }
    }

    // A glowing strip where the walls meet the ceiling.
    for (const [x, z, w, d] of [[0, -halfD + 0.3, W, 0.08], [0, halfD - 0.3, W, 0.08],
                                [-halfW + 0.3, 0, 0.08, D], [halfW - 0.3, 0, 0.08, D]]) {
      const strip = new THREE.Mesh(track(new THREE.BoxGeometry(w, 0.06, d)), glowMat);
      strip.position.set(x, WALL_H - 0.16, z);
      group.add(strip);
    }

    /* --- the lift --------------------------------------------------------- */

    const liftW = 3.0, liftD = 2.2;
    const liftZ = -halfD + liftD / 2 + 0.1;
    const lift = { x: 0, z: liftZ, w: liftW, d: liftD };
    slab(-liftW / 2 - 0.25, liftZ, 0.5, liftD, WALL_H, 0, wallMat, 'wall');
    slab(liftW / 2 + 0.25, liftZ, 0.5, liftD, WALL_H, 0, wallMat, 'wall');
    slab(0, liftZ, liftW + 1.0, 0.3, 0.5, WALL_H - 0.5, trimMat, null);
    const liftFloor = new THREE.Mesh(
      track(new THREE.PlaneGeometry(liftW, liftD)),
      track(new THREE.MeshStandardMaterial({ color: theme.trim, metalness: 0.9, roughness: 0.25 }))
    );
    liftFloor.rotation.x = -Math.PI / 2;
    liftFloor.position.set(0, 0.012, liftZ);
    group.add(liftFloor);
    sites.points.push({ at: new THREE.Vector3(0, 2.6, liftZ),
                        colour: theme.neon, intensity: 8, distance: 7 });
    group.add(sign('LIFT', 0, 2.55, liftZ + liftD / 2 + 0.02, theme.neon, 1.8, 0));

    /* --- pillars ---------------------------------------------------------- */

    const pillarGeo = track(new THREE.BoxGeometry(0.7, WALL_H, 0.7));
    const pillars = [];
    /* Pillars live in the middle of the room only.

       Machines stand around the perimeter, so a pillar grid that reaches the
       walls competes with them for the same floor and the loser is the machine.
       Keeping them inboard gives the room a spine to walk around without
       fighting anything for space. */
    const inner = { x: halfW - 7.5, z: halfD - 6.5 };
    if (inner.x > 1 && inner.z > 1) {
      const nx = Math.max(1, Math.round(inner.x / 4));
      for (let i = 0; i <= nx; i++) {
        const x = -inner.x + (inner.x * 2) * (nx ? i / nx : 0.5);
        /* Never on the centre line.

           The lift is at the middle of the north wall and you step out of it
           facing down the room, so a pillar at x = 0 is the first thing you see
           every single time you arrive on a floor -- and what you see is a
           column. Keeping the whole lane clear costs two pillars and gives the
           room a view. */
        if (Math.abs(x - lift.x) < liftW / 2 + 1.2) continue;
        for (const z of [-inner.z, inner.z]) pillars.push({ x, z });
      }
    }
    for (const p of pillars) {
      const pillar = new THREE.Mesh(pillarGeo, wallMat);
      pillar.position.set(p.x, WALL_H / 2, p.z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      group.add(pillar);
      const collar = new THREE.Mesh(track(new THREE.BoxGeometry(0.86, 0.12, 0.86)), trimMat);
      collar.position.set(p.x, 1.05, p.z);
      group.add(collar);
      solids.add(p.x, p.z, 0.35, 0.35, 'pillar');
    }

    /* --- machine anchors -------------------------------------------------- */

    const PLAYER = 0.45;          // how much room a person needs to stand
    const placed = [];
    const candidates = [];
    // Slots down each wall, facing into the room, plus a row of islands.
    const inset = 3.2;
    /* A machine rotated by `rot` faces its own -Z, which in world space is
       (-sin rot, -cos rot). So a machine standing against the south wall has to
       be turned to rot = 0 to look north into the room. Getting this backwards
       -- as the first version did for all four walls -- points every machine at
       the wall behind it and puts the spot you stand to play it outside the
       building. */
    for (let x = -halfW + inset; x <= halfW - inset + 0.01; x += 4.2) {
      candidates.push({ x, z: halfD - inset, rot: 0 });             // south wall, facing north
      candidates.push({ x, z: -halfD + inset, rot: Math.PI });      // north wall, facing south
    }
    for (let z = -halfD + inset; z <= halfD - inset + 0.01; z += 4.2) {
      candidates.push({ x: -halfW + inset, z, rot: -Math.PI / 2 }); // west wall, facing east
      candidates.push({ x: halfW - inset, z, rot: Math.PI / 2 });   // east wall, facing west
    }
    /* Islands, in rows down the middle rather than one line across it. A hall
       this size with a single row of tables reads as a corridor with an alcove
       at each end; two rows with a lane between them reads as a floor. */
    for (const z of [-halfD * 0.42, halfD * 0.42]) {
      for (let x = -halfW + 7; x <= halfW - 7 + 0.01; x += 5.5) {
        candidates.push({ x, z, rot: z < 0 ? Math.PI : 0 });
      }
    }
    rng.shuffle(candidates);

    const anchors = [];
    /* Round-robin rather than all of one then all of the next, so a floor puts
       a coin toss near a dice table near a slot bank instead of grouping every
       copy of one machine in whichever corner the shuffle happened to favour. */
    const wanted = [];
    /* Biggest first, within each round.

       The spots are shuffled and taken in order, so a small machine that lands
       in the middle of a wall can leave nothing wide enough for a five-metre
       table -- War went unplaced entirely on some seeds, and a game that is
       dealt to a floor and then silently not built is worse than one that was
       never dealt. Largest footprint first is the usual answer to that and
       costs nothing. */
    const bySize = games.slice().sort((a, b) => {
      const fa = FOOTPRINT[a] || { w: 4, d: 4 }, fb = FOOTPRINT[b] || { w: 4, d: 4 };
      return (fb.w * fb.d) - (fa.w * fa.d);
    });
    for (let copy = 0; copy < (COPIES[floorDef.id] || 1); copy++) {
      for (const gameId of bySize) wanted.push(gameId);
    }
    for (const gameId of wanted) {
      const foot = FOOTPRINT[gameId] || { w: 4, d: 4 };
      const spot = candidates.find((c) => !c.used && fits(c, foot));
      if (!spot) {
        /* The first copy of a machine has to fit somewhere, or the player walks
           the floor looking for a table that was never built. A later copy
           failing just means the room filled up, which is fine and silent. */
        if (!anchors.some((a) => a.gameId === gameId)) {
          console.warn('[gwyf] no room on ' + floorDef.name + ' for ' + gameId
            + ' (' + foot.w + ' by ' + foot.d + ')');
        }
        continue;
      }
      spot.used = true;
      const box = rotated(spot, foot);
      placed.push(box);
      solids.add(box.x, box.z, box.hw, box.hd, 'machine:' + gameId);
      anchors.push({
        kind: 'machine',
        gameId,
        position: new THREE.Vector3(spot.x, 0, spot.z),
        rotationY: spot.rot,
        // Half-extents in world space. Reach is measured to the edge of this
        // box, not to its centre: measuring to the centre makes a five-metre
        // dice table unreachable from the only place you can stand at it.
        half: { hw: box.hw, hd: box.hd },
        // Where a player stands to use it: out in front by the machine's own
        // half-depth along the direction it faces, plus room for a person.
        stand: standPoint(spot, box),
      });
    }

    function standPoint(spot, box) {
      const sideways = Math.abs(Math.sin(spot.rot)) > 0.5;
      // The half-extent along the facing axis -- hw when the machine is turned
      // to face along X, hd when it faces along Z.
      const depth = (sideways ? box.hw : box.hd) + 1.15;
      return new THREE.Vector3(
        spot.x - Math.sin(spot.rot) * depth, 0,
        spot.z - Math.cos(spot.rot) * depth
      );
    }

    function rotated(spot, foot) {
      const sideways = Math.abs(Math.sin(spot.rot)) > 0.5;
      return {
        x: spot.x, z: spot.z,
        hw: (sideways ? foot.d : foot.w) / 2,
        hd: (sideways ? foot.w : foot.d) / 2,
      };
    }

    function fits(spot, foot) {
      const box = rotated(spot, foot);
      // Inside the room, with a gangway left around it.
      if (Math.abs(box.x) + box.hw > halfW - 0.8) return false;
      if (Math.abs(box.z) + box.hd > halfD - 0.8) return false;

      /* And you have to be able to stand at it.

         A machine whose only approach is buried in a pillar is placed, drawn,
         and unusable -- the player walks up to a column and the prompt never
         appears. Four of the twelve were like that before this check existed. */
      const stand = standPoint(spot, box);
      if (Math.abs(stand.x) > halfW - PLAYER - 0.3) return false;
      if (Math.abs(stand.z) > halfD - PLAYER - 0.3) return false;
      for (const p of pillars) {
        if (Math.abs(stand.x - p.x) < 0.35 + PLAYER + 0.25
          && Math.abs(stand.z - p.z) < 0.35 + PLAYER + 0.25) return false;
      }
      if (Math.abs(stand.x - lift.x) < lift.w / 2 + PLAYER
        && Math.abs(stand.z - lift.z) < lift.d / 2 + PLAYER) return false;
      // Room to stand back from it, not just room to stand in.
      for (const other of placed) {
        if (Math.abs(stand.x - other.x) < other.hw + PLAYER + 1.0
          && Math.abs(stand.z - other.z) < other.hd + PLAYER + 1.0) return false;
      }
      // Clear of the lift and its doorway.
      if (Math.abs(box.x - lift.x) < box.hw + lift.w / 2 + 1.2
        && Math.abs(box.z - lift.z) < box.hd + lift.d / 2 + 1.6) return false;
      for (const p of pillars) {
        if (Math.abs(box.x - p.x) < box.hw + 0.7 && Math.abs(box.z - p.z) < box.hd + 0.7) return false;
      }
      for (const other of placed) {
        if (Math.abs(box.x - other.x) < box.hw + other.hw + 2.4
          && Math.abs(box.z - other.z) < box.hd + other.hd + 2.4) return false;
      }
      return true;
    }

    /* --- a lamp over every table ------------------------------------------ */

    for (const anchor of anchors) {
      // Kept on the anchor so the game can recolour it: the lamp over a table
      // is how heat is read from across the room.
      anchor.lampSite = {
        at: new THREE.Vector3(anchor.position.x, WALL_H - 0.5, anchor.position.z),
        aim: new THREE.Vector3(anchor.position.x, 0.4, anchor.position.z),
        colour: 0xffe6c2, intensity: 46, distance: 10, angle: 0.66,
      };
      sites.spots.push(anchor.lampSite);
      // The shade, so the light has somewhere to come from.
      const shade = new THREE.Mesh(
        track(new THREE.ConeGeometry(0.55, 0.42, 16, 1, true)),
        track(new THREE.MeshStandardMaterial({
          color: theme.trim, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide,
        }))
      );
      shade.position.set(anchor.position.x, WALL_H - 0.34, anchor.position.z);
      group.add(shade);
      const bulb = new THREE.Mesh(track(new THREE.SphereGeometry(0.1, 10, 8)), glowMat);
      bulb.position.set(anchor.position.x, WALL_H - 0.52, anchor.position.z);
      group.add(bulb);

      /* A halo under each shade.

         There is no bloom here -- a post pass costs more than everything else
         on this floor put together -- so the glow is drawn rather than
         computed: one additive billboard that always faces the camera, fading
         out at its edge. It is what makes a hanging lamp read as a light
         source rather than a cone with a white ball in it, and it is the thing
         a casino has most of. */
      const halo = new THREE.Sprite(track(haloMat.clone()));
      halo.position.set(anchor.position.x, WALL_H - 0.56, anchor.position.z);
      halo.scale.setScalar(2.1);
      // Kept with the lamp so heat can tint the halo along with the bulb.
      anchor.halo = halo;
      group.add(halo);
    }

    /* --- spawn ------------------------------------------------------------ */

    // Just outside the lift, looking into the room.
    const spawn = { x: 0, z: lift.z + lift.d / 2 + 1.1, angle: Math.PI };

    mergeStatic(group);

    return {
      group, solids, anchors, spawn, lift, theme, sites,
      size: { w: W, d: D, height: WALL_H },
      name: floorDef.name,
      dispose() {
        for (const thing of disposables) if (thing.dispose) thing.dispose();
      },
    };
  }



  /* Fold the room's boxes into one mesh per material.

     A hall is built from a few hundred slabs -- wall panels, rails, skirting,
     ceiling strips, pillars and their collars -- and every one of them was its
     own draw call. Measured at 343 draw calls on the busiest floor, which is
     several hundred more than the room deserves; the machines standing in it
     account for about twenty.

     Only static, untextured, indexed geometry is folded: anything with a map
     (the carpet) keeps its own UVs, and anything added after the room is built
     (the machines, the friends) is never seen by this. Merging is done by hand
     because BufferGeometryUtils lives in three's examples and ships only as an
     ES module, which the single-file build cannot import. */
  function mergeStatic(root) {
    root.updateMatrixWorld(true);
    const byMaterial = new Map();
    const originals = [];
    root.traverse((o) => {
      if (!o.isMesh || o.userData.keepSeparate) return;
      const geo = o.geometry;
      if (!geo || !geo.index || !geo.attributes.position || !geo.attributes.normal) return;
      if (o.material.map) return;
      const key = o.material.uuid;
      if (!byMaterial.has(key)) byMaterial.set(key, { material: o.material, items: [] });
      byMaterial.get(key).items.push(o);
      originals.push(o);
    });

    const normalMatrix = new THREE.Matrix3();
    const vertex = new THREE.Vector3();
    const merged = [];
    for (const bucket of byMaterial.values()) {
      if (bucket.items.length < 2) continue;
      let verts = 0, indices = 0;
      for (const mesh of bucket.items) {
        verts += mesh.geometry.attributes.position.count;
        indices += mesh.geometry.index.count;
      }
      const position = new Float32Array(verts * 3);
      const normal = new Float32Array(verts * 3);
      const index = verts > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
      let v = 0, i = 0;
      for (const mesh of bucket.items) {
        const geo = mesh.geometry;
        const p = geo.attributes.position, n = geo.attributes.normal, ix = geo.index;
        normalMatrix.getNormalMatrix(mesh.matrixWorld);
        const base = v;
        for (let k = 0; k < p.count; k++, v++) {
          vertex.fromBufferAttribute(p, k).applyMatrix4(mesh.matrixWorld);
          position[v * 3] = vertex.x; position[v * 3 + 1] = vertex.y; position[v * 3 + 2] = vertex.z;
          vertex.fromBufferAttribute(n, k).applyMatrix3(normalMatrix).normalize();
          normal[v * 3] = vertex.x; normal[v * 3 + 1] = vertex.y; normal[v * 3 + 2] = vertex.z;
        }
        for (let k = 0; k < ix.count; k++, i++) index[i] = ix.getX(k) + base;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
      geometry.setIndex(new THREE.BufferAttribute(index, 1));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, bucket.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      merged.push({ mesh, items: bucket.items });
    }

    for (const { mesh, items } of merged) {
      for (const old of items) if (old.parent) old.parent.remove(old);
      root.add(mesh);
    }
    return merged.length;
  }

  /* Panelling.

     A wall that is one flat box reads as a backdrop however well it is lit --
     there is nothing on it for the light to catch. A run of recessed panels
     with a rail above and a skirting below costs a few dozen boxes and turns
     the same wall into a room you are standing in. */
  function panelRun(add, opts) {
    const { x1, z1, x2, z2, inward, height } = opts;
    const along = Math.hypot(x2 - x1, z2 - z1);
    const ux = (x2 - x1) / along, uz = (z2 - z1) / along;
    const count = Math.max(1, Math.round(along / 3.0));
    const step = along / count;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) * step;
      const cx = x1 + ux * t + inward.x * 0.02;
      const cz = z1 + uz * t + inward.z * 0.02;
      const w = Math.abs(ux) * (step - 0.5) + Math.abs(inward.x) * 0.06;
      const d = Math.abs(uz) * (step - 0.5) + Math.abs(inward.z) * 0.06;
      add(cx, cz, Math.max(w, 0.06), Math.max(d, 0.06), height * 0.52, 1.16, 'panel');
      add(cx, cz, Math.max(w, 0.06) * 1.06, Math.max(d, 0.06) * 1.06, 0.06, 1.16 + height * 0.52, 'rail');
    }
  }

  /* Lit lettering on a wall. Canvas on a plane -- extruded text would be
     hundreds of triangles to read four characters across a room. */
  function sign(text, x, y, z, colour, width, rotY, faceTowards) {
    const c = global.document.createElement('canvas');
    c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = '#' + new THREE.Color(colour).getHexString();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Shrink to fit rather than run off the end: LOAN SHARK at 84px overflowed
    // the canvas and rendered as OAN SHAR.
    let size = 84;
    do {
      g.font = '700 ' + size + 'px \"Bebas Neue\", Inter, system-ui, sans-serif';
      size -= 4;
    } while (size > 24 && g.measureText(text).width > 470);
    g.fillText(text, 256, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width * 0.25),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    mesh.position.set(x, y, z);
    /* Point it at whoever reads it.

       `faceTowards` wins over a raw Y angle because Object3D.lookAt keeps the
       object's up axis vertical, so the lettering cannot come out rolled --
       which is what happened to the signs on the side walls when this was hand
       computed, leaving SHOP and COLLECT reading bottom to top. */
    if (faceTowards) mesh.lookAt(faceTowards.x, y, faceTowards.z);
    else mesh.rotation.y = rotY || 0;
    return mesh;
  }

  /* The lobby.

     Not a menu with a background: the place the run actually starts. The loan
     shark's terminal, the shop, the shelf your purchases sit on and the doors
     to the limo are all objects in a room you walk between -- which is the
     whole point of the shop's rule that an item you bought but did not pick up
     does not come with you.

     It is built by hand rather than generated. There are five things in it and
     where each one is matters; randomising that would only make the hub harder
     to learn without making it more interesting. */
  function buildLobby(opts) {
    const W = 34, D = 26;
    const halfW = W / 2, halfD = D / 2;
    const theme = { carpet: '#8a6a2a', wall: 0x161010, trim: 0x9a7333, neon: 0xffc978, ceiling: 0x0b0807 };

    const group = new THREE.Group();
    const solids = new global.GWCollision.World();
    solids.setBounds(-halfW, -halfD, halfW, halfD);
    const disposables = [];
    const sites = { points: [], spots: [] };
    const track = (t) => { disposables.push(t); return t; };

    const carpetTex = GWStage.carpetTexture(theme.carpet);
    carpetTex.repeat.set(W / 3, D / 3);
    const carpet = new THREE.Mesh(
      track(new THREE.PlaneGeometry(W, D)),
      track(new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 0.97 }))
    );
    carpet.rotation.x = -Math.PI / 2;
    carpet.receiveShadow = true;
    group.add(carpet);

    const ceiling = new THREE.Mesh(
      track(new THREE.PlaneGeometry(W, D)),
      track(new THREE.MeshStandardMaterial({ color: theme.ceiling, roughness: 0.95 }))
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_H;
    group.add(ceiling);

    const wallMat = track(new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.85 }));
    const trimMat = track(new THREE.MeshStandardMaterial({
      color: theme.trim, metalness: 0.8, roughness: 0.35,
    }));
    const glowMat = track(new THREE.MeshBasicMaterial({ color: theme.neon }));

    function slab(x, z, w, d, h, y, mat, solid) {
      const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), mat);
      mesh.position.set(x, y + h / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      if (solid) solids.add(x, z, w / 2, d / 2, solid);
      return mesh;
    }

    slab(0, -halfD, W, 0.4, WALL_H, 0, wallMat, 'wall');
    slab(0, halfD, W, 0.4, WALL_H, 0, wallMat, 'wall');
    slab(-halfW, 0, 0.4, D, WALL_H, 0, wallMat, 'wall');
    slab(halfW, 0, 0.4, D, WALL_H, 0, wallMat, 'wall');
    for (const [x, z, w, d] of [[0, -halfD + 0.22, W, 0.1], [0, halfD - 0.22, W, 0.1],
                                [-halfW + 0.22, 0, 0.1, D], [halfW - 0.22, 0, 0.1, D]]) {
      slab(x, z, w, d, 0.09, 1.05, trimMat, null);
      slab(x, z, w, d, 0.16, 0, trimMat, null);
    }
    for (const [x, z, w, d] of [[0, -halfD + 0.3, W, 0.08], [0, halfD - 0.3, W, 0.08],
                                [-halfW + 0.3, 0, 0.08, D], [halfW - 0.3, 0, 0.08, D]]) {
      const strip = new THREE.Mesh(track(new THREE.BoxGeometry(w, 0.06, d)), glowMat);
      strip.position.set(x, WALL_H - 0.16, z);
      group.add(strip);
    }

    const panelMat = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.wall).multiplyScalar(2.1), roughness: 0.68,
    }));
    const addPanel = (x, z, w, d, h, y, kind) =>
      slab(x, z, w, d, h, y, kind === 'rail' ? trimMat : panelMat, null);
    panelRun(addPanel, { x1: -halfW + 1.5, z1: -halfD + 0.22, x2: halfW - 1.5, z2: -halfD + 0.22,
                         inward: { x: 0, z: 1 }, height: WALL_H - 1.8 });
    panelRun(addPanel, { x1: -halfW + 0.22, z1: -halfD + 1.5, x2: -halfW + 0.22, z2: halfD - 1.5,
                         inward: { x: 1, z: 0 }, height: WALL_H - 1.8 });
    panelRun(addPanel, { x1: halfW - 0.22, z1: -halfD + 1.5, x2: halfW - 0.22, z2: halfD - 1.5,
                         inward: { x: -1, z: 0 }, height: WALL_H - 1.8 });

    for (const [x, z] of [[-6, -4], [6, -4], [-6, 4], [6, 4], [0, 0], [0, -6], [0, 6]]) {
      sites.points.push({ at: new THREE.Vector3(x, WALL_H - 0.5, z),
                          colour: theme.neon, intensity: 24, distance: 15 });
      const panel = new THREE.Mesh(track(new THREE.PlaneGeometry(2.6, 0.4)), glowMat);
      panel.rotation.x = Math.PI / 2;
      panel.position.set(x, WALL_H - 0.03, z);
      group.add(panel);
    }

    const anchors = [];

    /* A counter you walk up to. Dark body, lit sign above it, and a small
       screen inset in the front -- rather than the whole face glowing, which
       filled the frame with light and hid the room behind it. */
    function fixture(spec) {
      const { x, z, rot, w, d, label, action, colour } = spec;
      const sideways = Math.abs(Math.sin(rot)) > 0.5;
      const hw = (sideways ? d : w) / 2;
      const hd = (sideways ? w : d) / 2;
      const face = { x: -Math.sin(rot), z: -Math.cos(rot) };
      const depth = sideways ? hw : hd;

      slab(x, z, hw * 2, hd * 2, 1.02, 0, wallMat, 'fixture:' + action);
      slab(x, z, hw * 2 + 0.14, hd * 2 + 0.14, 0.07, 1.02, trimMat, null);
      // A back panel, so a counter against a wall has a presence above it.
      slab(x - face.x * (depth - 0.12), z - face.z * (depth - 0.12),
           sideways ? 0.2 : hw * 1.7, sideways ? hd * 1.7 : 0.2, 0.85, 1.09, wallMat, null);

      const screen = new THREE.Mesh(
        track(new THREE.PlaneGeometry(Math.min(hw, hd) * 1.5, 0.34)),
        track(new THREE.MeshBasicMaterial({ color: colour || theme.neon }))
      );
      screen.position.set(x + face.x * (depth + 0.012), 0.66, z + face.z * (depth + 0.012));
      screen.rotation.y = rot;
      group.add(screen);

      sites.points.push({ at: new THREE.Vector3(x + face.x * 0.6, 1.9, z + face.z * 0.6),
                          colour: colour || theme.neon, intensity: 5, distance: 5 });

      const standAt = new THREE.Vector3(
        x + face.x * (depth + 1.6), 0, z + face.z * (depth + 1.6));
      group.add(sign(label, x - face.x * (depth - 0.26), 1.62,
        z - face.z * (depth - 0.26), colour || theme.neon, 2.2, 0, standAt));

      anchors.push({
        kind: 'fixture',
        action,
        label,
        position: new THREE.Vector3(x, 0, z),
        rotationY: rot,
        half: { hw, hd },
        // Far enough back to see the counter and the room behind it. Standing
        // right against it filled the screen with the counter's own light.
        stand: standAt,
        // Look at the sign above the counter, not through the counter.
        focus: new THREE.Vector3(x - face.x * depth, 1.5, z - face.z * depth),
      });
    }

    // The loan shark's terminal, the shop, the shelf your purchases sit on.
    fixture({ x: 0, z: -halfD + 1.6, rot: Math.PI, w: 3.4, d: 1.2,
              label: 'LOAN SHARK', action: 'shark', colour: 0xf0616d });
    fixture({ x: -halfW + 1.6, z: -2.5, rot: -Math.PI / 2, w: 3.6, d: 1.2,
              label: 'SHOP', action: 'shop', colour: 0xe9b44c });
    fixture({ x: -halfW + 1.6, z: 2.5, rot: -Math.PI / 2, w: 2.4, d: 1.2,
              label: 'COLLECT', action: 'collect', colour: 0x5cd98c });

    // The doors to the limo.
    const doorW = 4.0;
    slab(-doorW / 2 - 1.4, halfD - 0.6, 2.4, 0.6, WALL_H, 0, wallMat, 'wall');
    slab(doorW / 2 + 1.4, halfD - 0.6, 2.4, 0.6, WALL_H, 0, wallMat, 'wall');
    const doorMat = track(new THREE.MeshStandardMaterial({
      color: 0x1d1512, metalness: 0.35, roughness: 0.42,
    }));
    for (const side of [-1, 1]) {
      slab(side * (doorW / 4 + 0.03), halfD - 0.62, doorW / 2 - 0.06, 0.24, 3.0, 0, doorMat, null);
      // A vertical band of trim down each leaf, and a handle.
      slab(side * (doorW / 4 + 0.03), halfD - 0.74, doorW / 2 - 0.34, 0.04, 2.5, 0.25, trimMat, null);
      slab(side * 0.22, halfD - 0.78, 0.07, 0.07, 0.5, 1.0, trimMat, null);
    }
    slab(0, halfD - 0.62, doorW + 0.5, 0.34, 0.22, 3.0, trimMat, null);
    group.add(sign('TO THE CASINO', 0, 3.9, halfD - 0.78, theme.neon, 4.6, Math.PI));
    sites.points.push({ at: new THREE.Vector3(0, 4.4, halfD - 2.4),
                        colour: theme.neon, intensity: 11, distance: 8 });
    anchors.push({
      kind: 'fixture', action: 'limo', label: 'The limo',
      position: new THREE.Vector3(0, 0, halfD - 0.62),
      rotationY: 0,
      half: { hw: doorW / 2, hd: 0.5 },
      stand: new THREE.Vector3(0, 0, halfD - 2.4),   // within arm's reach of the doors
      focus: new THREE.Vector3(0, 2.4, halfD - 0.62),
    });

    /* The crate you wake up in.

       Every day starts the same way in the game this follows: you come round
       inside a packing box in the yard, with the lid up and the limo already
       running. Its walls are solid and shin-high on the inside, so stepping
       out is a step rather than a puzzle -- a box you have to work out how to
       escape is a joke that stops being funny on day two. */
    const crate = { x: -halfW + 4.2, z: halfD - 5.0, w: 1.9, d: 1.9, h: 0.62 };
    const crateMat = track(new THREE.MeshStandardMaterial({
      color: 0x6b4a2a, roughness: 0.92,
    }));
    /* Three sides and a fallen one.

       A crate with four walls is a box you cannot get out of: the controller
       has no step-up, so shin-high and impassable are the same thing, and the
       first version of this held the player in a two-metre square for the rest
       of the run. The side facing the yard has dropped flat, which is both the
       way out and the reason the lid is off. */
    for (const [dx, dz, ww, dd] of [
      [-crate.w / 2, 0, 0.12, crate.d], [crate.w / 2, 0, 0.12, crate.d],
      [0, -crate.d / 2, crate.w, 0.12]]) {
      slab(crate.x + dx, crate.z + dz, ww, dd, crate.h, 0, crateMat, 'crate');
    }
    const fallen = new THREE.Mesh(
      track(new THREE.BoxGeometry(crate.w, 0.11, crate.d * 0.85)), crateMat
    );
    fallen.position.set(crate.x, 0.055, crate.z + crate.d / 2 + crate.d * 0.42);
    fallen.receiveShadow = true;
    group.add(fallen);
    // The lid, thrown back against the side.
    const lid = new THREE.Mesh(
      track(new THREE.BoxGeometry(crate.w, 0.09, crate.d)), crateMat
    );
    lid.position.set(crate.x - crate.w * 0.62, crate.h + 0.5, crate.z);
    lid.rotation.z = -1.15;
    lid.castShadow = true;
    group.add(lid);
    group.add(sign('WAKE UP', crate.x, 1.55, crate.z - crate.d / 2 - 0.1,
      theme.neon, 1.6, 0));

    /* Something to climb on, on the way to the doors.

       The movement grew a jump, a landing and air control that barely steers,
       and until now the only thing in the building to use them on was a flat
       carpet. A run of crates and a beam across the yard is where you find out
       what the controls do, and there is a ticket on the far end so that
       finding out is worth doing rather than a thing to look at. */
    const jumps = [];
    const course = [
      { x: -6.5, z: 6.0, w: 1.7, d: 1.7, h: 0.55 },
      { x: -3.4, z: 5.2, w: 1.5, d: 1.5, h: 1.05 },
      { x: -0.4, z: 6.4, w: 1.4, d: 1.4, h: 1.55 },
      { x: 2.8, z: 5.4, w: 1.3, d: 1.3, h: 2.05 },
      { x: 6.2, z: 6.2, w: 2.2, d: 1.2, h: 2.45 },
    ];
    for (const b of course) {
      slab(b.x, b.z, b.w, b.d, b.h, 0, crateMat, 'crate');
      // A lip of trim on the top edge, so the height reads before you jump.
      slab(b.x, b.z, b.w + 0.1, b.d + 0.1, 0.05, b.h, trimMat, null);
      jumps.push(b);
    }
    const top = course[course.length - 1];
    anchors.push({
      kind: 'fixture', action: 'prize', label: 'Somebody left a ticket up here',
      position: new THREE.Vector3(top.x, top.h, top.z),
      rotationY: 0,
      half: { hw: top.w / 2, hd: top.d / 2 },
      // Standing at the foot of the last box reaches it horizontally, which
      // would make the climb decorative. `needsY` is what makes it a climb.
      needsY: top.h - 0.25,
      stand: new THREE.Vector3(top.x, top.h, top.z - top.d / 2 - 0.5),
      focus: new THREE.Vector3(top.x, top.h + 0.4, top.z),
    });
    const prize = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.17, 0.055, 10, 22)),
      track(new THREE.MeshStandardMaterial({
        color: 0xe9b44c, metalness: 0.85, roughness: 0.25,
        emissive: 0x6b4a10, emissiveIntensity: 0.6,
      }))
    );
    prize.position.set(top.x, top.h + 0.42, top.z);
    prize.rotation.x = Math.PI / 2;
    group.add(prize);
    sites.points.push({ at: new THREE.Vector3(top.x, top.h + 1.0, top.z),
                        colour: 0xffd27a, intensity: 8, distance: 6 });

    // Somewhere to stand about. A rug and a low table, so the middle of the
    // room is not an empty square.
    const rug = new THREE.Mesh(
      track(new THREE.CircleGeometry(3.4, 40)),
      track(new THREE.MeshStandardMaterial({ color: 0x3a2118, roughness: 0.98 }))
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(2.5, 0.014, 1.5);
    rug.receiveShadow = true;
    group.add(rug);
    slab(2.5, 1.5, 1.6, 1.0, 0.45, 0, trimMat, 'table');
    for (const [dx, dz] of [[-2.4, 0], [2.4, 0], [0, 2.2]]) {
      slab(2.5 + dx, 1.5 + dz, 1.5, 0.8, 0.45, 0, wallMat, 'seat');
    }

    mergeStatic(group);

    return {
      group, solids, anchors, theme, sites,
      lift: { x: 0, z: halfD - 1.6, w: doorW, d: 1.6 },
      // Inside the crate, looking out across the yard at the limo.
      spawn: { x: -halfW + 4.2, z: halfD - 5.0, angle: Math.PI * 0.78 },
      crate,
      jumps,
      size: { w: W, d: D, height: WALL_H },
      name: 'The Yard',
      isLobby: true,
      dispose() { for (const t of disposables) if (t.dispose) t.dispose(); },
    };
  }

  /* A soft round gradient, drawn once and shared. Squared falloff rather than
     linear, because a linear ramp reads as a disc with a hard edge. */
  let glowCanvas = null;
  function glowTexture() {
    if (!glowCanvas) {
      glowCanvas = document.createElement('canvas');
      glowCanvas.width = glowCanvas.height = 128;
      const g = glowCanvas.getContext('2d');
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.42)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    }
    const tex = new THREE.CanvasTexture(glowCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  global.GWLevel = { build, buildLobby, sign, mergeStatic, FOOTPRINT, THEME, SIZE, WALL_H };
})(window);
