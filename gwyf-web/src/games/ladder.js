/* The Climb.

   Eight rungs. Each one is less likely to hold than the last, and each one pays
   exactly what the risk of it was worth, less four percent. Stop whenever. The
   top rung holds half the time and pays for the week.

   The interesting number is not any single rung, it is the eighth: a one in
   forty run for nineteen times the stake. */

(function () {
  'use strict';

  const CUT = 0.96;
  // Chance that each rung holds. Everything else is derived from these.
  const HOLD = [0.86, 0.82, 0.78, 0.72, 0.66, 0.60, 0.55, 0.50];

  /* Chance of still being on the ladder after rung i. */
  function reach(i) {
    let p = 1;
    for (let k = 0; k <= i; k++) p *= HOLD[k];
    return p;
  }

  /* What rung i pays.
     The cut is taken once, against the odds of getting this far -- not once per
     rung. Charging it per rung compounds it, and the first version of this
     ladder quietly reached a 28% house edge by the top while every other game
     in the building held at four. */
  const cumulative = (i) => CUT / reach(i);

  GWGames.register({
    id: 'ladder',
    name: 'The Climb',
    icon: '🪜',
    floor: 2,
    blurb: 'Eight rungs over a hole in the floor. Every one holds a little less '
         + 'well than the one below it and pays a little better.',
    bets: [
      { id: 'climb', label: 'Start climbing', pays: CUT, prob: 1,
        note: 'Come down whenever you like. Nobody ever does.' },
    ],
    paysAsRtp: true,
    skillBased: true,

    oddsRows() {
      return HOLD.map((_, i) => ({
        label: 'Rung ' + (i + 1), pays: +cumulative(i).toFixed(2), prob: reach(i),
      }));
    },

    build(ctx) {
      const g = new THREE.Group();

      const FLOOR = GWStage.FLOOR_Y;
      const RISE = 0.46, RUN = 0.30;
      const topY = 0.42 + (HOLD.length - 1) * RISE;

      // The hole the rungs cross. A ring rather than an open cylinder, so the
      // carpet does not simply carry on underneath and make the drop pointless.
      const lip = new THREE.Mesh(
        new THREE.RingGeometry(1.75, 3.4, 48),
        new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 1, side: THREE.DoubleSide })
      );
      lip.rotation.x = -Math.PI / 2;
      // Just proud of the room's carpet, which is now a solid plane at this
      // height -- coplanar, the two z-fight and the pit flickers.
      lip.position.y = FLOOR + 0.012;
      g.add(lip);
      const pit = new THREE.Mesh(
        new THREE.CylinderGeometry(1.75, 1.45, 3.2, 40, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x0a0706, roughness: 1, side: THREE.BackSide })
      );
      pit.position.y = FLOOR - 1.6;
      g.add(pit);

      // Two stringers carrying the rungs, standing on the floor at the near
      // edge. Rungs on their own read as steps floating over a hole.
      const railMat = new THREE.MeshStandardMaterial({ color: 0x2c2019, roughness: 0.6, metalness: 0.2 });
      const railLen = Math.hypot(topY - FLOOR, (HOLD.length - 1) * RUN + 0.9);
      const tilt = Math.atan2((HOLD.length - 1) * RUN + 0.9, topY - FLOOR);
      for (const sx of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.11, railLen, 0.11), railMat);
        rail.position.set(sx * 0.84, (FLOOR + topY) / 2, 0.62 - ((HOLD.length - 1) * RUN + 0.9) / 2);
        rail.rotation.x = -tilt;
        rail.castShadow = true;
        g.add(rail);
      }

      const rungs = HOLD.map((_, i) => {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1.62, 0.12, 0.56),
          new THREE.MeshStandardMaterial({ color: 0x3a2b22, roughness: 0.6, metalness: 0.1 })
        );
        mesh.position.set(0, 0.42 + i * RISE, 0.62 - i * RUN);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        g.add(mesh);
        g.add(rungLabel('×' + cumulative(i).toFixed(2), 1.05, mesh.position.y + 0.02, mesh.position.z));
        return mesh;
      });

      const ledge = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.20, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x241a15, roughness: 0.8 })
      );
      ledge.position.set(0, FLOOR + 0.10, 1.45);
      ledge.receiveShadow = true;
      g.add(ledge);

      const climber = ctx.model('chip25');
      climber.scale.setScalar(0.44);
      climber.rotation.x = Math.PI / 2;
      climber.position.set(0, FLOOR + 0.24, 1.45);
      g.add(climber);

      ctx.mount(g);
      ctx.view([2.30, 2.70, 4.85], [0.05, 1.25, -0.45]);

      /* The climber shifts its weight while it waits.

         A chip standing perfectly still on a ledge in front of a hole reads as
         a piece of scenery. A slow bob and a lean towards the first rung reads
         as something about to try, which is what the machine is asking you to
         pay for. */
      const home = climber.position.clone();
      let t = Math.random() * 6;
      const stop = ctx.stage.onTick((dt) => {
        if (climber.userData.busy) return;
        t += dt;
        climber.position.y = home.y + Math.sin(t * 1.5) * 0.035;
        climber.position.z = home.z - Math.max(0, Math.sin(t * 0.45)) * 0.10;
        climber.rotation.z = Math.sin(t * 0.9) * 0.06;
      });

      return { root: g, rungs, climber, home,
               layout: { RISE, RUN }, dispose() { stop(); } };
    },

    async play(ctx, handle, bet) {
      handle.rungs.forEach((r, i) => {
        r.material.color.setHex(0x3a2b22);
        r.material.emissive.setHex(0x000000);
        r.position.set(0, 0.42 + i * handle.layout.RISE, 0.62 - i * handle.layout.RUN);
        r.rotation.z = 0;
        r.visible = true;
      });
      // The waiting bob stops while the round runs; both move the same chip.
      handle.climber.userData.busy = true;
      handle.climber.position.copy(handle.home);
      handle.climber.rotation.set(Math.PI / 2, 0, 0);

      let step = 0;
      while (step < HOLD.length) {
        const next = cumulative(step);
        const options = [{
          id: 'up', label: 'Step up', tone: 'gold',
          hint: '×' + next.toFixed(2) + '  ·  holds ' + Math.round(HOLD[step] * 100) + '%',
        }];
        if (step > 0) {
          options.push({ id: 'down', label: 'Take ' + fmt(ctx.totalStake * cumulative(step - 1)),
                         tone: 'cash', hint: 'Climb back down with ×' + cumulative(step - 1).toFixed(2) });
        }
        ctx.setStatus(step === 0
          ? 'Eight rungs. The first one holds 86% of the time.'
          : 'Rung ' + step + '. ×' + cumulative(step - 1).toFixed(2) + ' riding.');
        ctx.live(step === 0 ? null : '×' + cumulative(step - 1).toFixed(2), 'win');

        const answer = await ctx.prompt({ options });
        if (answer.id === 'down') {
          ctx.live(null);
          await descend(ctx, handle);
          ctx.audio.play('cash');
          handle.climber.userData.busy = false;
          return { multiplier: cumulative(step - 1), headline: '×' + cumulative(step - 1).toFixed(2) + ' banked',
                   tone: 'win', detail: { rung: step } };
        }

        const holds = rungHolds(ctx, step);
        await hop(ctx, handle, step, holds);
        if (!holds) {
          ctx.live(null);
          ctx.audio.play('bust');
          handle.climber.userData.busy = false;
          return { multiplier: 0, headline: 'RUNG ' + (step + 1) + ' GAVE WAY', tone: 'lose',
                   detail: { rung: step + 1 } };
        }
        handle.rungs[step].material.emissive.setHex(0x2b6b45);
        step++;
        ctx.audio.play('win');
      }

      ctx.live(null);
      ctx.audio.play('big');
      handle.climber.userData.busy = false;
      return { multiplier: cumulative(HOLD.length - 1), headline: 'TOP OF THE LADDER',
               tone: 'huge', detail: { rung: HOLD.length } };
    },
  });

  const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');

  function rungHolds(ctx, step) {
    const mods = ctx.store.s.mods;
    if (mods.alwaysWin) return true;
    if (mods.alwaysLose) return false;
    return ctx.rng.chance(HOLD[step]);
  }

  async function hop(ctx, handle, step, holds) {
    const from = handle.climber.position.clone();
    const rung = handle.rungs[step];
    const to = new THREE.Vector3(rung.position.x, rung.position.y + 0.14, rung.position.z);
    ctx.audio.play('whoosh');
    await ctx.animate(0.42, (t) => {
      handle.climber.position.lerpVectors(from, to, t);
      handle.climber.position.y = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * 0.28;
      handle.climber.rotation.z = t * Math.PI * 2;
    }, GWGames.EASE.outCubic);
    handle.climber.rotation.z = 0;

    if (holds) return;
    // The rung tips and both it and the chip go into the hole.
    const startY = rung.position.y;
    await ctx.animate(0.9, (t) => {
      rung.rotation.z = t * 1.1;
      rung.position.y = startY - t * t * 5.2;
      handle.climber.position.y = to.y - t * t * 5.6;
      handle.climber.rotation.x = Math.PI / 2 + t * 7;
    }, GWGames.EASE.linear);
    rung.visible = false;
  }

  async function descend(ctx, handle) {
    const from = handle.climber.position.clone();
    const to = handle.home.clone();
    await ctx.animate(0.5, (t) => {
      handle.climber.position.lerpVectors(from, to, t);
      handle.climber.position.y = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * 0.2;
    }, GWGames.EASE.inOutCubic);
  }

  function rungLabel(text, x, y, z) {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 56;
    const g = c.getContext('2d');
    g.fillStyle = '#e9b44c';
    g.font = '700 30px Inter, system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(text, 6, 30);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.25),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    mesh.position.set(x, y, z);
    return mesh;
  }
})();
