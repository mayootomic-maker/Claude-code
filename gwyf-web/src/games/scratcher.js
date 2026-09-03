/* The Scratcher.

   Three panels, scratched one at a time. Three of a kind pays what that symbol
   is worth; anything else pays nothing. It is the fastest game in the building
   -- about four seconds a card -- which is the point of it: this is the machine
   you play when the clock is nearly out and you are short.

   The symbols are drawn independently per panel with the weights below, so the
   chance of three of a kind is the sum over symbols of p cubed. That sum, times
   what each pays, is where the printed edge comes from -- and because the draws
   are independent, revealing two matching symbols really does leave the third
   open, which is the only reason scratching one at a time is worth watching. */

(function () {
  'use strict';

  /* Payouts derived, not written down.

     Hand-written prizes gave this a forty-three percent house edge on the
     first pass -- caught by tools/odds.mjs, not by reading it. So the weights
     are chosen and the prizes fall out of them: every symbol is set to
     contribute the same share of the return, which means the common ones pay
     a little often and the rare ones pay a lot rarely, and the total is the
     same CUT every other honest machine here takes.

       pays(i) = share / p(i)^3,  share = CUT / (number of symbols)

     so the sum of p^3 * pays over the symbols is exactly CUT, whatever the
     weights are changed to later. */
  const CUT = 0.96;
  const WEIGHTS = [
    { id: 'cherry', face: '\u{1F352}', p: 0.34 },
    { id: 'bell', face: '\u{1F514}', p: 0.26 },
    { id: 'clover', face: '\u{1F340}', p: 0.20 },
    { id: 'crown', face: '\u{1F451}', p: 0.13 },
    { id: 'skull', face: '\u{1F480}', p: 0.07 },
  ];
  const SHARE = CUT / WEIGHTS.length;
  const SYMBOLS = WEIGHTS.map((s) => Object.assign({}, s, {
    pays: +(SHARE / Math.pow(s.p, 3)).toFixed(2),
  }));

  // How often a card is a winner at all, and what one returns on average --
  // the second is CUT by construction, and is computed rather than asserted so
  // that changing a weight cannot quietly make the printed figure a lie.
  const pAny = SYMBOLS.reduce((n, s) => n + Math.pow(s.p, 3), 0);
  const rtp = SYMBOLS.reduce((n, s) => n + Math.pow(s.p, 3) * s.pays, 0);

  function panelTexture(face) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#efe7d8';
    g.fillRect(0, 0, 128, 128);
    g.font = '78px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(face, 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  GWGames.register({
    id: 'scratcher',
    name: 'The Scratcher',
    icon: '🎟️',
    floor: 0,
    blurb: 'Three panels, three of a kind, four seconds a card. The machine you '
         + 'end up at when the doors are closing and you are two hundred short.',
    bets: [
      { id: 'card', label: 'Buy a card', pays: +rtp.toFixed(4), prob: 1,
        note: 'Three of a kind pays. It happens ' + (pAny * 100).toFixed(1)
            + '% of the time.' },
    ],
    paysAsRtp: true,

    oddsRows() {
      return SYMBOLS.map((s) => ({
        label: 'Three ' + s.face,
        pays: s.pays,
        prob: Math.pow(s.p, 3),
      }));
    },

    build(ctx) {
      const g = new THREE.Group();

      // A dispenser to take the card from, so the card comes from somewhere.
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 1.5, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x8a2436, roughness: 0.55, metalness: 0.2 })
      );
      body.position.set(0, 0.75, -0.45);
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);
      const shelf = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.08, 0.85),
        new THREE.MeshStandardMaterial({ color: 0x2a1c16, roughness: 0.6 })
      );
      shelf.position.set(0, 1.0, 0.05);
      shelf.receiveShadow = true;
      g.add(shelf);

      const card = new THREE.Group();
      card.position.set(0, 1.05, 0.06);
      card.rotation.x = -Math.PI / 2;
      g.add(card);
      const stock = new THREE.Mesh(
        new THREE.PlaneGeometry(1.05, 0.62),
        new THREE.MeshStandardMaterial({ color: 0xe6dcc8, roughness: 0.85 })
      );
      card.add(stock);

      // Three panels: the symbol underneath, and a scratch-off cover over it.
      const panels = [];
      for (let i = 0; i < 3; i++) {
        const holder = new THREE.Group();
        holder.position.set((i - 1) * 0.33, -0.02, 0.002);
        const face = new THREE.Mesh(
          new THREE.PlaneGeometry(0.27, 0.27),
          new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 })
        );
        face.position.z = 0.001;
        holder.add(face);
        const cover = new THREE.Mesh(
          new THREE.PlaneGeometry(0.28, 0.28),
          new THREE.MeshStandardMaterial({ color: 0xa9a296, roughness: 0.55, metalness: 0.4 })
        );
        cover.position.z = 0.004;
        holder.add(cover);
        card.add(holder);
        panels.push({ holder, face, cover });
      }

      ctx.mount(g);
      ctx.view([0, 1.72, 1.55], [0, 1.03, 0]);
      const stopSign = ctx.placard({ y: 0.95, z: 0.72, scale: 0.8 });
      return {
        panels, card, root: g,
        dispose() {
          stopSign();
          for (const p of panels) if (p.face.material.map) p.face.material.map.dispose();
        },
      };
    },

    async play(ctx, handle, bet) {
      const { panels } = handle;
      const mods = ctx.store.s.mods;

      const draw = () => {
        let r = ctx.rng.float(0, 1);
        for (const s of SYMBOLS) { if ((r -= s.p) <= 0) return s; }
        return SYMBOLS[0];
      };

      let picks;
      if (mods.alwaysWin) { const s = draw(); picks = [s, s, s]; }
      else if (mods.alwaysLose) {
        picks = [SYMBOLS[0], SYMBOLS[0], SYMBOLS[1]];
      } else {
        picks = [draw(), draw(), draw()];
      }

      // Reset the covers from the last card.
      for (const p of panels) {
        p.cover.visible = true;
        p.cover.scale.set(1, 1, 1);
        p.cover.material.opacity = 1;
        p.cover.material.transparent = false;
      }

      for (let i = 0; i < 3; i++) {
        const p = panels[i];
        if (p.face.material.map) p.face.material.map.dispose();
        p.face.material.map = panelTexture(picks[i].face);
        p.face.material.needsUpdate = true;
        ctx.audio.play('chip');
        // The cover flakes away rather than vanishing: scale it off from the
        // middle and fade it, which reads as scratching without a shader.
        p.cover.material.transparent = true;
        await ctx.animate(0.34, (t) => {
          p.cover.scale.set(1 - t, 1 - t * 0.15, 1);
          p.cover.material.opacity = 1 - t;
        }, GWGames.EASE.outCubic);
        p.cover.visible = false;
        await ctx.wait(0.18);
      }

      const same = picks[0].id === picks[1].id && picks[1].id === picks[2].id;
      const prize = same ? picks[0] : null;
      await ctx.wait(0.35);
      ctx.audio.play(same ? (prize.pays >= 80 ? 'big' : 'cash') : 'lose');
      return {
        multiplier: same ? prize.pays : 0,
        headline: same ? 'Three ' + prize.face : picks.map((p) => p.face).join(' '),
        tone: same ? (prize.pays >= 80 ? 'huge' : 'win') : 'lose',
        detail: { symbols: picks.map((p) => p.id) },
      };
    },
  });
})();
