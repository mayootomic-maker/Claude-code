/* Crash.

   The multiplier climbs from 1.00 and stops at a number drawn before the round
   starts. Cash out first and you keep it; leave it a moment too long and you
   keep nothing.

   The draw is the standard one: with u uniform on (0,1], the bust point is
   0.96/u. That makes the chance of ever reaching x exactly 0.96/x, so cashing
   out at any target returns 96% -- there is no clever number to leave it at.
   Four percent of rounds bust at 1.00 before the curve moves at all, and the
   odds panel says so. */

(function () {
  'use strict';

  const CUT = 0.96;
  const RATE = 0.21;          // e^(RATE * t): doubles in about 3.3 seconds
  const SPAN = 6.2;           // world units across the plot
  const HEIGHT = 3.0;
  const MAX_POINTS = 900;

  const reach = (x) => Math.min(1, CUT / x);   // chance of the curve ever touching x

  GWGames.register({
    id: 'crash',
    name: 'Crash',
    icon: '📈',
    floor: 2,
    blurb: 'A number that goes up until it does not. There is no skill in when '
         + 'to jump, only nerve, and nerve is not an edge.',
    bets: [
      { id: 'ride', label: 'Ride it', pays: CUT, prob: 1,
        note: 'Cash out at any multiplier. All of them return the same 96%.' },
    ],
    paysAsRtp: true,
    skillBased: true,

    oddsRows() {
      return [1.2, 1.5, 2, 5, 10, 50].map((x) => ({
        label: 'Reaches ×' + x.toFixed(x < 10 ? 1 : 0), pays: x, prob: reach(x),
      })).concat([{ label: 'Busts instantly at ×1.00', text: '4.0% of rounds' }]);
    },

    build(ctx) {
      const g = new THREE.Group();
      g.add(GWStage.room({ accent: '#4fbf7b' }));

      const FLOOR = GWStage.FLOOR_Y;
      const BASE_Y = 0.55;               // where the bottom of the screen sits
      const rig = new THREE.Group();
      rig.position.y = BASE_Y;
      g.add(rig);

      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(SPAN + 0.9, HEIGHT + 0.7),
        new THREE.MeshStandardMaterial({ color: 0x0b1c15, roughness: 0.92,
                                        emissive: 0x0a2018, emissiveIntensity: 0.9 })
      );
      screen.position.set(0, HEIGHT / 2 - 0.05, -0.02);
      rig.add(screen);

      // Bezel and stand: without them the chart is a rectangle of light hanging
      // in a room, which is exactly what it looked like.
      const bezelMat = new THREE.MeshStandardMaterial({ color: 0x1d1512, roughness: 0.5, metalness: 0.3 });
      const bw = SPAN + 1.25, bh = HEIGHT + 1.05;
      for (const [w, h, x, y] of [
        [bw, 0.18, 0, HEIGHT / 2 - 0.05 + bh / 2 - 0.09],
        [bw, 0.18, 0, HEIGHT / 2 - 0.05 - bh / 2 + 0.09],
        [0.18, bh, -bw / 2 + 0.09, HEIGHT / 2 - 0.05],
        [0.18, bh, bw / 2 - 0.09, HEIGHT / 2 - 0.05],
      ]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.26), bezelMat);
        bar.position.set(x, y, -0.06);
        bar.castShadow = true;
        rig.add(bar);
      }

      const neckH = BASE_Y - FLOOR - 0.1;
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.42, neckH, 0.24), bezelMat);
      neck.position.set(0, FLOOR + 0.1 + neckH / 2, -0.06);
      neck.castShadow = true;
      g.add(neck);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.12, 28), bezelMat);
      foot.position.set(0, FLOOR + 0.06, -0.06);
      foot.receiveShadow = true;
      g.add(foot);

      // Gridlines at the multipliers people actually aim at.
      const gridMat = new THREE.LineBasicMaterial({ color: 0x2c4038, transparent: true, opacity: 0.85 });
      for (const x of [1.5, 2, 3, 5, 10]) {
        const y = yFor(x);
        if (y > HEIGHT) continue;
        const pts = [new THREE.Vector3(-SPAN / 2, y, 0.01), new THREE.Vector3(SPAN / 2, y, 0.01)];
        rig.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
        rig.add(tag('×' + x, -SPAN / 2 - 0.30, y));
      }

      const positions = new Float32Array(MAX_POINTS * 3);
      const curveGeo = new THREE.BufferGeometry();
      curveGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      curveGeo.setDrawRange(0, 0);
      const curve = new THREE.Line(curveGeo, new THREE.LineBasicMaterial({ color: 0x5cd98c }));
      rig.add(curve);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.085, 18, 12),
        new THREE.MeshStandardMaterial({ color: 0x5cd98c, emissive: 0x5cd98c, emissiveIntensity: 2.2 })
      );
      head.visible = false;
      rig.add(head);

      const glow = new THREE.PointLight(0x5cd98c, 0, 4);
      rig.add(glow);

      ctx.group.add(g);
      ctx.stage.frame([0, 2.05, 4.85], [0, 1.62, 0], 3.0);

      return { root: g, curve, curveGeo, positions, head, glow, dispose() { curveGeo.dispose(); } };
    },

    async play(ctx, handle, bet) {
      const bust = drawBust(ctx);
      handle.curveGeo.setDrawRange(0, 0);
      handle.head.visible = true;
      setColour(handle, 0x5cd98c);

      let cashed = null;
      let n = 0;
      const started = { t: 0 };

      // The prompt runs alongside the climb. Whichever finishes first ends the
      // round: the player's nerve, or the number's.
      const bail = ctx.prompt({
        options: [{ id: 'cash', label: 'CASH OUT', tone: 'cash', hint: 'Take it before it goes' }],
      });
      bail.then((answer) => { if (answer && answer.id === 'cash') cashed = multAt(started.t); });

      await ctx.until((dt) => {
        started.t += dt;
        const m = multAt(started.t);
        if (cashed !== null) return true;
        if (m >= bust) return true;

        const x = -SPAN / 2 + Math.min(started.t / 12, 1) * SPAN;
        const y = Math.min(yFor(m), HEIGHT);
        if (n < MAX_POINTS) {
          handle.positions[n * 3] = x;
          handle.positions[n * 3 + 1] = y;
          handle.positions[n * 3 + 2] = 0;
          n++;
          handle.curveGeo.setDrawRange(0, n);
          handle.curveGeo.attributes.position.needsUpdate = true;
        }
        handle.head.position.set(x, y, 0);
        handle.glow.position.set(x, y, 0.4);
        handle.glow.intensity = 2 + Math.min(m, 6);
        ctx.live('×' + m.toFixed(2), m >= 2 ? 'huge' : 'win');
        return false;
      });

      if (bail.cancel) bail.cancel();

      if (cashed !== null) {
        ctx.live(null);
        ctx.audio.play('cash');
        return { multiplier: cashed, headline: '×' + cashed.toFixed(2),
                 tone: cashed >= 3 ? 'huge' : 'win', detail: { bust, cashed } };
      }

      setColour(handle, 0xf0616d);
      ctx.live('×' + bust.toFixed(2), 'lose');
      ctx.audio.play('bust');
      await ctx.animate(0.6, (t) => {
        handle.head.position.y -= t * 0.03;
        handle.glow.intensity = 8 * (1 - t);
      });
      ctx.live(null);
      handle.head.visible = false;
      return { multiplier: 0, headline: 'BUST AT ×' + bust.toFixed(2), tone: 'lose',
               detail: { bust } };
    },
  });

  const multAt = (t) => Math.exp(RATE * t);
  const yFor = (m) => Math.log(m) / Math.log(60) * HEIGHT;

  function setColour(handle, hex) {
    handle.curve.material.color.setHex(hex);
    handle.head.material.color.setHex(hex);
    handle.head.material.emissive.setHex(hex);
    handle.glow.color.setHex(hex);
  }

  function drawBust(ctx) {
    const mods = ctx.store.s.mods;
    if (mods.alwaysWin) return 1000;
    if (mods.alwaysLose) return 1;
    const u = Math.max(ctx.rng.next(), 1e-9);
    const x = CUT / u;
    // Below one is an instant bust, which is where the four percent lives.
    return x < 1 ? 1 : Math.floor(x * 100) / 100;
  }

  function tag(text, x, y) {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 48;
    const g = c.getContext('2d');
    g.fillStyle = '#a89890';
    g.font = '600 26px Inter, system-ui, sans-serif';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText(text, 90, 26);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.52, 0.26),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    mesh.position.set(x, y, 0.015);
    return mesh;
  }
})();
