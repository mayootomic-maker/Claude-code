/* Mines.

   Twenty-five tiles, some of them loaded. Every tile you turn over multiplies
   what is riding by exactly the odds you just beat, less four percent, and you
   can stop at any point. The multiplier is not a table somebody tuned -- it is
   C(25,k)/C(25-m,k), the reciprocal of the chance of getting this far, worked
   out on the spot. */

(function () {
  'use strict';

  const N = 25, SIDE = 5;
  const CUT = 0.96;
  const LAYOUTS = [
    { mines: 3, label: '3 mines', note: 'Long odds on a big run.' },
    { mines: 5, label: '5 mines', note: 'The usual.' },
    { mines: 10, label: '10 mines', note: 'Two tiles is already a decent night.' },
  ];

  const choose = (n, k) => {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
    return r;
  };
  // Chance of turning k safe tiles in a row, and the payout that undoes it.
  const survival = (m, k) => choose(N - m, k) / choose(N, k);
  const payout = (m, k) => (k === 0 ? 1 : CUT / survival(m, k));

  GWGames.register({
    id: 'mines',
    name: 'Mines',
    icon: '💣',
    floor: 2,
    blurb: 'Twenty-five tiles and a number of them you chose yourself. Nothing '
         + 'here is hidden from you except which ones.',
    bets: [
      { id: 'dig', label: 'Start digging', pays: CUT, prob: 1,
        note: 'Cash out whenever. The tile after the one you stopped on is the point.' },
    ],
    paysAsRtp: true,
    skillBased: true,

    oddsRows() {
      const m = 5;
      return [1, 2, 3, 5, 8, 12].map((k) => ({
        label: k + ' safe tiles (5 mines)',
        pays: +payout(m, k).toFixed(2),
        prob: survival(m, k),
      }));
    },

    renderExtra(el, api) {
      const current = api.opts.mines === undefined ? 5 : api.opts.mines;
      el.innerHTML = '<h3 class="rail__label">How many mines</h3><div class="bets"></div>';
      const box = el.querySelector('.bets');
      for (const layout of LAYOUTS) {
        const b = document.createElement('button');
        b.className = 'bet';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(layout.mines === current));
        b.innerHTML = '<span><span class="bet__name">' + layout.label
          + '</span><span class="bet__note">' + layout.note + '</span></span>'
          + '<span class="bet__pays">×' + payout(layout.mines, 1).toFixed(2) + '</span>';
        b.addEventListener('click', () => { api.setOpt('mines', layout.mines); api.rerender(); });
        box.appendChild(b);
      }
    },

    build(ctx) {
      const g = new THREE.Group();
      g.add(GWStage.table({ radius: 2.05, colour: 0x113a23 }));

      const tiles = [];
      const pitch = 0.62;
      const geo = new THREE.BoxGeometry(pitch * 0.86, 0.09, pitch * 0.86);
      for (let i = 0; i < N; i++) {
        const col = i % SIDE, row = Math.floor(i / SIDE);
        const mat = new THREE.MeshStandardMaterial({
          color: 0x39424a, roughness: 0.62, metalness: 0.12,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set((col - (SIDE - 1) / 2) * pitch, 0.05, (row - (SIDE - 1) / 2) * pitch);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.index = i;
        mesh.userData.shared = true;   // geometry is shared; stage.clear must not free it per tile
        g.add(mesh);
        tiles.push(mesh);
      }

      ctx.mount(g);
      ctx.view([0, 3.95, 1.35], [0, -0.02, 0]);
      const stopSign = ctx.placard({ x: 1.76, z: 0.94, rotY: -0.82 });
      return { root: g, tiles, geo, dispose() { stopSign(); geo.dispose(); } };
    },

    async play(ctx, handle, bet, opts) {
      const mines = opts.mines === undefined ? 5 : opts.mines;
      const field = layMines(ctx, mines);
      const found = new Set();
      let multiplier = 1;

      for (const t of handle.tiles) reset(t);

      while (found.size < N - mines) {
        const next = payout(mines, found.size + 1);
        const options = [];
        if (found.size > 0) {
          options.push({ id: 'cash', label: 'Take ' + fmt(ctx.totalStake * multiplier),
                         tone: 'cash', hint: '×' + multiplier.toFixed(2) + ' banked' });
        }
        ctx.setStatus(found.size === 0
          ? 'Pick a tile. ' + mines + ' of the twenty-five are loaded.'
          : found.size + ' clear. Next one pays ×' + next.toFixed(2) + '.');

        const live = handle.tiles.filter((t) => !found.has(t.userData.index));
        const answer = await ctx.prompt({ options, meshes: live });
        if (answer.id === 'cash') {
          ctx.audio.play('cash');
          await revealAll(ctx, handle, field, found);
          return { multiplier, headline: '×' + multiplier.toFixed(2) + ' banked',
                   tone: 'win', detail: { cleared: found.size, mines } };
        }

        const index = answer.object.userData.index;
        if (field[index]) {
          await pop(ctx, answer.object, 0xf0616d, '💣');
          ctx.audio.play('bust');
          await revealAll(ctx, handle, field, found);
          return { multiplier: 0, headline: 'MINE', tone: 'lose',
                   detail: { cleared: found.size, mines } };
        }

        found.add(index);
        multiplier = payout(mines, found.size);
        await pop(ctx, answer.object, 0x5cd98c, '💎');
        ctx.audio.play('win');
      }

      ctx.audio.play('big');
      return { multiplier, headline: 'FIELD CLEARED', tone: 'huge',
               detail: { cleared: found.size, mines } };
    },
  });

  const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');

  function layMines(ctx, mines) {
    const field = new Array(N).fill(false);
    if (ctx.store.s.mods.xray) ctx.announce('X-ray on. The loaded tiles glow.', 'warn');
    const order = ctx.rng.shuffle(Array.from({ length: N }, (_, i) => i));
    for (let i = 0; i < mines; i++) field[order[i]] = true;
    return field;
  }

  function reset(tile) {
    tile.material.color.setHex(0x39424a);
    tile.material.emissive.setHex(0x000000);
    tile.material.emissiveIntensity = 0;
    tile.material.opacity = 1;
    tile.material.transparent = false;
    tile.position.y = 0.05;
    tile.scale.setScalar(1);
    tile.visible = true;
  }

  /* A turned tile drops, flashes its colour and settles. */
  async function pop(ctx, tile, colour, glyph) {
    tile.material.color.setHex(colour);
    tile.material.emissive.setHex(colour);
    tile.userData.glyph = glyph;
    await ctx.animate(0.32, (t) => {
      tile.material.emissiveIntensity = 0.8 * (1 - t) + 0.16;
      tile.position.y = 0.05 + Math.sin(t * Math.PI) * 0.13;
      tile.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.11);
    }, GWGames.EASE.outCubic);
    tile.position.y = 0.05;
    tile.scale.setScalar(1);
  }

  /* Show the board once the hand is over: everybody gets to see where they were. */
  async function revealAll(ctx, handle, field, found) {
    const hidden = handle.tiles.filter((t) => !found.has(t.userData.index));
    await ctx.animate(0.45, (t) => {
      for (const tile of hidden) {
        const mine = field[tile.userData.index];
        tile.material.color.setHex(mine ? 0x8e2530 : 0x24312a);
        tile.material.emissive.setHex(mine ? 0x8e2530 : 0x000000);
        tile.material.emissiveIntensity = mine ? 0.25 * t : 0;
        tile.position.y = 0.05 - 0.02 * t;
      }
    });
  }
})();
