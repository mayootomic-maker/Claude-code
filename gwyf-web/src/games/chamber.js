/* The Chamber. The only game on the top floor and the only one with no edge
   worth arguing about, because it does not need one.

   Six chambers, two of them loaded, and the cylinder is not re-spun between
   pulls. So the odds get worse every time and everybody knows it: two thirds
   survive the first pull, one in fifteen survives all four. The payout is the
   reciprocal of getting that far, less the same four percent taken everywhere
   else in the building.

   After four pulls the two remaining chambers are both loaded. The game stops
   there. It is the only mercy in the room. */

(function () {
  'use strict';

  const CHAMBERS = 6;
  const LIVE = 2;
  const MAX_PULLS = CHAMBERS - LIVE;
  const CUT = 0.96;

  function survival(k) {
    let p = 1;
    for (let i = 0; i < k; i++) p *= (CHAMBERS - LIVE - i) / (CHAMBERS - i);
    return p;
  }
  const payout = (k) => (k === 0 ? 1 : CUT / survival(k));

  GWGames.register({
    id: 'chamber',
    name: 'The Chamber',
    icon: '💀',
    floor: 3,
    blurb: 'Six chambers. Two of them are not empty. The cylinder does not get '
         + 'spun again between pulls, so it only ever gets worse.',
    bets: [
      { id: 'pull', label: 'Take the gun', pays: CUT, prob: 1,
        note: 'Walk away after any pull. Four is the most anyone can take.' },
    ],
    paysAsRtp: true,
    skillBased: true,

    oddsRows() {
      return Array.from({ length: MAX_PULLS }, (_, i) => ({
        label: 'Survive ' + (i + 1) + ' pull' + (i ? 's' : ''),
        pays: +payout(i + 1).toFixed(2),
        prob: survival(i + 1),
      }));
    },

    build(ctx) {
      const g = new THREE.Group();
      g.add(GWStage.table({ radius: 1.35, colour: 0x1b0f22, rail: 0x241328 }));

      // The cylinder stands on end on the baize, chambers toward the player. It
      // is the only thing on this floor worth looking at, so it gets a plinth
      // and a light of its own rather than hanging in mid-air.
      const plinth = new THREE.Mesh(
        new THREE.CylinderGeometry(0.44, 0.52, 0.16, 32),
        new THREE.MeshStandardMaterial({ color: 0x1a1016, roughness: 0.6, metalness: 0.3 })
      );
      plinth.position.y = 0.08;
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      g.add(plinth);

      const rig = new THREE.Group();
      rig.position.set(0, 0.70, 0);
      const cylinder = ctx.model('revolver_cylinder');
      cylinder.scale.setScalar(0.92);
      cylinder.rotation.x = Math.PI / 2;
      rig.add(cylinder);
      g.add(rig);

      // A yoke holding the cylinder, and the hammer above it.
      const steel = new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 1, roughness: 0.34 });
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.62, 0.10), steel);
      post.position.set(0, 0.40, -0.34);
      post.castShadow = true;
      g.add(post);
      const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.44), steel);
      yoke.position.set(0, 0.70, -0.24);
      g.add(yoke);

      const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.26, 0.09), steel);
      hammer.position.set(0, 1.16, -0.20);
      hammer.castShadow = true;
      g.add(hammer);

      const flash = new THREE.PointLight(0xffc27a, 0, 8);
      flash.position.set(0, 0.75, 0.9);
      g.add(flash);

      const lamp = new THREE.SpotLight(0xd9c6ff, 9, 6, 0.55, 0.6);
      lamp.position.set(0.8, 3.0, 1.4);
      lamp.target.position.set(0, 0.7, 0);
      g.add(lamp, lamp.target);

      ctx.mount(g);
      ctx.view([0.15, 1.30, 2.55], [0, 0.70, 0]);

      /* Something to do while nobody is playing.

         A revolver on a stand is the most inert object in the building: from
         across a room it is a prop, and a prop in a row of machines that all
         move reads as one that is broken. So the cylinder rolls over a notch
         every few seconds -- the same sixth of a turn a hand would give it --
         and the hammer breathes back a hair as it goes. */
      let restFor = 2.0, rolling = 0, sway = Math.random() * 8;
      const NOTCH = (Math.PI * 2) / CHAMBERS;
      const stop = ctx.stage.onTick((dt) => {
        if (rig.userData.busy) return;
        if (rolling > 0) {
          const step = Math.min(dt / 0.5, rolling);
          rig.rotation.z += NOTCH * step;
          hammer.rotation.x = -Math.sin((1 - rolling + step) * Math.PI) * 0.22;
          rolling -= step;
          if (rolling <= 0) { rolling = 0; hammer.rotation.x = 0; restFor = 2.4 + Math.random() * 3.5; }
          return;
        }
        restFor -= dt;
        // Between rolls it is not frozen: the whole rig rocks a hair on its
        // stand. A machine that moves once every four seconds and is a
        // photograph in between is still a photograph most of the time.
        sway += dt;
        rig.position.x = Math.sin(sway * 0.8) * 0.004;
        hammer.rotation.x = Math.sin(sway * 1.3) * 0.012;
        if (restFor <= 0) rolling = 1;
      });

      return { root: g, rig, cylinder, hammer, flash, dispose() { stop(); } };
    },

    async play(ctx, handle, bet) {
      // The idle roll stops for the duration: two things turning the same
      // cylinder is how a chamber gets skipped.
      handle.rig.userData.busy = true;
      const order = loadCylinder(ctx);
      handle.rig.rotation.z = 0;

      let pulls = 0;
      while (pulls < MAX_PULLS) {
        const next = payout(pulls + 1);
        const risk = Math.round((1 - (CHAMBERS - LIVE - pulls) / (CHAMBERS - pulls)) * 100);
        const options = [{
          id: 'pull', label: pulls === 0 ? 'Pull' : 'Pull again', tone: 'danger',
          hint: '×' + next.toFixed(2) + '  ·  ' + risk + '% chance it is this one',
        }];
        if (pulls > 0) {
          options.push({ id: 'walk', label: 'Take ' + fmt(ctx.totalStake * payout(pulls)),
                         tone: 'cash', hint: 'Put it down and keep ×' + payout(pulls).toFixed(2) });
        }
        ctx.setStatus(pulls === 0
          ? 'Six chambers. Two of them are loaded.'
          : pulls + ' survived. ' + (CHAMBERS - pulls) + ' chambers left, ' + LIVE + ' still loaded.');
        ctx.live(pulls === 0 ? null : '×' + payout(pulls).toFixed(2), 'win');

        const answer = await ctx.prompt({ options });
        if (answer.id === 'walk') {
          ctx.live(null);
          ctx.audio.play('cash');
          handle.rig.userData.busy = false;
          return { multiplier: payout(pulls), headline: '×' + payout(pulls).toFixed(2) + ' and out',
                   tone: 'win', detail: { pulls } };
        }

        const live = order[pulls];
        await pullTrigger(ctx, handle, pulls, live);
        if (live) {
          ctx.live(null);
          handle.rig.userData.busy = false;
          return { multiplier: 0, headline: 'CHAMBER ' + (pulls + 1), tone: 'lose',
                   detail: { pulls: pulls + 1, died: true } };
        }
        pulls++;
      }

      ctx.live(null);
      ctx.audio.play('big');
      // Four pulls is everything the cylinder had to give.
      ctx.store.meta.tickets += 2;
      ctx.store.saveMeta();
      ctx.announce('Four pulls. The room gives you two tickets and a wide berth.', 'good');
      handle.rig.userData.busy = false;
      return { multiplier: payout(MAX_PULLS), headline: 'ALL FOUR', tone: 'huge',
               detail: { pulls: MAX_PULLS, tickets: 2 } };
    },
  });

  const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');

  /* Where the two rounds are sitting. Drawn once, before the first pull, so the
     gun cannot change its mind halfway through a hand. */
  function loadCylinder(ctx) {
    const mods = ctx.store.s.mods;
    const order = new Array(CHAMBERS).fill(false);
    if (mods.alwaysWin) return order;                 // every chamber empty
    if (mods.alwaysLose) { order[0] = true; return order; }
    const slots = ctx.rng.shuffle(Array.from({ length: CHAMBERS }, (_, i) => i));
    for (let i = 0; i < LIVE; i++) order[slots[i]] = true;
    return order;
  }

  async function pullTrigger(ctx, handle, index, live) {
    const step = (Math.PI * 2) / CHAMBERS;
    const from = handle.rig.rotation.z;

    // The cylinder indexes round one chamber, with the ratchet's hesitation.
    ctx.audio.play('tick');
    await ctx.animate(0.42, (t) => {
      handle.rig.rotation.z = from + step * t;
    }, GWGames.EASE.outBack);
    handle.rig.rotation.z = from + step;

    await ctx.animate(0.22, (t) => {
      handle.hammer.rotation.x = -0.9 * t;
      handle.hammer.position.z = -0.20 - t * 0.07;
    }, GWGames.EASE.outCubic);
    await ctx.animate(0.09, (t) => {
      handle.hammer.rotation.x = -0.9 * (1 - t);
      handle.hammer.position.z = -0.27 + t * 0.07;
    }, GWGames.EASE.inCubic);

    if (!live) {
      ctx.audio.play('empty');
      await ctx.animate(0.45, () => {});
      return;
    }

    ctx.audio.play('shot');
    const cam = ctx.stage.camera;
    const base = cam.position.clone();
    await ctx.animate(0.75, (t) => {
      handle.flash.intensity = Math.max(0, 60 * Math.pow(1 - t, 6));
      // Kick, then settle. The camera returns to exactly where it started so
      // the stage's own easing has nothing to unwind afterwards.
      const shake = Math.exp(-9 * t) * 0.16;
      cam.position.set(
        base.x + Math.sin(t * 90) * shake,
        base.y + Math.cos(t * 74) * shake,
        base.z + Math.sin(t * 61) * shake * 0.5
      );
    }, GWGames.EASE.linear);
    cam.position.copy(base);
    handle.flash.intensity = 0;
  }
})();
