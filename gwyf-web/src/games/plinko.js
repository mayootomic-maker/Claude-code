/* Plinko -- a real board, dropped through for real.

   Nothing here decides where the ball goes. It is released with a fraction of a
   millimetre of jitter and after that the pegs have it. Which means the payout
   table cannot be derived from a binomial: round pegs and a bouncy ball give a
   distribution with fatter shoulders and much thinner tails than coin flips
   would. The numbers below were measured over three thousand drops of this
   exact board (tools/odds.mjs re-measures them), and the multipliers were then
   set to return 94%. */

(function () {
  'use strict';

  const ROWS = 12;
  const PITCH = 0.34;
  const SLOTS = ROWS + 1;

  // Measured, symmetric about the middle. Index 6 is the centre slot.
  const MEASURED = [0.00465, 0.00900, 0.02165, 0.04750, 0.11570, 0.19500, 0.21300,
                    0.19500, 0.11570, 0.04750, 0.02165, 0.00900, 0.00465];
  const PAYS = [26, 7.5, 2.9, 1.15, 0.65, 0.35, 0.2, 0.35, 0.65, 1.15, 2.9, 7.5, 26];
  const RTP = MEASURED.reduce((sum, p, i) => sum + p * PAYS[i], 0);

  const SLOT_COLOUR = (i) => {
    const m = PAYS[i];
    if (m >= 20) return 0xe8505f;
    if (m >= 5) return 0xe9b44c;
    if (m >= 1) return 0x5cd98c;
    return 0x3a2c28;
  };

  GWGames.register({
    id: 'plinko',
    name: 'The Drop',
    icon: '🎯',
    floor: 1,
    blurb: 'One ball, twelve rows of brass, and thirteen ways down. The middle is '
         + 'where it wants to go and the middle is where the money is not.',
    bets: [
      { id: 'drop', label: 'Drop the ball', pays: RTP, prob: 1,
        note: 'Where it lands is the board’s business, not the house’s.' },
    ],
    paysAsRtp: true,

    oddsRows() {
      return PAYS.map((m, i) => ({
        label: 'Pocket ' + (i - 6 === 0 ? 'centre' : (i < 6 ? 'L' : 'R') + Math.abs(i - 6)),
        pays: m, prob: MEASURED[i],
      })).filter((r, i) => i <= 6);
    },

    /* Drop real balls through the real board and count where they land.

       This is the only game whose odds cannot be enumerated -- they come out of
       the physics -- so the published MEASURED table has to be re-measured, and
       the return recomputed from what the board actually does. */
    verify(rng, drops) {
      const board = GWPhysics.plinkoBoard(ROWS, PITCH);
      const counts = new Array(SLOTS).fill(0);
      const n = drops || 4000;
      for (let i = 0; i < n; i++) counts[GWPhysics.dropPlinko({ board, rng }).slot]++;
      const seen = counts.map((c) => c / n);
      return [{
        id: 'drop', prob: 1,
        pays: seen.reduce((sum, p, i) => sum + p * PAYS[i], 0),
        distribution: seen,
        published: MEASURED,
      }];
    },

    build(ctx) {
      const board = GWPhysics.plinkoBoard(ROWS, PITCH);
      const g = new THREE.Group();
      g.add(GWStage.room({ accent: '#e8505f' }));

      const FLOOR = GWStage.FLOOR_Y;
      /* The physics board is built at its own scale and the visuals are scaled
         to fit the shot -- not the other way round. Shrinking the pitch to make
         the board fit would change the ball's size and bounce relative to the
         pegs, and the measured payout distribution above is for this board at
         this pitch. Scaling the rig moves nothing in the simulation. */
      const SCALE = 0.72;
      const LIFT = 3.25;
      const rig = new THREE.Group();
      rig.position.y = LIFT;
      rig.scale.setScalar(SCALE);
      g.add(rig);

      const floorY = board.bottom + PITCH * 0.55;
      const boardTop = PITCH * 3.2;
      const caseH = boardTop - floorY + 0.5;
      const caseW = board.wallX * 2 + 0.34;

      const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a1a16, roughness: 0.55, metalness: 0.15 });
      const backing = new THREE.Mesh(
        new THREE.BoxGeometry(caseW, caseH, 0.18),
        new THREE.MeshStandardMaterial({ color: 0x140d0c, roughness: 0.9 })
      );
      backing.position.set(0, (boardTop + floorY) / 2 - 0.2, -0.20);
      backing.receiveShadow = true;
      rig.add(backing);

      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.16, caseH, 0.42), frameMat);
        side.position.set(sx * (board.wallX + 0.09), (boardTop + floorY) / 2 - 0.2, -0.02);
        side.castShadow = true;
        rig.add(side);
      }
      for (const [y, h] of [[boardTop + 0.18, 0.20], [floorY - 0.62, 0.22]]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(caseW, h, 0.42), frameMat);
        bar.position.set(0, y, -0.02);
        bar.castShadow = true;
        rig.add(bar);
      }

      // The plinth: from the bottom of the case down to the carpet.
      const plinthTop = LIFT + (floorY - 0.73) * SCALE;
      const plinthH = plinthTop - FLOOR;
      const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(caseW * SCALE * 0.62, plinthH, 0.60),
        new THREE.MeshStandardMaterial({ color: 0x1b1210, roughness: 0.8 })
      );
      plinth.position.set(0, FLOOR + plinthH / 2, -0.02);
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      g.add(plinth);

      // Pegs share one geometry and one material: ninety-one draw calls of the
      // same brass pin is one InstancedMesh's worth of work.
      const pegGeo = new THREE.CylinderGeometry(PITCH * 0.19, PITCH * 0.19, 0.16, 12);
      const pegMat = new THREE.MeshStandardMaterial({ color: 0xb08234, metalness: 1, roughness: 0.24 });
      const pins = new THREE.InstancedMesh(pegGeo, pegMat, board.pegs.length);
      pins.castShadow = true;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      board.pegs.forEach((peg, i) => {
        m.compose(new THREE.Vector3(peg.x, peg.y, 0), q, new THREE.Vector3(1, 1, 1));
        pins.setMatrixAt(i, m);
      });
      pins.instanceMatrix.needsUpdate = true;
      rig.add(pins);

      for (let i = 0; i < SLOTS; i++) {
        const x = (i - board.half + 0.5) * PITCH;
        const pocket = new THREE.Mesh(
          new THREE.BoxGeometry(PITCH * 0.94, PITCH * 0.9, 0.30),
          new THREE.MeshStandardMaterial({
            color: SLOT_COLOUR(i), roughness: 0.5,
            emissive: SLOT_COLOUR(i), emissiveIntensity: 0.22,
          })
        );
        pocket.position.set(x, floorY, 0);
        rig.add(pocket);
        rig.add(label(PAYS[i] + '×', x, floorY - PITCH * 0.72, PITCH * 1.02));
      }
      for (let i = 0; i <= SLOTS; i++) {
        const divider = new THREE.Mesh(
          new THREE.BoxGeometry(0.032, PITCH * 1.5, 0.28),
          new THREE.MeshStandardMaterial({ color: 0xb08234, metalness: 1, roughness: 0.3 })
        );
        divider.position.set((i - board.half) * PITCH, floorY + PITCH * 0.24, 0);
        rig.add(divider);
      }

      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(PITCH * 0.26, 20, 14),
        new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.08 })
      );
      ball.castShadow = true;
      ball.visible = false;
      rig.add(ball);

      ctx.group.add(g);
      ctx.stage.frame([0, 2.40, 6.15], [0, 2.25, 0], 3.0);

      return { board, ball, root: g, dispose() { pegGeo.dispose(); pegMat.dispose(); } };
    },

    async play(ctx, handle, bet) {
      const store = ctx.store;
      // The magnet does not move the ball in flight. It leans on the release,
      // which is the only thing anybody could actually tamper with.
      const bias = store.has('magnet') ? (ctx.rng.chance(0.5) ? 0.55 : -0.55) : 0;
      const drop = GWPhysics.dropPlinko({ board: handle.board, rng: ctx.rng, bias });

      handle.ball.visible = true;
      let played = 0, lastPeg = 0;
      ctx.audio.play('whoosh');
      await ctx.until((dt) => {
        played += dt;
        lastPeg += dt;
        const done = GWPhysics.applyPlinko(drop, handle.ball, played);
        if (lastPeg > 0.13) { lastPeg = 0; ctx.audio.play('tick'); }
        return done;
      });

      const pay = PAYS[drop.slot];
      ctx.audio.play(pay >= 5 ? 'big' : pay >= 1 ? 'win' : 'lose');
      await ctx.wait(0.45);
      handle.ball.visible = false;

      return {
        multiplier: pay,
        detail: { slot: drop.slot },
        headline: pay + '×',
        tone: pay >= 5 ? 'huge' : pay > 1 ? 'win' : pay === 1 ? 'push' : 'lose',
      };
    },
  });

  /* Multiplier labels as canvas planes. Extruded text would be another 13
     meshes of curve geometry to read four characters. */
  function label(text, x, y, width) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#120e0d';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#f2ebe6';
    g.font = '700 34px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width * 0.5),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    mesh.position.set(x, y, 0.18);
    return mesh;
  }
})();
