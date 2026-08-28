/* High / Low.

   Ranks are drawn uniformly and independently -- suits are cosmetic -- so the
   odds on the screen are exact rather than an approximation of what is left in
   a shoe. Every correct call multiplies what is riding, and a tie loses, which
   is where the four percent comes from. Guess right on a two and you are paid
   almost nothing, because you were almost certain to be right. */

(function () {
  'use strict';

  const RANKS = GWCards.RANKS;             // A low through K high
  const SUITS = ['s', 'h', 'd', 'c'];
  const CUT = 0.96;                        // the house's four percent

  const pHigher = (r) => (13 - r) / 13;    // r is 1..13
  const pLower = (r) => (r - 1) / 13;

  GWGames.register({
    id: 'highlow',
    name: 'High / Low',
    icon: '🂡',
    floor: 1,
    blurb: 'Higher or lower than the card on the table. Ties go to the house, '
         + 'and the house is very fond of ties.',
    bets: [
      { id: 'run', label: 'Start a run', pays: CUT, prob: 1,
        note: 'Every call pays its own true odds less four percent.' },
    ],
    paysAsRtp: true,
    skillBased: true,

    oddsRows() {
      return [2, 5, 7, 9, 12].map((r) => ({
        label: 'On a ' + RANKS[r - 1] + ', calling higher',
        pays: +(CUT / pHigher(r)).toFixed(2),
        prob: pHigher(r),
      }));
    },

    build(ctx) {
      const g = new THREE.Group();
      g.add(GWStage.table({ radius: 1.95, colour: 0x133f2c }));
      // The stock the cards come off, so the table is not an empty circle.
      const stack = new THREE.Group();
      for (let i = 0; i < 14; i++) {
        const card = GWCards.card('A', 's');
        card.rotation.x = Math.PI / 2;
        card.position.set(-1.28, 0.012 + i * 0.0125, -0.72);
        card.rotation.z = ctx.rng.float(-0.03, 0.03);
        stack.add(card);
      }
      g.add(stack);

      ctx.mount(g);
      ctx.view([0, 2.0, 2.5], [0, 0.0, 0]);
      return { root: g, cards: [], dispose() { wipe(this); } };
    },

    async play(ctx, handle, bet) {
      wipe(handle);
      let card = drawCard(ctx.rng);
      let multiplier = 1;
      let streak = 0;
      await place(ctx, handle, card, 0, true);

      while (true) {
        const r = GWCards.rankValue(card.rank);
        const upOdds = pHigher(r), downOdds = pLower(r);
        const upPay = upOdds > 0 ? CUT / upOdds : 0;
        const downPay = downOdds > 0 ? CUT / downOdds : 0;

        const options = [];
        if (upOdds > 0) {
          options.push({ id: 'higher', label: 'Higher', tone: 'gold',
                         hint: '×' + upPay.toFixed(2) + '  ·  ' + pct(upOdds) });
        }
        if (downOdds > 0) {
          options.push({ id: 'lower', label: 'Lower', tone: 'gold',
                         hint: '×' + downPay.toFixed(2) + '  ·  ' + pct(downOdds) });
        }
        if (streak > 0) {
          options.push({ id: 'cash', label: 'Take ' + fmt(ctx.totalStake * multiplier),
                         tone: 'cash', hint: 'Walk away with ×' + multiplier.toFixed(2) });
        }
        ctx.setStatus(streak === 0
          ? 'Showing ' + name(card) + '. Call it.'
          : streak + ' in a row. ×' + multiplier.toFixed(2) + ' riding on ' + name(card) + '.');

        const answer = await ctx.prompt({ options });
        if (answer.id === 'cash') {
          ctx.audio.play('cash');
          return { multiplier, headline: '×' + multiplier.toFixed(2) + ' banked',
                   tone: 'win', detail: { streak } };
        }

        const next = drawNext(ctx, card, answer.id, ctx.store);
        await place(ctx, handle, next, handle.cards.length, true);
        const nr = GWCards.rankValue(next.rank);
        const right = answer.id === 'higher' ? nr > r : nr < r;

        if (!right) {
          ctx.audio.play(nr === r ? 'bust' : 'lose');
          return {
            multiplier: 0,
            headline: nr === r ? 'TIE · ' + name(next) : name(next),
            tone: 'lose',
            detail: { streak, tie: nr === r },
          };
        }

        multiplier *= answer.id === 'higher' ? upPay : downPay;
        streak++;
        card = next;
        ctx.audio.play('win');
        if (handle.cards.length >= 7) {
          ctx.announce('The table is full. That run is closed.', 'good');
          ctx.audio.play('cash');
          return { multiplier, headline: '×' + multiplier.toFixed(2) + ' · seven cards',
                   tone: 'huge', detail: { streak } };
        }
      }
    },
  });

  const pct = (p) => Math.round(p * 100) + '%';
  const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const name = (c) => c.rank + ' of ' + ({ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' })[c.suit];

  function drawCard(rng) {
    return { rank: RANKS[rng.int(0, 12)], suit: SUITS[rng.int(0, 3)] };
  }

  /* Draw the next card, honouring the mod menu by rejection so that a new call
     type could not forget to. */
  function drawNext(ctx, current, call, store) {
    const r = GWCards.rankValue(current.rank);
    const want = store.s.mods.alwaysWin ? true : store.s.mods.alwaysLose ? false : null;
    for (let i = 0; i < 300; i++) {
      const c = drawCard(ctx.rng);
      if (want === null) return c;
      const nr = GWCards.rankValue(c.rank);
      const right = call === 'higher' ? nr > r : nr < r;
      if (right === want) return c;
    }
    return drawCard(ctx.rng);
  }

  function wipe(handle) {
    for (const m of handle.cards) {
      if (m.parent) m.parent.remove(m);
      m.geometry.dispose();
    }
    handle.cards.length = 0;
  }

  async function place(ctx, handle, spec, index, faceUp) {
    const mesh = GWCards.card(spec.rank, spec.suit);
    handle.cards.push(mesh);
    handle.root.add(mesh);
    const spread = GWCards.CARD_W * 0.78;
    const count = handle.cards.length;
    const settled = handle.cards.slice(0, -1).map((m, i) => ({
      mesh: m, from: m.position.clone(),
      to: new THREE.Vector3((i - (count - 1) / 2) * spread, 0.012 + i * 0.002, 0),
    }));
    const target = new THREE.Vector3((index - (count - 1) / 2) * spread, 0.012 + index * 0.002, 0);
    const from = new THREE.Vector3(-1.6, 0.3, -0.8);

    mesh.position.copy(from);
    mesh.rotation.set(Math.PI / 2, 0, 0.6);
    ctx.audio.play('chip');
    await ctx.animate(0.38, (t) => {
      mesh.position.lerpVectors(from, target, t);
      mesh.position.y = from.y + (target.y - from.y) * t + Math.sin(t * Math.PI) * 0.36;
      mesh.rotation.x = Math.PI / 2 - Math.PI * t;
      mesh.rotation.z = 0.6 * (1 - t);
      for (const s of settled) s.mesh.position.lerpVectors(s.from, s.to, t);
    }, GWGames.EASE.outCubic);
    mesh.position.copy(target);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    for (const s of settled) s.mesh.position.copy(s.to);
  }
})();
