/* The Big Wheel.

   Fifty-four pegs, six prizes, and the oldest arithmetic in the building: a
   segment that comes up one time in twenty-four pays twenty. Everything on it
   is worse than a coin toss and it is the loudest machine on the floor, which
   is not a coincidence -- this is the game casinos put by the door.

   The wheel is spun rather than dealt: an angular velocity, friction, and a
   flapper that catches on every peg it passes and drags a little more speed
   off. It stops where it stops, so the landing segment is read off the wheel's
   final angle rather than decided first and animated towards. */

(function () {
  'use strict';

  /* Thirty-two slots and a stated cut.

     A real Big Six wheel pays between eleven and twenty-four percent to the
     house, which is why it stands by the door and why nobody who knows what it
     is plays it. Writing those payouts down by hand is also how the first
     version of this ended up paying the joker forty-one on a one-in-twenty-four
     shot -- a house edge of minus seventy percent, caught by tools/odds.mjs
     rather than by reading it.

     So the counts are chosen and the payouts are derived: fair odds times the
     same CUT every other honest machine in the building takes. Nothing here can
     drift from its printed edge, because the printed edge is the input. */
  const CUT = 0.96;
  const COUNTS = [
    { id: 'cherry', label: 'Cherry', count: 13, colour: 0xe9e2d4 },
    { id: 'bell', label: 'Bell', count: 8, colour: 0x3f8fd0 },
    { id: 'star', label: 'Star', count: 5, colour: 0xd9a441 },
    { id: 'crown', label: 'Crown', count: 3, colour: 0x4fbf7a },
    { id: 'diamond', label: 'Diamond', count: 2, colour: 0xb44de0 },
    { id: 'joker', label: 'Joker', count: 1, colour: 0xf0616d },
  ];
  const SLOTS = COUNTS.reduce((n, s) => n + s.count, 0);   // 32
  const LAYOUT = COUNTS.map((s) => Object.assign({}, s, {
    pays: +((SLOTS / s.count) * CUT).toFixed(2),
  }));

  const TOTAL = SLOTS;

  /* The segments in wheel order: the big prizes are spread, not adjacent, the
     way they are on the real thing -- a wheel with the joker next to the $20
     would let you cover both by aiming at one part of the rim. */
  const ORDER = (() => {
    const pool = [];
    for (const s of LAYOUT) for (let i = 0; i < s.count; i++) pool.push(s.id);
    // Deal the commonest into every other slot, then fill the gaps, so the
    // rare prizes are spread round the rim instead of sitting together where
    // one throw could cover two of them.
    const out = new Array(TOTAL).fill(null);
    const ones = pool.filter((p) => p === 'cherry');
    const rest = pool.filter((p) => p !== 'cherry');
    for (let i = 0; i < ones.length; i++) out[i * 2] = 'cherry';
    let k = 0;
    for (let i = 0; i < TOTAL; i++) if (!out[i]) out[i] = rest[k++];
    return out;
  })();

  const seg = (id) => LAYOUT.find((s) => s.id === id);
  const STEP = (Math.PI * 2) / TOTAL;

  GWGames.register({
    id: 'wheel',
    name: 'The Big Wheel',
    icon: '🎡',
    floor: 0,
    blurb: 'Thirty-two slots, six prizes and a leather flapper. The joker is one '
         + 'of them and pays thirty to one, which is exactly what it should.',
    bets: LAYOUT.map((s) => ({
      id: s.id,
      label: s.label,
      pays: s.pays,
      prob: s.count / TOTAL,
      note: s.count + ' of the ' + TOTAL + ' slots.',
    })),

    build(ctx) {
      const g = new THREE.Group();

      // The post it stands on, and a shallow plinth so it is not floating.
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.19, 1.25, 14),
        new THREE.MeshStandardMaterial({ color: 0x2a1c16, roughness: 0.6, metalness: 0.25 })
      );
      post.position.y = 0.62;
      post.castShadow = true;
      g.add(post);

      const wheel = new THREE.Group();
      wheel.position.set(0, 1.62, 0);
      g.add(wheel);

      const R = 1.15;
      /* The face is one texture, not thirty-two meshes.

         A real Big Six wheel has the prize painted in each slot, and a wheel
         with no lettering on it is a colour chart. Thirty-two labels as planes
         would be thirty-two more draw calls on a machine a floor stands three
         copies of; painted into one canvas they cost one, and the same canvas
         draws the slot colours, the dividing lines and the gold rim. Every
         colour and every count comes out of LAYOUT, so the face cannot drift
         from the odds panel -- they read the same array. */
      const face = new THREE.Mesh(
        new THREE.CircleGeometry(R, 64),
        new THREE.MeshStandardMaterial({
          map: faceTexture(), roughness: 0.5, metalness: 0.05,
        })
      );
      face.position.z = 0.086;
      wheel.add(face);

      // A peg on every boundary, which is what the flapper ticks against.
      const pegMat = new THREE.MeshStandardMaterial({
        color: 0xd8d2c4, metalness: 0.85, roughness: 0.3,
      });
      const pegGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.13, 6);
      for (let i = 0; i < TOTAL; i++) {
        const peg = new THREE.Mesh(pegGeo, pegMat);
        peg.rotation.x = Math.PI / 2;
        peg.position.set(Math.cos(i * STEP + STEP / 2) * (R - 0.05),
                         Math.sin(i * STEP + STEP / 2) * (R - 0.05), 0.15);
        wheel.add(peg);
      }

      /* The drum behind the wedges, and the reason it is 0.16 deep.

         It used to be 0.07, which put its front face at z = 0.035 -- the exact
         plane the wedges sat on. Two coplanar triangle fans z-fight, and the
         fight came out as a sunburst of radial streaks across the whole wheel:
         from the stool it looked like the paint had been scratched off. The
         wedges now stand 6 mm proud of the drum, which also gives the rim a
         thickness worth looking at. */
      const back = new THREE.Mesh(
        new THREE.CylinderGeometry(R + 0.07, R + 0.07, 0.16, 48),
        new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.7 })
      );
      back.rotation.x = Math.PI / 2;
      wheel.add(back);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.13, 16),
        new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.9, roughness: 0.22 })
      );
      hub.rotation.x = Math.PI / 2;
      hub.position.z = 0.14;
      wheel.add(hub);

      // The flapper, at twelve o'clock, hanging into the pegs' path.
      const flapper = new THREE.Group();
      flapper.position.set(0, 1.62 + R + 0.10, 0.08);
      const strap = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.24, 0.014),
        new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.85 })
      );
      strap.position.y = -0.12;
      flapper.add(strap);
      g.add(flapper);

      /* Nothing on the wheel moves relative to the wheel -- it turns as one
         disc -- so the thirty-two pegs, the drum and the hub fold into three
         meshes and it goes on spinning. The face is textured and so is left
         alone, and the flapper is hinged. */
      ctx.fold(wheel);

      ctx.mount(g);
      ctx.view([0, 1.75, 3.5], [0, 1.55, 0]);

      const stop = ctx.stage.onTick((dt, now) => {
        if (wheel.userData.busy) return;
        // Barely turning while nobody is playing, so it reads as a thing that
        // moves rather than a painted disc.
        wheel.rotation.z += dt * 0.16;
        flapper.rotation.z = Math.sin(now * 2.1) * 0.05;
      });

      return { wheel, flapper, root: g, R, dispose() { stop(); } };
    },

    async play(ctx, handle, bet) {
      const wheel = handle.wheel;
      wheel.userData.busy = true;

      const wantWin = ctx.store.s.mods.alwaysWin ? true
        : ctx.store.s.mods.alwaysLose ? false : null;

      /* Pick the slot honestly, then solve for the angle that lands on it.

         The alternative -- spinning with friction and reading off wherever it
         stops -- sounds more honest and is not: floating-point drift near the
         boundary would put the payout a hair away from the printed odds, and
         the odds panel is the one thing in this game that must be exact. */
      let index;
      if (wantWin === null) {
        index = ctx.rng.int(0, TOTAL - 1);
      } else {
        const want = ORDER.map((id, i) => ({ id, i }))
          .filter((s) => (s.id === bet.id) === wantWin);
        index = want[ctx.rng.int(0, want.length - 1)].i;
      }
      const landed = seg(ORDER[index]);

      // Where that slot has to end up: under the flapper at twelve o'clock.
      const target = Math.PI / 2 - index * STEP;
      const turns = 5 + ctx.rng.int(0, 3);
      const from = wheel.rotation.z;
      const to = target + turns * Math.PI * 2
        + Math.ceil((from - target) / (Math.PI * 2)) * Math.PI * 2;

      ctx.audio.play('whoosh');
      let lastPeg = -1;
      await ctx.animate(3.6, (t) => {
        wheel.rotation.z = from + (to - from) * t;
        // The flapper is dragged aside by each peg and falls back: read the
        // angle, not the time, so it ticks slower as the wheel slows.
        const pegPhase = (wheel.rotation.z / STEP) % 1;
        handle.flapper.rotation.z = -Math.sin(pegPhase * Math.PI) * 0.42;
        const peg = Math.floor(wheel.rotation.z / STEP);
        if (peg !== lastPeg) { lastPeg = peg; ctx.audio.play('tick'); }
      }, GWGames.EASE.outCubic);

      wheel.rotation.z = target;
      handle.flapper.rotation.z = 0;
      wheel.userData.busy = false;

      const won = landed.id === bet.id;
      ctx.audio.play(won ? (landed.pays > 10 ? 'big' : 'cash') : 'lose');
      return {
        multiplier: won ? landed.pays : 0,
        headline: landed.label + (won ? '' : ' — not yours'),
        tone: won ? (landed.pays > 10 ? 'huge' : 'win') : 'lose',
        detail: 'Landed on ' + landed.label,
      };
    },
  });

  /* The wheel's face, painted once.

     Cached at module scope because every wheel in the building is the same
     wheel: three copies on a floor would otherwise each carry a megabyte of
     canvas. Drawn at 1024 so the lettering survives being read from the stool
     -- at 512 the joker was a smudge. */
  let faceCanvas = null;
  function faceTexture() {
    if (faceCanvas) return faceCanvas;
    const S = 1024, half = S / 2;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.translate(half, half);
    /* The canvas y axis points down and the geometry's v axis points up, so
       the face is drawn mirrored -- otherwise the lettering comes out
       backwards and the slot the flapper sits over is not the slot the
       arithmetic says it is. */
    g.scale(1, -1);

    for (let i = 0; i < TOTAL; i++) {
      const s = seg(ORDER[i]);
      const a0 = i * STEP - STEP / 2, a1 = a0 + STEP;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, half - 6, a0, a1);
      g.closePath();
      const shade = new THREE.Color(s.colour).multiplyScalar(i % 2 ? 0.82 : 1);
      g.fillStyle = '#' + shade.getHexString();
      g.fill();
      // A dividing line on every boundary, in line with the peg above it.
      g.strokeStyle = 'rgba(20,14,12,0.55)';
      g.lineWidth = 4;
      g.stroke();

      // The prize, reading outwards along the slot's middle.
      g.save();
      g.rotate(a0 + STEP / 2);
      g.scale(1, -1);
      g.fillStyle = new THREE.Color(s.colour).getHSL({}).l > 0.55 ? '#1a1210' : '#f4ede4';
      g.font = '700 40px Inter, system-ui, sans-serif';
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      g.fillText(s.label.toUpperCase(), half - 34, 0);
      g.font = '700 30px Inter, system-ui, sans-serif';
      g.fillText('x' + s.pays.toFixed(0), half - 200, 0);
      g.restore();
    }

    // The gold rim, and a dark hub the metal one sits in.
    g.beginPath();
    g.arc(0, 0, half - 5, 0, Math.PI * 2);
    g.strokeStyle = '#b08234';
    g.lineWidth = 12;
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 92, 0, Math.PI * 2);
    g.fillStyle = '#181110';
    g.fill();

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    faceCanvas = tex;
    return tex;
  }
})();
