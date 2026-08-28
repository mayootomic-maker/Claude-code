/* Three real reels.

   Each reel is a drum: fourteen symbol models stood around a circle, facing
   out, and the drum turns about its own axis. Spinning is a rotation with real
   angular velocity that decays into its stop, then overshoots and springs back
   the way a mechanical reel does when the brake catches.

   The paytable's return is not asserted, it is enumerated: all 14^3 stops are
   walked at load and the resulting RTP is what the odds panel prints. */

(function () {
  'use strict';

  // The strip. Every reel carries the same one, which is what makes the
  // enumeration below a simple cube rather than a per-reel product.
  const STRIP = [
    'cherry', 'horseshoe', 'bar', 'bell', 'cherry', 'horseshoe', 'seven',
    'bar', 'cherry', 'bell', 'horseshoe', 'diamond', 'bar', 'skull',
  ];

  const SYMBOL = {
    cherry: { model: 'sym_cherry', name: 'Cherries', scale: 1.00 },
    horseshoe: { model: 'sym_horseshoe', name: 'Horseshoe', scale: 1.00 },
    bar: { model: 'sym_bar', name: 'Bar', scale: 1.05 },
    bell: { model: 'sym_bell', name: 'Bell', scale: 0.95 },
    diamond: { model: 'sym_diamond', name: 'Diamond', scale: 0.92 },
    seven: { model: 'sym_seven', name: 'Seven', scale: 1.00 },
    skull: { model: 'sym_skull', name: 'Skull', scale: 0.98 },
  };

  /* Three of a kind, then the cherry consolations. Highest match wins and only
     one line pays, so the enumeration below is exact rather than approximate. */
  // Tuned against the enumeration below to 94.2% return -- a real machine's
  // number. The first attempt paid 119%, which the enumeration caught and no
  // amount of playtesting would have.
  const TRIPLE = {
    skull: 320, seven: 260, diamond: 120, bell: 30, bar: 10, horseshoe: 7, cherry: 8,
  };
  const TWO_CHERRY = 1.8;
  const ONE_CHERRY = 0.4;

  function STRIP_LENGTH() { return 14; }

  function scoreStops(a, b, c) {
    if (a === b && b === c) return TRIPLE[a] || 0;
    const cherries = [a, b, c].filter((s) => s === 'cherry').length;
    if (cherries === 2) return TWO_CHERRY;
    if (cherries === 1) return ONE_CHERRY;
    return 0;
  }

  /* Walk every stop combination once, at load. 2744 iterations. */
  const TABLE = (function enumerate() {
    const n = STRIP.length;
    let total = 0;
    const hits = {};
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        for (let k = 0; k < n; k++) {
          const pay = scoreStops(STRIP[i], STRIP[j], STRIP[k]);
          total += pay;
          if (pay > 0) hits[pay] = (hits[pay] || 0) + 1;
        }
      }
    }
    const combos = n * n * n;
    return { rtp: total / combos, combos, hits };
  })();

  /* Drum geometry.

     Fourteen symbols have to sit around the drum without touching, so the
     circumference has to be fourteen symbol-heights: radius = 14h / 2pi. With a
     0.26 symbol that is 0.58, and a window three symbols tall is 0.78. The
     first version picked the radius and the symbol size independently and the
     symbols overlapped into a wall of fruit. */
  const SYMBOL_H = 0.26;
  const RADIUS = (STRIP_LENGTH() * SYMBOL_H) / (Math.PI * 2);
  const REEL_X = [-0.46, 0, 0.46];
  const DRUM_Y = 1.02;
  // The drums sit back far enough that a symbol at the front of its arc is
  // still inside the cabinet. At z = 0 they poked through the machine's face.
  const DRUM_Z = -0.18;
  const CAB_D = 1.34;
  const CAB_Z = -0.22;                       // front face lands at 0.45
  const WINDOW = { w: 1.62, h: 0.80 };

  GWGames.register({
    id: 'slots',
    name: 'Three Drums',
    icon: '🎰',
    floor: 0,
    blurb: 'Fourteen stops on each drum and one payline. The skull turns up once '
         + 'in every two and a half thousand spins and pays for the fortnight.',
    bets: [
      { id: 'spin', label: 'Spin', pays: TABLE.rtp, prob: 1,
        note: 'One line. The reels decide everything.' },
    ],
    paysAsRtp: true,

    oddsRows() {
      const n = STRIP.length;
      const rows = [];
      for (const key of Object.keys(TRIPLE)) {
        const c = STRIP.filter((s) => s === key).length;
        rows.push({ label: SYMBOL[key].name + ' ×3', pays: TRIPLE[key], prob: Math.pow(c / n, 3) });
      }
      const p = STRIP.filter((s) => s === 'cherry').length / n;
      rows.push({ label: 'Two cherries', pays: TWO_CHERRY, prob: 3 * p * p * (1 - p) });
      rows.push({ label: 'One cherry', pays: ONE_CHERRY, prob: 3 * p * (1 - p) * (1 - p) });
      return rows;
    },

    /* All 14^3 stop combinations, scored by the same scoreStops() the machine
       pays by. The declared "pays" for the single Spin bet is the return, so
       this checks the machine's actual RTP rather than a hit rate. */
    verify() {
      const n = STRIP.length;
      let total = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          for (let k = 0; k < n; k++) total += scoreStops(STRIP[i], STRIP[j], STRIP[k]);
        }
      }
      return [{ id: 'spin', prob: 1, pays: total / (n * n * n) }];
    },

    build(ctx) {
      const g = new THREE.Group();

      const FLOOR = GWStage.FLOOR_Y;
      // Low clearcoat on purpose: a glossy coat on the inside faces of the
      // window frame mirrors the room and turns a dark red cabinet's interior
      // pale grey.
      const shellMat = new THREE.MeshStandardMaterial({
        color: 0x3d1017, roughness: 0.52, metalness: 0.08,
      });
      const trimMat = new THREE.MeshStandardMaterial({
        color: 0xb08234, metalness: 1, roughness: 0.26,
      });

      const box = (w, h, d, x, y, z, mat) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
        return m;
      };

      // The machine: a base that reaches the carpet, and a head with a hole in
      // it. The hole is made of four panels rather than a boolean, which is
      // both cheaper and how a real cabinet is built.
      const baseTop = 0.40;
      const baseH = baseTop - FLOOR;
      box(2.05, baseH, CAB_D, 0, FLOOR + baseH / 2, CAB_Z, shellMat);
      box(2.15, 0.10, CAB_D + 0.10, 0, FLOOR + 0.05, CAB_Z, trimMat);

      // A sloped shelf where the buttons would be.
      const shelf = box(1.90, 0.09, 0.42, 0, baseTop + 0.02, 0.40, trimMat);
      shelf.rotation.x = -0.34;

      const HALF = 1.025;                       // half the cabinet's width
      const winL = -WINDOW.w / 2, winR = WINDOW.w / 2;
      const winB = DRUM_Y - WINDOW.h / 2, winT = DRUM_Y + WINDOW.h / 2;
      const headTop = 1.78;
      const headH = headTop - baseTop;
      const sideW = HALF + winL;                // == HALF - WINDOW.w / 2
      box(sideW, headH, CAB_D, (-HALF + winL) / 2, (baseTop + headTop) / 2, CAB_Z, shellMat);
      box(sideW, headH, CAB_D, (HALF + winR) / 2, (baseTop + headTop) / 2, CAB_Z, shellMat);
      box(WINDOW.w, winB - baseTop, CAB_D, 0, (baseTop + winB) / 2, CAB_Z, shellMat);
      box(WINDOW.w, headTop - winT, CAB_D, 0, (winT + headTop) / 2, CAB_Z, shellMat);
      box(2.15, 0.10, CAB_D + 0.06, 0, headTop + 0.05, CAB_Z, trimMat);

      // Back panel, so the window shows a lit interior rather than the room.
      box(WINDOW.w, WINDOW.h, 0.04, 0, DRUM_Y, CAB_Z - CAB_D / 2 + 0.04,
          new THREE.MeshStandardMaterial({ color: 0x120b0a, roughness: 1 }));

      // Illuminated sign on top.
      const sign = box(1.70, 0.46, 0.14, 0, headTop + 0.35, -0.05,
        new THREE.MeshStandardMaterial({
          color: 0x2a0d12, emissive: 0xd9a441, emissiveIntensity: 0.55, roughness: 0.6,
        }));
      sign.castShadow = false;
      g.add(signFace('THREE DRUMS', 1.62, 0.40, 0, headTop + 0.35, CAB_Z + 0.09));

      const glow = new THREE.PointLight(0xffc98a, 1.5, 2.8);
      glow.position.set(0, DRUM_Y + 0.30, 0.30);
      g.add(glow);

      const hubMat = new THREE.MeshStandardMaterial({ color: 0x141010, roughness: 0.5, metalness: 0.3 });
      const hubGeo = new THREE.CylinderGeometry(RADIUS * 0.42, RADIUS * 0.42, 0.40, 24);

      // Stop 0 starts on the payline. The drum's front -- where the window is
      // -- is a quarter turn round from its top, so an angle of zero puts the
      // gap between two symbols in the window rather than a symbol.
      const reels = REEL_X.map((x) => {
        const drum = new THREE.Group();
        drum.position.set(x, DRUM_Y, DRUM_Z);
        const hub = new THREE.Mesh(hubGeo, hubMat);
        hub.rotation.z = Math.PI / 2;
        drum.add(hub);

        const holders = STRIP.map((key, i) => {
          const a = (i / STRIP.length) * Math.PI * 2;
          const holder = new THREE.Group();
          const mesh = ctx.model(SYMBOL[key].model);
          mesh.scale.setScalar(SYMBOL_H * SYMBOL[key].scale);
          holder.add(mesh);
          holder.position.set(0, Math.cos(a) * RADIUS, Math.sin(a) * RADIUS);
          holder.rotation.x = -a;
          holder.userData.a = a;
          drum.add(holder);
          return holder;
        });
        g.add(drum);
        return { drum, holders, angle: Math.PI / 2 };
      });

      // Payline across the glass, and the glass itself.
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(WINDOW.w, 0.010, 0.010),
        new THREE.MeshBasicMaterial({ color: 0xe9b44c })
      );
      line.position.set(0, DRUM_Y, 0.44);
      g.add(line);

      // No glass pane. A near-transparent physical material still reflects the
      // whole room and read as a grey slab hanging across the window; the frame
      // and the payline already say "behind glass" without costing a mirror.

      ctx.mount(g);
      ctx.view([0, 0.95, 4.25], [0, 0.62, 0]);

      /* Fourteen symbols on each of three drums is forty-two models, and at any
         moment about two thirds of them are round the back of the drum where
         the cabinet hides them. Drawing them anyway cost two hundred draw calls
         and a quarter of a million triangles for a machine showing nine
         symbols. A drum position is visible when sin(a + angle) is positive --
         that is where the payline is -- so everything else is switched off. */
      const stop = ctx.stage.onTick(() => {
        for (const r of reels) {
          r.drum.rotation.x = r.angle;
          for (const holder of r.holders) {
            holder.visible = Math.sin(holder.userData.a + r.angle) > -0.12;
          }
        }
      });

      return { reels, root: g, dispose() { stop(); hubGeo.dispose(); hubMat.dispose(); } };
    },

    async play(ctx, handle, bet) {
      const store = ctx.store;
      let stops = drawStops(ctx, store);
      let respun = false;

      if (scoreStops(STRIP[stops[0]], STRIP[stops[1]], STRIP[stops[2]]) === 0
          && store.has('secondwind') && store.useDaily('secondwind')) {
        respun = true;
      }

      await spin(ctx, handle, stops);

      if (respun) {
        ctx.announce('Second Wind kicks the drums over again.', 'good');
        stops = drawStops(ctx, store);
        await spin(ctx, handle, stops, 0.75);
      }

      const faces = stops.map((i) => STRIP[i]);
      const pay = scoreStops(faces[0], faces[1], faces[2]);
      const names = faces.map((f) => SYMBOL[f].name);
      const jackpot = pay >= 50;
      ctx.audio.play(pay === 0 ? 'lose' : jackpot ? 'big' : 'win');

      return {
        multiplier: pay,
        detail: { faces },
        headline: pay === 0 ? names.join(' · ') : (pay >= 6 ? names[0].toUpperCase() + ' ×3' : names.join(' · ')),
        tone: pay === 0 ? 'lose' : jackpot ? 'huge' : 'win',
      };
    },
  });

  /* The lit sign on top of the machine. Canvas on a plane: extruded text would
     be several hundred triangles of curve geometry to read eleven letters. */
  function signFace(text, w, h, x, y, z) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = '#ffe6b0';
    g.font = '700 76px "Bebas Neue", Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    mesh.position.set(x, y, z);
    return mesh;
  }

  /* Each drum decelerates on its own timetable and lands slightly late, which
     is the whole reason a slot machine is tense: the third reel is still moving
     after the first two have told you what you need. */
  async function spin(ctx, handle, stops, speedScale) {
    const scale = speedScale || 1;
    const step = (Math.PI * 2) / STRIP.length;
    const spins = [0, 1, 2].map((i) => {
      const reel = handle.reels[i];
      // Symbol i is on the payline when its own angle plus the drum's equals a
      // quarter turn, which is where the window is.
      const target = Math.PI / 2 - stops[i] * step;
      // Whole revolutions only. A fractional count leaves the drum a fraction
      // of a symbol short of its stop -- which is not enough to look broken,
      // just enough that the payline never quite lines up with anything, on
      // every spin, forever.
      const turns = Math.round(4 + i * 1.4 + ctx.rng.float(0, 1.6));
      const from = reel.angle;
      // Land exactly on the stop by measuring the shortest wrap to it and then
      // adding whole turns, rather than spinning "about" the right place.
      let delta = target - (from % (Math.PI * 2));
      while (delta > 0) delta -= Math.PI * 2;
      return { reel, from, delta: delta - turns * Math.PI * 2, dur: (1.45 + i * 0.55) * scale };
    });

    const total = Math.max.apply(null, spins.map((s) => s.dur)) + 0.42 * scale;
    let clack = 0;
    let landed = [false, false, false];
    ctx.audio.play('reel');

    await ctx.animate(total, (_, dt, t) => {
      clack += dt;
      if (clack > 0.055) { clack = 0; ctx.audio.play('tick'); }
      spins.forEach((s, i) => {
        const p = Math.min(t / s.dur, 1);
        // Quintic ease-out into the stop, then a short spring past it.
        const eased = 1 - Math.pow(1 - p, 5);
        let angle = s.from + s.delta * eased;
        if (p >= 1) {
          const over = Math.min((t - s.dur) / 0.42, 1);
          angle = s.from + s.delta + Math.sin(over * Math.PI * 2.5) * 0.055 * (1 - over);
          if (!landed[i]) { landed[i] = true; ctx.audio.play('chip'); }
        }
        s.reel.angle = angle;
      });
    }, GWGames.EASE.linear);

    spins.forEach((s) => { s.reel.angle = s.from + s.delta; });
  }

  function drawStops(ctx, store) {
    const n = STRIP.length;
    const mods = store.s.mods;
    const want = mods.alwaysWin ? true : mods.alwaysLose ? false : null;
    for (let attempt = 0; attempt < 600; attempt++) {
      const s = [ctx.rng.int(0, n - 1), ctx.rng.int(0, n - 1), ctx.rng.int(0, n - 1)];
      if (want === null) return s;
      const paid = scoreStops(STRIP[s[0]], STRIP[s[1]], STRIP[s[2]]) > 0;
      if (paid === want) return s;
    }
    // Rejection cannot find a paying line quickly enough: build one directly
    // rather than hand back a spin that ignores the mod that was switched on.
    const key = ctx.rng.pick(Object.keys(TRIPLE));
    const idx = STRIP.map((sym, i) => (sym === key ? i : -1)).filter((i) => i >= 0);
    return want ? [ctx.rng.pick(idx), ctx.rng.pick(idx), ctx.rng.pick(idx)] : [0, 1, 2];
  }

})();
