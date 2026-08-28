/* Over / Under -- two dice, thrown for real.

   The throw is a cannon.js simulation run to completion before anything is
   drawn, then played back. Simulating inside the render loop instead would tie
   how the dice behave to how fast the machine is, and on a slow frame the
   solver punches a die through the rail. */

(function () {
  'use strict';

  const DIE = 0.55;
  const BOWL = 2.15;

  // Every two-dice total, counted rather than asserted.
  function totals() {
    const t = {};
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) t[a + b] = (t[a + b] || 0) + 1;
    return t;
  }
  const T = totals();
  const P = (n) => T[n] / 36;
  const under = P(2) + P(3) + P(4) + P(5) + P(6);
  const over = P(8) + P(9) + P(10) + P(11) + P(12);

  GWGames.register({
    id: 'dice',
    name: 'Over / Under',
    icon: '🎲',
    floor: 0,
    blurb: 'Two dice, one number in the middle that nobody can bet on cheaply. '
         + 'Seven turns up more than any other total, which is the entire trick.',
    bets: [
      { id: 'under', label: 'Under 7', pays: 2.35, prob: under, note: 'Totals 2 through 6.' },
      { id: 'over', label: 'Over 7', pays: 2.35, prob: over, note: 'Totals 8 through 12.' },
      { id: 'seven', label: 'Exactly 7', pays: 5.70, prob: P(7), note: 'The most common single total.' },
      { id: 'double', label: 'Any double', pays: 5.70, prob: 6 / 36, note: 'Both dice the same.' },
      { id: 'snake', label: 'Snake eyes', pays: 33.0, prob: 1 / 36, note: 'Double one. Nothing else.' },
    ],

    /* Every pair of dice, counted through the same wins() the game plays by. */
    verify() {
      const counts = {};
      for (const bet of this.bets) counts[bet.id] = 0;
      for (let a = 1; a <= 6; a++) {
        for (let b = 1; b <= 6; b++) {
          for (const bet of this.bets) if (wins(bet.id, [a, b])) counts[bet.id]++;
        }
      }
      return this.bets.map((bet) => ({ id: bet.id, prob: counts[bet.id] / 36 }));
    },

    build(ctx) {
      const g = new THREE.Group();
      g.add(GWStage.table({ radius: BOWL + 0.24, colour: 0x134129 }));

      const dice = [];
      for (let i = 0; i < 2; i++) {
        const holder = new THREE.Group();
        const inner = new THREE.Group();
        inner.scale.setScalar(DIE);
        inner.add(ctx.model('die'));
        holder.add(inner);
        holder.position.set(-0.45 + i * 0.9, DIE / 2, 0.35);
        g.add(holder);
        const shadow = GWStage.contactShadow(DIE * 1.15, 0.5);
        shadow.position.y = 0.006;
        g.add(shadow);
        dice.push({ holder, inner, shadow });
      }

      ctx.mount(g);
      ctx.view([0, 2.85, 3.55], [0, 0.05, 0]);

      const stop = ctx.stage.onTick((dt, now) => {
        for (const d of dice) {
          if (d.holder.userData.busy) {
            d.shadow.position.set(d.holder.position.x, 0.006, d.holder.position.z);
            d.shadow.material.opacity = 0.5 * Math.max(0.25, 1 - d.holder.position.y * 0.5);
          } else {
            d.holder.rotation.y += dt * 0.12;
            d.shadow.position.set(d.holder.position.x, 0.006, d.holder.position.z);
          }
        }
      });

      return { dice, root: g, dispose() { stop(); } };
    },

    async play(ctx, handle, bet) {
      const store = ctx.store;
      const faces = ctx.lib.doc.meta.die.faces;

      let values = draw(ctx, bet, store);
      let rerolled = false;
      // Loaded dice: one losing throw a day goes back in the cup. It fires
      // before the throw is simulated, so what the player sees is a single
      // honest roll rather than a result being swapped after it landed.
      if (!wins(bet.id, values) && store.has('loadeddice') && store.useDaily('loadeddice')) {
        values = draw(ctx, bet, store, true);
        rerolled = true;
      }

      const roll = GWPhysics.rollDice({
        rng: ctx.rng, faces, size: DIE, radius: BOWL, values,
      });
      if (!roll) {
        // Eight throws all left a die on its edge. Rather than pretend, say so
        // and give the stake back: a push is honest, a silent re-roll is not.
        ctx.announce('The dice went off the table. Nobody saw it. Bet returned.', 'flat');
        return { multiplier: 1, detail: { values, void: true }, headline: 'NO ROLL', tone: 'push' };
      }

      for (let i = 0; i < handle.dice.length; i++) {
        handle.dice[i].holder.userData.busy = true;
        handle.dice[i].inner.quaternion.copy(roll.tracks[i].fix);
      }

      if (rerolled) ctx.announce('The dice go back in the cup. Nobody objects.', 'good');
      ctx.audio.play('dice');
      let played = 0;
      await ctx.until((dt) => {
        played += dt;
        let done = true;
        for (let i = 0; i < handle.dice.length; i++) {
          const finished = GWPhysics.apply(roll.tracks[i], handle.dice[i].holder, played);
          if (!finished) done = false;
        }
        return done;
      });
      for (const d of handle.dice) d.holder.userData.busy = false;

      const total = values[0] + values[1];
      const won = wins(bet.id, values);
      ctx.audio.play(won ? (bet.pays > 6 ? 'big' : 'win') : 'lose');
      return {
        multiplier: won ? bet.pays : 0,
        detail: { values, total },
        headline: values[0] + ' + ' + values[1] + ' = ' + total,
        tone: won ? (bet.pays > 6 ? 'huge' : 'win') : 'lose',
      };
    },
  });

  function wins(betId, v) {
    const t = v[0] + v[1];
    switch (betId) {
      case 'under': return t < 7;
      case 'over': return t > 7;
      case 'seven': return t === 7;
      case 'double': return v[0] === v[1];
      case 'snake': return v[0] === 1 && v[1] === 1;
      default: return false;
    }
  }

  /* Draw two dice. The mod menu forces the result by rejection rather than by
     special-casing each bet, so a new bet type cannot forget to honour it. */
  function draw(ctx, bet, store, forceWin) {
    const want = forceWin || store.s.mods.alwaysWin ? true
      : store.s.mods.alwaysLose ? false : null;
    for (let i = 0; i < 200; i++) {
      const v = [ctx.rng.int(1, 6), ctx.rng.int(1, 6)];
      if (want === null || wins(bet.id, v) === want) return v;
    }
    return [ctx.rng.int(1, 6), ctx.rng.int(1, 6)];
  }
})();
