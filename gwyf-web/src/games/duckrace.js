/* Five ducks, one length of water.

   Each duck gets its own speed curve for the race -- a base pace, a wobble and
   a late kick -- and the curves are scaled so the drawn winner arrives first.
   The order of everyone else is whatever the curves produce, so the race has
   real places, real overtakes and a real photo finish, and only the top step of
   the podium is decided in advance. */

(function () {
  'use strict';

  const LANE = 0.58;
  // Short enough that the whole track fits in one shot. The first version ran
  // from -3.4 to 3.4 with the camera framed on the middle, so the ducks spent
  // the start of every race off the left of the screen.
  const START = -2.15;
  const FINISH = 2.15;

  const DUCKS = [
    { id: 'bruiser', name: 'Bruiser', colour: 0xd9a441, prob: 0.32, pays: 2.90 },
    { id: 'custard', name: 'Custard', colour: 0xe8e0c8, prob: 0.25, pays: 3.70 },
    { id: 'ninelives', name: 'Nine Lives', colour: 0x5cd98c, prob: 0.20, pays: 4.65 },
    { id: 'beaky', name: 'Beaky', colour: 0x6fa8dc, prob: 0.14, pays: 6.60 },
    { id: 'clerk', name: 'The Accountant', colour: 0xb48ce8, prob: 0.09, pays: 10.30 },
  ];

  GWGames.register({
    id: 'duckrace',
    name: 'Duck Race',
    icon: '🦆',
    floor: 0,
    blurb: 'Five plastic ducks and a pump. The Accountant has never won and the '
         + 'board keeps lengthening his price, which is either a tell or a trap.',
    bets: DUCKS.map((d) => ({
      id: d.id, label: d.name, pays: d.pays, prob: d.prob,
      note: 'Wins about ' + Math.round(d.prob * 100) + ' races in a hundred.',
    })),

    /* The ducks' win chances have to add up to one race. */
    verify() {
      return DUCKS.map((d) => ({ id: d.id, prob: d.prob }));
    },

    build(ctx) {
      const g = new THREE.Group();

      const FLOOR = GWStage.FLOOR_Y;
      const width = DUCKS.length * LANE + 0.55;
      const length = (FINISH - START) + 1.3;

      const water = new THREE.Mesh(
        new THREE.BoxGeometry(length - 0.28, 0.26, width - 0.28),
        // Opaque, not transmissive. Transmission renders the whole scene into a
        // second target every frame, and what it buys here is a hint of the
        // trough floor through six inches of water.
        new THREE.MeshStandardMaterial({ color: 0x0e4055, roughness: 0.12, metalness: 0.25 })
      );
      water.position.y = -0.10;
      water.receiveShadow = true;
      g.add(water);

      const shellMat = new THREE.MeshStandardMaterial({ color: 0x241713, roughness: 0.7 });
      const trough = new THREE.Mesh(new THREE.BoxGeometry(length, 0.56, width), shellMat);
      trough.position.y = -0.30;
      trough.castShadow = true;
      trough.receiveShadow = true;
      g.add(trough);

      // Legs, so the trough stands on the carpet instead of hovering over it.
      const legH = (-0.58) - FLOOR;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const leg = new THREE.Mesh(
            new THREE.BoxGeometry(0.16, legH, 0.16),
            new THREE.MeshStandardMaterial({ color: 0x171010, roughness: 0.8 })
          );
          leg.position.set(sx * (length / 2 - 0.24), -0.58 - legH / 2, sz * (width / 2 - 0.20));
          leg.castShadow = true;
          g.add(leg);
        }
      }

      // Lane dividers, start gate and finish post.
      for (let i = 0; i <= DUCKS.length; i++) {
        const z = (i - DUCKS.length / 2) * LANE;
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(length - 0.3, 0.06, 0.035),
          new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.6 })
        );
        rail.position.set(0, 0.05, z);
        g.add(rail);
      }
      for (const [x, colour, glow] of [[START - 0.28, 0x6b5d57, 0], [FINISH + 0.28, 0xe9b44c, 0.5]]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 0.62, width - 0.3),
          new THREE.MeshStandardMaterial({
            color: colour, roughness: 0.5, emissive: colour, emissiveIntensity: glow,
          })
        );
        post.position.set(x, 0.28, 0);
        post.castShadow = true;
        g.add(post);
      }

      const racers = DUCKS.map((d, i) => {
        const duck = ctx.model('duck');
        duck.scale.setScalar(0.46);
        duck.position.set(START, 0.03, (i - (DUCKS.length - 1) / 2) * LANE);
        duck.traverse((o) => {
          // Recolour the body only. The beak and eyes keep their own materials,
          // so a green duck is still a duck and not a green blob.
          if (o.isMesh && o.material && o.material.name === 'duck_body') {
            o.material = o.material.clone();
            o.material.color.setHex(d.colour);
          }
        });
        g.add(duck);
        return { duck, def: d, x: START, bob: ctx.rng.float(0, 6.28) };
      });

      ctx.mount(g);
      ctx.view([0, 3.10, 5.35], [0, -0.05, 0]);

      const stop = ctx.stage.onTick((dt, now) => {
        for (const r of racers) {
          r.duck.position.x = r.x;
          r.duck.position.y = 0.03 + Math.sin(now * 4.4 + r.bob) * 0.032;
          r.duck.rotation.z = Math.sin(now * 4.4 + r.bob) * 0.09;
          r.duck.rotation.y = Math.sin(now * 2.1 + r.bob) * 0.05;
        }
      });

      return { racers, root: g, dispose() { stop(); } };
    },

    async play(ctx, handle, bet) {
      const store = ctx.store;
      const winner = pickWinner(ctx, bet, store);

      // A pace curve per duck: base speed, a wobble that makes the lead change
      // hands, and a kick in the last third.
      const plans = handle.racers.map((r) => ({
        r,
        base: ctx.rng.float(0.86, 1.14),
        wobbleA: ctx.rng.float(0.10, 0.26),
        wobbleF: ctx.rng.float(1.1, 2.3),
        phase: ctx.rng.float(0, 6.28),
        kick: ctx.rng.float(0.0, 0.32),
      }));

      const RACE = 6.0;
      const pace = (plan, t) => plan.base
        + Math.sin(t * plan.wobbleF + plan.phase) * plan.wobbleA
        + (t > RACE * 0.62 ? plan.kick * (t - RACE * 0.62) / (RACE * 0.38) : 0);

      // Integrate each curve once, then scale every duck so the drawn winner
      // finishes exactly on the line and nobody else beats them to it.
      const N = 240, dtN = RACE / N;
      const totals = plans.map((plan) => {
        let s = 0;
        for (let i = 0; i < N; i++) s += pace(plan, i * dtN) * dtN;
        return s;
      });
      const winIdx = handle.racers.findIndex((r) => r.def.id === winner);
      const dist = FINISH - START;
      const scales = plans.map((_, i) => {
        if (i === winIdx) return dist / totals[i];
        // Everyone else lands between 55% and 99% of the way, in the order their
        // own curves earned.
        const rank = totals[i] / totals[winIdx];
        return (dist * Math.min(0.99, 0.55 + rank * 0.42)) / totals[i];
      });

      for (const r of handle.racers) r.x = START;
      ctx.audio.play('whoosh');
      let quack = 0;
      const travelled = plans.map(() => 0);
      await ctx.animate(RACE, (_, dt, t) => {
        quack += dt;
        if (quack > 0.9) { quack = 0; ctx.audio.play('tick'); }
        plans.forEach((plan, i) => {
          travelled[i] += pace(plan, t) * dt * scales[i];
          plan.r.x = Math.min(START + travelled[i], FINISH);
        });
      }, GWGames.EASE.linear);

      const order = handle.racers
        .map((r, i) => ({ id: r.def.id, name: r.def.name, x: r.x }))
        .sort((a, b) => b.x - a.x);
      const won = order[0].id === bet.id;
      ctx.audio.play(won ? 'win' : 'lose');

      return {
        multiplier: won ? bet.pays : 0,
        detail: { order: order.map((o) => o.name) },
        headline: order[0].name + ' takes it',
        tone: won ? 'win' : 'lose',
      };
    },
  });

  function pickWinner(ctx, bet, store) {
    const mods = store.s.mods;
    if (mods.alwaysWin) return bet.id;
    if (mods.alwaysLose) {
      const others = DUCKS.filter((d) => d.id !== bet.id);
      return others[ctx.rng.weighted(others.map((d) => d.prob))].id;
    }
    return DUCKS[ctx.rng.weighted(DUCKS.map((d) => d.prob))].id;
  }
})();
