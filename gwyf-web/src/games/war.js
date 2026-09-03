/* War.

   One card each, higher wins, and that is the whole game. It exists for the
   same reason the scratcher does -- it takes three seconds -- but it is the
   other kind of quick: an even-money bet at nearly the lowest edge on the
   ground floor, so it is what you play when you need to hold your ground
   rather than gain any.

   Ranks are drawn uniformly and independently, so a tie is 1 in 13. A tie does
   not lose here, it goes to war: one card each again, and that second round
   pays double. Which means the edge is small and comes almost entirely from
   losing the war outright. */

(function () {
  'use strict';

  const RANKS = GWCards.RANKS;
  const SUITS = ['s', 'h', 'd', 'c'];

  /* Where the edge is.

     Win and lose are equal by symmetry -- (1 - 1/13)/2 each -- so an even-money
     bet on the higher card returns 0.923 before ties are dealt with, and the
     entire house edge has to come out of what happens on a tie.

     The first version sent ties to war for double, which returns more than the
     stake and made the whole game pay nine percent to the player. Caught by
     tools/odds.mjs, which is the only reason it did not ship. Here the house
     takes half and calls it a draw -- the surrender line from real casino war,
     and the cleanest way to buy an edge out of one in thirteen hands. */
  const P_TIE = 1 / 13;
  const P_WIN = (1 - P_TIE) / 2;
  const TIE_BACK = 0.5;
  const RTP = P_WIN * 2 + P_TIE * TIE_BACK;

  GWGames.register({
    id: 'war',
    name: 'War',
    icon: '⚔️',
    floor: 0,
    blurb: 'One card each, higher wins, three seconds a hand. A tie is a draw '
         + 'and the house keeps half of it, which is where its whole living comes from.',
    bets: [
      { id: 'play', label: 'Play a hand', pays: +RTP.toFixed(4), prob: 1,
        note: 'Even money. A tie gives you half your stake back.' },
    ],
    paysAsRtp: true,

    oddsRows() {
      return [
        { label: 'Your card is higher', pays: 2, prob: P_WIN },
        { label: 'Theirs is higher', pays: 0, prob: P_WIN },
        { label: 'A tie — half back', pays: TIE_BACK, prob: P_TIE },
      ];
    },

    build(ctx) {
      const g = new THREE.Group();
      g.add(GWStage.table({ radius: 1.7, colour: 0x3d1220, rail: 0x2a1710 }));

      const stack = new THREE.Group();
      for (let i = 0; i < 18; i++) {
        const c = GWCards.card('A', 's');
        c.rotation.x = Math.PI / 2;
        c.position.set(0, 0.012 + i * 0.012, -0.95);
        c.rotation.z = ctx.rng.float(-0.02, 0.02);
        stack.add(c);
      }
      g.add(stack);

      ctx.mount(g);
      ctx.view([0, 1.95, 2.4], [0, 0.02, 0.1]);
      const stopSign = ctx.placard({ x: 1.06, z: 0.96, rotY: -0.62, scale: 0.9 });
      return { root: g, laid: [], dispose() { stopSign(); clear(this); } };
    },

    async play(ctx, handle, bet) {
      clear(handle);
      const mods = ctx.store.s.mods;

      let mine = ctx.rng.int(1, 13);
      let theirs = ctx.rng.int(1, 13);
      if (mods.alwaysWin) { mine = 13; theirs = 2; }
      else if (mods.alwaysLose) { mine = 2; theirs = 13; }

      await deal(ctx, handle, mine, -0.5, 0, 1);
      await deal(ctx, handle, theirs, 0.5, 0, 1);
      await ctx.wait(0.3);

      if (mine === theirs) {
        ctx.audio.play('deny');
        return { multiplier: TIE_BACK,
                 headline: 'Two ' + RANKS[mine - 1] + 's — half back',
                 tone: 'push', detail: { mine, theirs } };
      }
      const won = mine > theirs;
      ctx.audio.play(won ? 'cash' : 'lose');
      return {
        multiplier: won ? 2 : 0,
        headline: won ? RANKS[mine - 1] + ' beats ' + RANKS[theirs - 1]
                      : RANKS[theirs - 1] + ' beats ' + RANKS[mine - 1],
        tone: won ? 'win' : 'lose',
        detail: { mine, theirs },
      };
    },
  });

  async function deal(ctx, handle, rank, x, lift, round) {
    // Off the run's own stream, like everything else: a suit is cosmetic but a
    // reload should deal the same table it dealt before.
    const suit = SUITS[ctx.rng.int(0, 3)];
    const card = GWCards.card(RANKS[rank - 1], suit);
    card.rotation.x = Math.PI / 2;
    card.position.set(0, 0.24 + lift, -0.95);
    handle.root.add(card);
    handle.laid.push(card);
    ctx.audio.play('chip');
    const fromZ = -0.95, toZ = round === 1 ? 0.1 : 0.1 - round * 0.06;
    await ctx.animate(0.26, (t) => {
      card.position.x = x * t;
      card.position.z = fromZ + (toZ - fromZ) * t;
      card.position.y = 0.24 + lift - 0.22 * t + Math.sin(t * Math.PI) * 0.12;
      card.rotation.z = (1 - t) * 0.6;
    }, GWGames.EASE.outCubic);
  }

  function clear(handle) {
    for (const c of handle.laid) {
      if (c.parent) c.parent.remove(c);
      if (c.geometry) c.geometry.dispose();
    }
    handle.laid.length = 0;
  }
})();
