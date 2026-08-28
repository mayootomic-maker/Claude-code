/* Blackjack, by the book.

   Six decks, dealer stands on all seventeen, blackjack pays three to two,
   double on any first two cards, no splitting and no insurance. Those rules are
   what the 99.5% on the odds panel refers to and they are printed there rather
   than buried, because unlike everything else in the building this game's return
   depends on the player: played badly the edge is several percent.

   Cards lie flat by rotating -90 degrees about X, which points their printed
   face at the ceiling. Face down is +90 instead, so turning one over is a single
   animated rotation through zero -- and at zero the card is standing on its
   edge, which is exactly what you want to see in the middle of a flip. */

(function () {
  'use strict';

  const DECKS = 6;
  const RESHUFFLE_AT = 60;
  const SPREAD = GWCards.CARD_W * 0.74;
  const FACE_UP = -Math.PI / 2;
  const FACE_DOWN = Math.PI / 2;

  const SEATS = {
    player: { z: 0.92, y: 0.014 },
    dealer: { z: -1.02, y: 0.014 },
  };

  GWGames.register({
    id: 'blackjack',
    name: 'Blackjack',
    icon: '🃏',
    floor: 1,
    blurb: 'The one game in the building where being good at it matters. The '
         + 'dealer stands on all seventeens and a natural pays three to two.',
    bets: [
      { id: 'hand', label: 'Deal', pays: 0.995, prob: 1,
        note: 'Returns about 99.5% played well. Rather less played badly.' },
    ],
    paysAsRtp: true,
    skillBased: true,

    oddsRows() {
      return [
        { label: 'Blackjack pays', text: '3 to 2' },
        { label: 'Dealer stands on', text: 'all 17s, hard and soft' },
        { label: 'Double down', text: 'any first two cards' },
        { label: 'Split / insurance', text: 'not offered' },
        { label: 'Decks in the shoe', text: String(DECKS) },
      ];
    },

    build(ctx) {
      const g = new THREE.Group();
      g.add(GWStage.room({ accent: '#e8505f' }));
      g.add(GWStage.table({ radius: 2.1, colour: 0x113e27 }));

      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(1.40, 0.007, 6, 96, Math.PI * 0.9),
        new THREE.MeshBasicMaterial({ color: 0xe9b44c })
      );
      arc.rotation.x = -Math.PI / 2;
      arc.rotation.z = Math.PI * 1.05;
      arc.position.y = 0.005;
      g.add(arc);

      // A rack of chips at the dealer's right hand and a spot to bet on. An
      // empty circle of baize is technically a blackjack table and reads as an
      // unfinished one.
      const trayMat = new THREE.MeshStandardMaterial({ color: 0x1d1512, roughness: 0.55, metalness: 0.25 });
      const tray = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.10, 0.34), trayMat);
      tray.position.set(1.30, 0.05, -0.62);
      tray.rotation.y = -0.38;
      tray.castShadow = true;
      tray.receiveShadow = true;
      g.add(tray);
      ['chip100', 'chip25', 'chip5', 'chip1'].forEach((name, i) => {
        for (let k = 0; k < 4 - (i % 2); k++) {
          const chip = ctx.model(name);
          chip.scale.setScalar(0.30);
          chip.position.set(1.30, 0.115 + k * 0.036, -0.62);
          chip.translateOnAxis(new THREE.Vector3(Math.cos(-0.38), 0, -Math.sin(-0.38)), (i - 1.5) * 0.24);
          chip.rotation.y = ctx.rng.float(0, 6.28);
          g.add(chip);
        }
      });

      const spot = new THREE.Mesh(
        new THREE.RingGeometry(0.30, 0.335, 48),
        new THREE.MeshBasicMaterial({ color: 0xe9b44c, transparent: true, opacity: 0.55 })
      );
      spot.rotation.x = -Math.PI / 2;
      spot.position.set(0, 0.004, 1.42);
      g.add(spot);
      g.add(plaque('DEALER STANDS ON ALL 17s', 1.5, 0.19, 0, 0.005, -1.62));

      const shoe = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.30, 0.68),
        new THREE.MeshPhysicalMaterial({ color: 0x241715, roughness: 0.4, clearcoat: 0.6 })
      );
      shoe.position.set(-1.45, 0.15, -0.72);
      shoe.rotation.y = 0.38;
      shoe.castShadow = true;
      shoe.receiveShadow = true;
      g.add(shoe);

      ctx.group.add(g);
      ctx.stage.frame([0, 2.85, 3.05], [0, 0.02, -0.04], 3.0);

      return {
        root: g,
        origin: new THREE.Vector3(-1.42, 0.32, -0.72),
        deck: [],
        hands: { player: [], dealer: [] },
        dispose() { clearTable(this); },
      };
    },

    async play(ctx, handle, bet) {
      clearTable(handle);
      if (handle.deck.length < RESHUFFLE_AT) {
        handle.deck = shuffledShoe(ctx.rng);
        ctx.announce('New shoe. Six decks, cut and loaded.', 'flat');
      }

      const player = handle.hands.player;
      const dealer = handle.hands.dealer;

      await deal(ctx, handle, 'player', true);
      await deal(ctx, handle, 'dealer', false);   // the hole card
      await deal(ctx, handle, 'player', true);
      await deal(ctx, handle, 'dealer', true);

      const value = (hand) => GWCards.handValue(hand.map((c) => c.spec));
      const natural = value(player).total === 21;
      const dealerNatural = value(dealer).total === 21;

      if (natural || dealerNatural) {
        await turnOver(ctx, dealer[0]);
        if (natural && dealerNatural) {
          ctx.audio.play('chip');
          return { multiplier: 1, headline: 'BOTH NATURAL', tone: 'push', detail: read(player, dealer) };
        }
        if (natural) {
          ctx.audio.play('big');
          return { multiplier: 2.5, headline: 'BLACKJACK', tone: 'huge', detail: read(player, dealer) };
        }
        ctx.audio.play('lose');
        return { multiplier: 0, headline: 'DEALER BLACKJACK', tone: 'lose', detail: read(player, dealer) };
      }

      let doubled = false;
      while (value(player).total < 21) {
        const v = value(player);
        const options = [
          { id: 'hit', label: 'Hit' },
          { id: 'stand', label: 'Stand' },
        ];
        if (player.length === 2 && ctx.store.canBet(ctx.stake)) {
          options.push({ id: 'double', label: 'Double', tone: 'gold',
                         hint: 'Another ' + money(ctx.stake) + ', one more card, then you stand.' });
        }
        // The marked deck shows the colour of the next card off the shoe. It is
        // a real edge and a small one, which is what it costs.
        if (ctx.store.has('markeddeck') && handle.deck.length) {
          const next = handle.deck[handle.deck.length - 1];
          const red = next.suit === 'h' || next.suit === 'd';
          ctx.setStatus('You have ' + describe(v) + '. Dealer shows ' + dealer[1].spec.rank
            + '. The marked deck says the next card is ' + (red ? 'red' : 'black') + '.');
        } else {
          ctx.setStatus('You have ' + describe(v) + '. Dealer shows ' + dealer[1].spec.rank + '.');
        }

        const answer = await ctx.prompt({ options });
        if (answer.id === 'stand') break;
        if (answer.id === 'double') {
          if (!ctx.raiseStake(ctx.stake)) {
            ctx.announce('The account will not cover a double.', 'bad');
            continue;
          }
          doubled = true;
          ctx.audio.play('cash');
          await deal(ctx, handle, 'player', true);
          break;
        }
        await deal(ctx, handle, 'player', true);
      }

      const p = value(player);
      if (p.total > 21) {
        await turnOver(ctx, dealer[0]);
        ctx.audio.play('bust');
        return { multiplier: 0, headline: 'BUST · ' + p.total, tone: 'lose',
                 detail: read(player, dealer, doubled) };
      }

      ctx.setStatus('Dealer plays.');
      await turnOver(ctx, dealer[0]);
      while (value(dealer).total < 17) {
        await ctx.wait(0.3);
        await deal(ctx, handle, 'dealer', true);
      }

      const d = value(dealer);
      let multiplier, headline, tone;
      if (d.total > 21) { multiplier = 2; headline = 'DEALER BUSTS · ' + d.total; tone = 'win'; }
      else if (p.total > d.total) { multiplier = 2; headline = p.total + ' beats ' + d.total; tone = 'win'; }
      else if (p.total < d.total) { multiplier = 0; headline = d.total + ' beats ' + p.total; tone = 'lose'; }
      else { multiplier = 1; headline = 'PUSH ON ' + p.total; tone = 'push'; }

      if (ctx.store.s.mods.alwaysWin && multiplier < 2) {
        multiplier = 2; headline = 'THE DEALER MISCOUNTS'; tone = 'win';
      }
      ctx.audio.play(tone === 'win' ? 'win' : tone === 'push' ? 'chip' : 'lose');
      return { multiplier, headline, tone, detail: read(player, dealer, doubled) };
    },
  });

  /* --- table ---------------------------------------------------------------- */

  function shuffledShoe(rng) {
    let cards = [];
    for (let i = 0; i < DECKS; i++) cards = cards.concat(GWCards.deck());
    return rng.shuffle(cards);
  }

  function clearTable(handle) {
    for (const seat of ['player', 'dealer']) {
      for (const card of handle.hands[seat]) {
        if (card.mesh.parent) card.mesh.parent.remove(card.mesh);
        card.mesh.geometry.dispose();
      }
      handle.hands[seat].length = 0;
    }
  }

  function slotFor(seat, index, count) {
    const s = SEATS[seat];
    return new THREE.Vector3((index - (count - 1) / 2) * SPREAD, s.y + index * 0.004, s.z);
  }

  /* Deal one card out of the shoe on an arc, turning it over on the way if it
     is going face up. Cards already down slide across to keep the hand centred,
     so a five-card hand does not walk off the felt. */
  async function deal(ctx, handle, seat, faceUp) {
    const spec = handle.deck.pop();
    const mesh = GWCards.card(spec.rank, spec.suit);
    const hand = handle.hands[seat];
    const card = { spec, mesh, faceUp };
    hand.push(card);
    handle.root.add(mesh);

    const count = hand.length;
    const settled = hand.slice(0, -1).map((c, i) => ({
      card: c, from: c.mesh.position.clone(), to: slotFor(seat, i, count),
    }));
    const target = slotFor(seat, count - 1, count);
    const from = handle.origin.clone();

    mesh.position.copy(from);
    mesh.rotation.set(FACE_DOWN, 0, 0.55);

    ctx.audio.play('chip');
    await ctx.animate(0.40, (t) => {
      mesh.position.lerpVectors(from, target, t);
      mesh.position.y = from.y + (target.y - from.y) * t + Math.sin(t * Math.PI) * 0.40;
      // Face down stays face down; face up turns over across the flight.
      mesh.rotation.x = faceUp ? FACE_DOWN + (FACE_UP - FACE_DOWN) * t : FACE_DOWN;
      mesh.rotation.z = 0.55 * (1 - t);
      for (const s of settled) s.card.mesh.position.lerpVectors(s.from, s.to, t);
    }, GWGames.EASE.outCubic);

    mesh.position.copy(target);
    mesh.rotation.set(faceUp ? FACE_UP : FACE_DOWN, 0, 0);
    for (const s of settled) s.card.mesh.position.copy(s.to);
    return card;
  }

  async function turnOver(ctx, card) {
    if (!card || card.faceUp) return;
    const y = card.mesh.position.y;
    ctx.audio.play('chip');
    await ctx.animate(0.38, (t) => {
      card.mesh.rotation.x = FACE_DOWN + (FACE_UP - FACE_DOWN) * t;
      card.mesh.position.y = y + Math.sin(t * Math.PI) * 0.10;
    }, GWGames.EASE.inOutCubic);
    card.mesh.rotation.x = FACE_UP;
    card.mesh.position.y = y;
    card.faceUp = true;
  }

  /* Baize lettering: a canvas laid flat on the cloth. */
  function plaque(text, w, h, x, y, z) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 512, 64);
    g.fillStyle = 'rgba(233,180,76,0.72)';
    g.font = '600 30px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    return mesh;
  }

  const describe = (v) => (v.soft ? 'soft ' : '') + v.total;
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const label = (c) => c.spec.rank + c.spec.suit;

  function read(player, dealer, doubled) {
    return {
      player: player.map(label),
      dealer: dealer.map(label),
      playerTotal: GWCards.handValue(player.map((c) => c.spec)).total,
      dealerTotal: GWCards.handValue(dealer.map((c) => c.spec)).total,
      doubled: !!doubled,
    };
  }
})();
