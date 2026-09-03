/* Three Cups.

   A ball goes under one of three cups, the cups are swapped in front of you,
   and you say which. Watching it properly should work -- and it does, exactly
   one time in three, because the swaps are faster than an eye can track by
   design and the game is honest about that in the odds panel. There is no
   sleight of hand in the code: the ball stays under the cup it started under
   and the cup's index is tracked through every swap.

   It pays 2.85 on a one-in-three shot, which is a five percent cut. The
   temptation with a game like this is to cheat on the last swap when the
   player is right; the temptation is the reason `play` never looks at the
   answer before the ball is placed. */

(function () {
  'use strict';

  const PAYS = 2.85;
  const SPOTS = [-0.62, 0, 0.62];

  function makeCup(colour) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.23, 0.34, 20, 1, true),
      new THREE.MeshStandardMaterial({
        color: colour, roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide,
      })
    );
    body.position.y = 0.17;
    body.castShadow = true;
    g.add(body);
    const top = new THREE.Mesh(
      new THREE.CircleGeometry(0.17, 20),
      new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45, metalness: 0.15 })
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.34;
    g.add(top);
    return g;
  }

  GWGames.register({
    id: 'cups',
    name: 'Three Cups',
    icon: '🥤',
    floor: 0,
    blurb: 'The ball is under one of them and stays there. Watching closely is '
         + 'worth precisely nothing, which the man running it will not tell you.',
    bets: [
      { id: 'pick', label: 'Find the ball', pays: PAYS, prob: 1 / 3,
        note: 'One in three, paying 2.85. The five percent is the table.' },
    ],

    build(ctx) {
      const g = new THREE.Group();
      g.add(GWStage.table({ radius: 1.35, colour: 0x2c1b3f, rail: 0x241318 }));

      const cups = SPOTS.map((x, i) => {
        const cup = makeCup([0xc0392b, 0x2e86c1, 0xd9a441][i]);
        cup.position.set(x, 0.02, 0);
        cup.userData.slot = i;
        g.add(cup);
        return cup;
      });

      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0xf2ede4, roughness: 0.5 })
      );
      ball.position.set(0, 0.075, 0);
      ball.visible = false;
      g.add(ball);

      ctx.mount(g);
      ctx.view([0, 1.15, 2.15], [0, 0.15, 0]);
      return { cups, ball, root: g, dispose() {} };
    },

    async play(ctx, handle, bet) {
      const { cups, ball } = handle;
      // Where each cup currently stands. Index into SPOTS.
      const at = cups.map((c, i) => i);
      for (let i = 0; i < 3; i++) { cups[i].position.set(SPOTS[i], 0.02, 0); }

      const mods = ctx.store.s.mods;
      const under = mods.alwaysWin || mods.alwaysLose ? 0 : ctx.rng.int(0, 2);

      // Show the ball going under, so the swap that follows means something.
      ctx.setStatus('Watch it.');
      ball.visible = true;
      ball.position.set(SPOTS[under], 0.075, 0);
      await ctx.animate(0.42, (t) => { cups[under].position.y = 0.02 + t * 0.30; },
        GWGames.EASE.outCubic);
      await ctx.wait(0.28);
      await ctx.animate(0.30, (t) => { cups[under].position.y = 0.32 - t * 0.30; },
        GWGames.EASE.inCubic);
      ball.visible = false;

      /* The swaps. Two cups arc past each other, one in front and one behind,
         so neither passes through the other. Each swap is a little quicker
         than the last. */
      const swaps = 5 + ctx.rng.int(0, 3);
      for (let s = 0; s < swaps; s++) {
        const a = ctx.rng.int(0, 2);
        let b = ctx.rng.int(0, 1);
        if (b >= a) b++;                        // any of the other two
        const ca = cups[at.indexOf(a)], cb = cups[at.indexOf(b)];
        const xa = SPOTS[a], xb = SPOTS[b];
        const dur = Math.max(0.16, 0.36 - s * 0.03);
        ctx.audio.play('tick');
        await ctx.animate(dur, (t) => {
          const e = GWGames.EASE.inOutCubic(t);
          ca.position.x = xa + (xb - xa) * e;
          cb.position.x = xb + (xa - xb) * e;
          ca.position.z = Math.sin(e * Math.PI) * 0.34;
          cb.position.z = -Math.sin(e * Math.PI) * 0.34;
        });
        ca.position.z = cb.position.z = 0;
        const ia = at.indexOf(a), ib = at.indexOf(b);
        at[ia] = b; at[ib] = a;
      }

      /* Which cup is over the ball now: the one whose slot is the one the ball
         was placed under. Tracked, never re-decided. */
      const winner = cups[at.indexOf(under)];

      ctx.setStatus('Which one?');
      const answer = await ctx.prompt({ meshes: cups.map((c) => c.children[0]) });
      const chosen = answer.object.parent;
      let won = chosen === winner;
      // The two mods are the only things that touch the outcome, and they do it
      // by moving the ball rather than by lying about where it is.
      if (mods.alwaysWin) won = true;
      else if (mods.alwaysLose) won = false;
      const reveal = won ? chosen : winner;

      ball.position.set(reveal.position.x, 0.075, 0);
      ball.visible = true;
      ctx.audio.play('whoosh');
      await ctx.animate(0.36, (t) => { reveal.position.y = 0.02 + t * 0.34; },
        GWGames.EASE.outCubic);
      if (!won) {
        // Lift theirs too, so an empty cup is shown to be empty.
        await ctx.animate(0.26, (t) => { chosen.position.y = 0.02 + t * 0.34; },
          GWGames.EASE.outCubic);
      }
      await ctx.wait(0.5);

      ctx.audio.play(won ? 'cash' : 'lose');
      return {
        multiplier: won ? PAYS : 0,
        headline: won ? 'Under that one' : 'It was the other one',
        tone: won ? 'win' : 'lose',
        detail: { picked: chosen.userData.slot, ball: under },
      };
    },
  });
})();
