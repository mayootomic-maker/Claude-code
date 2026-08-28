/* Coin Toss -- the whole game in one object, and the honest one.

   The flip is not a canned clip. The coin is launched with a velocity, pulled
   down by gravity and spun at whatever rate lands the drawn face up, then it
   bounces once and settles with a damped wobble, the way a dropped coin
   actually does. The number of half-turns is chosen from a range each throw, so
   two flips never look the same even when they land the same way. */

(function () {
  'use strict';

  const G = 26;          // metres per second squared, exaggerated for snap
  const LAUNCH = 6.4;
  const REST_Y = 0.048;   // half the coin's thickness at the scale it is drawn

  GWGames.register({
    id: 'coinflip',
    name: 'Coin Toss',
    icon: '🪙',
    floor: 0,
    blurb: 'Two outcomes, one coin, and a four percent bite for the house on a '
         + 'game a child could referee. It is the fairest thing in the building.',
    bets: [
      { id: 'star', label: 'Star', pays: 1.96, prob: 0.5, note: 'The face with the star on it.' },
      { id: 'cross', label: 'Cross', pays: 1.96, prob: 0.5, note: 'The other one.' },
    ],

    build(ctx) {
      const g = new THREE.Group();
      g.add(GWStage.room({ accent: '#d9a441' }));
      g.add(GWStage.table({ radius: 1.5, colour: 0x123f27 }));

      const coin = ctx.model('coin');
      coin.scale.setScalar(0.62);
      coin.position.y = REST_Y;
      g.add(coin);

      const shadow = GWStage.contactShadow(0.42, 0.55);
      shadow.position.y = 0.006;
      g.add(shadow);

      ctx.group.add(g);
      ctx.stage.frame([0, 1.55, 3.05], [0, 0.30, 0], 3.0);

      // Idle: a slow drift so the table is never a still image.
      const stop = ctx.stage.onTick((dt, now) => {
        if (coin.userData.busy) return;
        coin.rotation.y = now * 0.35;
        coin.position.y = REST_Y + Math.sin(now * 1.4) * 0.004;
      });

      return {
        coin, shadow, root: g,
        dispose() { stop(); },
      };
    },

    async play(ctx, handle, bet) {
      const store = ctx.store;
      // The two-headed coin is the item doing exactly what it says: it changes
      // the probability, not the payout, so the odds panel keeps telling the
      // truth about the payout and starts lying about nothing.
      const bias = store.has('luckycoin') ? 0.55 : 0.5;
      const wantWin = store.s.mods.alwaysWin ? true
        : store.s.mods.alwaysLose ? false
        : ctx.rng.chance(bias);
      const landed = wantWin ? bet.id : (bet.id === 'star' ? 'cross' : 'star');

      const coin = handle.coin;
      coin.userData.busy = true;
      coin.rotation.set(0, coin.rotation.y, 0);

      // Half-turns decide the face: even lands star up, odd lands cross up.
      const parity = landed === 'star' ? 0 : 1;
      const halfTurns = 13 + parity + 2 * ctx.rng.int(0, 3);
      const flight = (2 * LAUNCH) / G;
      const spin = (Math.PI * halfTurns) / flight;
      const tiltAxis = ctx.rng.float(0, Math.PI * 2);

      ctx.audio.play('whoosh');
      await ctx.animate(flight, (_, dt, t) => {
        coin.position.y = REST_Y + LAUNCH * t - 0.5 * G * t * t;
        coin.rotation.set(spin * t, coin.rotation.y, 0);
        handle.shadow.material.opacity = 0.55 * (1 - Math.min(coin.position.y / 2.2, 0.8));
        handle.shadow.scale.setScalar(1 + Math.min(coin.position.y, 2.0) * 0.45);
      });

      ctx.audio.play('coin');
      // One bounce, then the wobble. A coin that stops dead on contact is the
      // single clearest tell that a flip was animated rather than simulated.
      const bounceH = 0.42, bounceT = 2 * Math.sqrt(2 * bounceH / G);
      await ctx.animate(bounceT, (_, dt, t) => {
        const v = Math.sqrt(2 * G * bounceH);
        coin.position.y = REST_Y + v * t - 0.5 * G * t * t;
        coin.rotation.x = Math.PI * halfTurns + spin * 0.10 * t;
      });

      ctx.audio.play('chip');
      await ctx.animate(0.85, (t) => {
        const damp = Math.exp(-6.5 * t);
        const wob = Math.sin(t * 46) * 0.30 * damp;
        coin.position.y = REST_Y + Math.abs(Math.sin(t * 46)) * 0.045 * damp;
        coin.rotation.x = Math.PI * halfTurns + Math.cos(tiltAxis) * wob;
        coin.rotation.z = Math.sin(tiltAxis) * wob;
        handle.shadow.material.opacity = 0.55;
        handle.shadow.scale.setScalar(1);
      }, GWGames.EASE.linear);

      coin.rotation.set(Math.PI * parity, coin.rotation.y, 0);
      coin.position.y = REST_Y;
      coin.userData.busy = false;

      const won = landed === bet.id;
      return {
        multiplier: won ? bet.pays : 0,
        detail: { landed },
        headline: landed === 'star' ? 'STAR' : 'CROSS',
        tone: won ? 'win' : 'lose',
      };
    },
  });
})();
