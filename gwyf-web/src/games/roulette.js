/* European roulette. One zero, and every bet on the table carries the same
   2.70% edge -- which is the elegant, awful thing about the game: there is no
   clever bet, only different shapes of the same loss.

   The wheel is the Blender model, the rotor turns one way and the ball the
   other, and the ball's flight is a real decaying orbit that falls off the
   track, crosses the deflectors and drops into a pocket. The pocket it lands in
   is drawn first and the ball is steered to it over the last second of the
   spin, because a ball simulated all the way down is a ball whose odds are the
   solver's and cannot be written on a sign. */

(function () {
  'use strict';

  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const p1 = 18 / 37, p12 = 12 / 37, p0 = 1 / 37;

  const OUTSIDE = {
    red: (n) => n !== 0 && REDS.has(n),
    black: (n) => n !== 0 && !REDS.has(n),
    odd: (n) => n !== 0 && n % 2 === 1,
    even: (n) => n !== 0 && n % 2 === 0,
    low: (n) => n >= 1 && n <= 18,
    high: (n) => n >= 19 && n <= 36,
    dozen1: (n) => n >= 1 && n <= 12,
    dozen2: (n) => n >= 13 && n <= 24,
    dozen3: (n) => n >= 25 && n <= 36,
  };

  GWGames.register({
    id: 'roulette',
    name: 'Roulette',
    icon: '🎡',
    floor: 1,
    blurb: 'Thirty-seven pockets and thirty-six of them are yours. That one green '
         + 'slot is the whole business model and it never takes a night off.',
    bets: [
      { id: 'red', label: 'Red', pays: 2, prob: p1, note: 'Eighteen pockets.' },
      { id: 'black', label: 'Black', pays: 2, prob: p1, note: 'The other eighteen.' },
      { id: 'odd', label: 'Odd', pays: 2, prob: p1 },
      { id: 'even', label: 'Even', pays: 2, prob: p1 },
      { id: 'low', label: '1 to 18', pays: 2, prob: p1 },
      { id: 'high', label: '19 to 36', pays: 2, prob: p1 },
      { id: 'dozen1', label: 'First dozen', pays: 3, prob: p12, note: '1–12.' },
      { id: 'dozen2', label: 'Second dozen', pays: 3, prob: p12, note: '13–24.' },
      { id: 'dozen3', label: 'Third dozen', pays: 3, prob: p12, note: '25–36.' },
      { id: 'straight', label: 'One number', pays: 36, prob: p0,
        note: 'Pick it below. Pays thirty-five to one on a thirty-six to one shot.' },
    ],

    renderExtra(el, api) {
      if (api.bet.id !== 'straight') { el.innerHTML = ''; return; }
      const chosen = api.opts.number === undefined ? 17 : api.opts.number;
      el.innerHTML = '<h3 class="rail__label">Your number</h3><div class="numgrid"></div>';
      const grid = el.querySelector('.numgrid');
      for (let n = 0; n <= 36; n++) {
        const b = document.createElement('button');
        b.className = 'numcell' + (n === 0 ? ' numcell--zero' : REDS.has(n) ? ' numcell--red' : ' numcell--black');
        b.textContent = n;
        b.setAttribute('aria-pressed', String(n === chosen));
        b.addEventListener('click', () => { api.setOpt('number', n); api.rerender(); });
        grid.appendChild(b);
      }
    },

    /* All thirty-seven pockets, through the same wins() the game pays by. */
    verify() {
      const opts = { number: 17 };
      return this.bets.map((bet) => {
        let hits = 0;
        for (let n = 0; n <= 36; n++) if (wins(bet.id, n, opts)) hits++;
        return { id: bet.id, prob: hits / 37 };
      });
    },

    build(ctx) {
      const meta = ctx.lib.doc.meta.roulette;
      const g = new THREE.Group();
      g.add(GWStage.table({ radius: 1.9, colour: 0x14442a, rail: 0x2b1a14 }));

      const bowl = ctx.model('roulette_bowl');
      bowl.scale.setScalar(1.35);
      g.add(bowl);

      const rotor = ctx.model('roulette_rotor');
      rotor.scale.setScalar(1.35);
      rotor.position.y = 0.012;
      g.add(rotor);

      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.048, 20, 14),
        new THREE.MeshPhysicalMaterial({ color: 0xf2ece2, roughness: 0.14, clearcoat: 1 })
      );
      ball.castShadow = true;
      g.add(ball);

      ctx.mount(g);
      ctx.view([0, 2.15, 2.95], [0, 0.12, 0]);

      const track = meta.trackRadius * 1.35;
      const pocketR = meta.pocketRadius * 1.35;
      const state = { rotor: 0, spin: 0.55, ball: 0, radius: track, height: 0.30, resting: true };

      const stop = ctx.stage.onTick((dt) => {
        if (state.resting) state.rotor += dt * 0.22;
        rotor.rotation.y = state.rotor;
        ball.position.set(Math.cos(state.ball) * state.radius, state.height,
                          -Math.sin(state.ball) * state.radius);
      });

      return { g, rotor, ball, state, track, pocketR, meta, dispose() { stop(); } };
    },

    async play(ctx, handle, bet, opts) {
      const store = ctx.store;
      const meta = handle.meta;
      const number = pickNumber(ctx, bet, opts, store);
      const pocket = meta.order.indexOf(number);
      const st = handle.state;

      st.resting = false;
      const spinDir = 1;
      let rotorSpeed = 3.1 + ctx.rng.float(0, 0.5);
      let ballSpeed = -(11.5 + ctx.rng.float(0, 1.6));

      // Free orbit: the rotor and the ball both slow down under their own
      // friction. Nothing is aimed yet.
      const freeTime = 3.6;
      ctx.audio.play('whoosh');
      await ctx.animate(freeTime, (_, dt, t) => {
        rotorSpeed *= Math.pow(0.90, dt * 6);
        ballSpeed *= Math.pow(0.86, dt * 6);
        st.rotor += rotorSpeed * dt * spinDir;
        st.ball += ballSpeed * dt;
        st.radius = handle.track + Math.sin(t * 9) * 0.004;
        st.height = 0.30;
      });

      // The drop. Off the track, across the deflectors, into the pockets --
      // and over this second and a bit the ball's angle is eased onto the pocket
      // it was always going to land in.
      const startBall = st.ball;
      const startRotor = st.rotor;
      const dropTime = 1.75;
      const endRotorSpeed = rotorSpeed * 0.45;
      const rotorEnd = startRotor + (rotorSpeed + endRotorSpeed) / 2 * dropTime * spinDir;
      // Pocket i sits at rotor angle + i * step, so this is where it will be.
      let targetAngle = rotorEnd + pocket * meta.pocketStep;
      // Arrive from where the ball already is, going the way it is already going.
      while (targetAngle > startBall + ballSpeed * dropTime) targetAngle -= Math.PI * 2;

      let bumped = 0;
      await ctx.animate(dropTime, (_, dt, t) => {
        const k = t / dropTime;
        const ease = 1 - Math.pow(1 - k, 3);
        st.rotor = startRotor + (rotorSpeed * t - (rotorSpeed - endRotorSpeed) * t * t / (2 * dropTime)) * spinDir;
        st.ball = startBall + (targetAngle - startBall) * ease;
        st.radius = handle.track + (handle.pocketR - handle.track) * ease;
        // Two hops off the deflectors on the way down.
        const hop = Math.max(0, Math.sin(k * Math.PI * 2.6)) * (1 - k) * 0.075;
        st.height = 0.30 + (0.055 - 0.30) * ease + hop;
        if (t > bumped + 0.28 && k < 0.8) { bumped = t; ctx.audio.play('tick'); }
      }, GWGames.EASE.linear);

      // The wheel keeps turning with the ball in its pocket.
      const settleRotor = st.rotor;
      await ctx.animate(1.5, (_, dt, t) => {
        const speed = endRotorSpeed * Math.max(0, 1 - t / 1.5);
        st.rotor += speed * dt * spinDir;
        st.ball = st.rotor + pocket * meta.pocketStep;
        st.radius = handle.pocketR;
        st.height = 0.055;
      });
      st.resting = true;

      let won = wins(bet.id, number, opts);
      let nudged = false;
      // Static Cling pays a straight-up bet that missed by exactly one pocket on
      // the wheel -- not one number in value, one pocket in space, which is the
      // only version of that item that means anything.
      if (!won && bet.id === 'straight' && store.has('staticcling') && store.useDaily('staticcling')) {
        const mine = meta.order.indexOf(opts.number === undefined ? 17 : opts.number);
        const gap = Math.abs(((mine - pocket + 37 + 18) % 37) - 18);
        if (gap === 1) { won = true; nudged = true; }
      }

      const colour = number === 0 ? 'green' : REDS.has(number) ? 'red' : 'black';
      if (nudged) ctx.announce('Static Cling. The ball was practically in your pocket.', 'good');
      ctx.audio.play(won ? (bet.pays > 10 ? 'big' : 'win') : 'lose');

      return {
        multiplier: won ? bet.pays : 0,
        detail: { number, colour },
        headline: number + ' ' + colour,
        tone: won ? (bet.pays > 10 ? 'huge' : 'win') : 'lose',
      };
    },
  });

  function wins(betId, n, opts) {
    if (betId === 'straight') return n === (opts.number === undefined ? 17 : opts.number);
    const test = OUTSIDE[betId];
    return test ? test(n) : false;
  }

  function pickNumber(ctx, bet, opts, store) {
    const mods = store.s.mods;
    const want = mods.alwaysWin ? true : mods.alwaysLose ? false : null;
    for (let i = 0; i < 400; i++) {
      const n = ctx.rng.int(0, 36);
      if (want === null || wins(bet.id, n, opts) === want) return n;
    }
    return ctx.rng.int(0, 36);
  }
})();
