/* The tasks.

   Twenty-one of them, each with its own mechanic, because the task list is
   the crew's whole job and a list of five reskinned progress bars is how a
   social deduction game turns into a chat room with walking. They also have a
   second job people forget: an impostor standing at a console has to look
   busy for exactly as long as the real thing takes, so every one of these has
   a believable duration and none of them can be finished instantly.

   All of them are drawn on one canvas at a fixed logical size and scaled to
   fit, which is what makes them work identically under a mouse and a thumb.
   Hit targets are sized for a thumb first; a mouse can always hit a big
   target, and the reverse is not true. */

(function (NS) {
  'use strict';

  const U = NS.util;
  const el = U.el;

  const INK = '#cfd9e8';
  const DIM = '#7c8aa3';
  const STEEL = '#2c3648';
  const DEEP = '#0d1320';
  const FLARE = '#ffb03a';
  const VITAL = '#34e0b8';
  const BLOOD = '#ff3f5b';

  const rr = NS.characters.rr;

  /* ---- the frame every task sits in -------------------------------------- */

  let open = null;

  function panel(spec, api) {
    close(true);
    const game = {
      spec, api, state: {}, t: 0, done: false, closing: false,
      pointer: { x: 0, y: 0, down: false, dx: 0, dy: 0 },
    };

    const root = el('div', { class: 'mg', role: 'dialog', 'aria-modal': 'true', 'aria-label': spec.title });
    const box = el('div', { class: 'mg-box' });
    const head = el('header', { class: 'mg-head' }, [
      el('div', { class: 'mg-title' }, [
        el('h2', { text: spec.title }),
        el('p', { text: spec.hint || '' }),
      ]),
      el('button', {
        class: 'mg-close', type: 'button', 'aria-label': 'Leave the task',
        onclick: () => close(),
      }, [el('span', { text: 'Leave' })]),
    ]);
    const stage = el('div', { class: 'mg-stage' });
    const canvas = el('canvas');
    stage.appendChild(canvas);
    const foot = el('div', { class: 'mg-foot' }, [
      el('div', { class: 'mg-step', text: spec.step || '' }),
      el('div', { class: 'mg-bar' }, [el('i')]),
    ]);
    box.appendChild(head);
    box.appendChild(stage);
    box.appendChild(foot);
    root.appendChild(box);
    document.body.appendChild(root);
    document.body.classList.add('in-task');

    game.root = root;
    game.canvas = canvas;
    game.ctx = canvas.getContext('2d');
    game.bar = foot.querySelector('.mg-bar i');
    game.progress = 0;

    const W = spec.w || 460, H = spec.h || 300;
    game.W = W; game.H = H;

    /* The stage is as wide as the panel and as tall as the window can spare.
       Measuring the stage's own height would be circular -- it gets its height
       from this canvas -- which is what left the first build drawing a small
       panel in the middle of a large empty one. */
    function fit() {
      const rect = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const availW = Math.max(220, rect.width || (box.clientWidth - 28));
      const availH = Math.max(200, window.innerHeight - 250);
      const s = Math.min(availW / W, availH / H);
      game.scale = s;
      canvas.style.width = Math.round(W * s) + 'px';
      canvas.style.height = Math.round(H * s) + 'px';
      canvas.width = Math.round(W * s * dpr);
      canvas.height = Math.round(H * s * dpr);
      game.ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
    }
    game.fit = fit;
    fit();
    requestAnimationFrame(fit);
    window.addEventListener('resize', fit);

    function local(e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * W,
        y: ((e.clientY - rect.top) / rect.height) * H,
      };
    }

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      game.pointer.x = p.x; game.pointer.y = p.y; game.pointer.down = true;
      if (spec.down) spec.down(game, p.x, p.y);
      NS.audio.play('tap');
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = local(e);
      game.pointer.dx = p.x - game.pointer.x;
      game.pointer.dy = p.y - game.pointer.y;
      game.pointer.x = p.x; game.pointer.y = p.y;
      if (spec.move) spec.move(game, p.x, p.y);
    });
    const release = (e) => {
      if (!game.pointer.down) return;
      game.pointer.down = false;
      const p = local(e);
      if (spec.up) spec.up(game, p.x, p.y);
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    game.finish = function () {
      if (game.done) return;
      game.done = true;
      game.progress = 1;
      NS.audio.play('taskDone');
      box.classList.add('is-done');
      setTimeout(() => { if (api.onDone) api.onDone(); close(true); }, 620);
    };
    game.fail = function () {
      NS.audio.play('taskFail');
      box.classList.add('is-wrong');
      setTimeout(() => box.classList.remove('is-wrong'), 320);
    };
    game.setProgress = function (v) {
      game.progress = U.clamp(v, 0, 1);
      game.bar.style.transform = 'scaleX(' + game.progress.toFixed(3) + ')';
    };

    if (spec.init) spec.init(game);
    open = game;
    NS.audio.play('taskOpen');

    let last = U.now();
    function frame() {
      if (open !== game) return;
      const now = U.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      game.t += dt;
      if (spec.update && !game.done) spec.update(game, dt);
      game.ctx.clearRect(0, 0, W, H);
      spec.draw(game, game.ctx);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    game.teardown = function () {
      window.removeEventListener('resize', fit);
      document.body.classList.remove('in-task');
      root.remove();
    };
    return game;
  }

  function close(silent) {
    if (!open) return;
    const game = open;
    open = null;
    game.teardown();
    if (!silent && game.api.onClose) game.api.onClose();
  }

  /* ---- shared drawing ---------------------------------------------------- */

  function plate(ctx, x, y, w, h, fill) {
    ctx.fillStyle = fill || DEEP;
    rr(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1.5;
    rr(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, 10);
    ctx.stroke();
  }

  function label(ctx, text, x, y, size, colour, align) {
    ctx.font = '700 ' + (size || 13) + 'px Archivo, system-ui, sans-serif';
    ctx.fillStyle = colour || DIM;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  function mono(ctx, text, x, y, size, colour, align) {
    ctx.font = '700 ' + (size || 15) + 'px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = colour || INK;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  const hit = (x, y, bx, by, bw, bh) => x >= bx && x <= bx + bw && y >= by && y <= by + bh;

  /* ---- the tasks --------------------------------------------------------- */

  const WIRE_COLOURS = ['#e8563f', '#3d6fe0', '#f0a63c', '#f18fb0', '#4ca85c'];

  const GAMES = {

    wiring: {
      title: 'Fix Wiring', hint: 'Drag each wire across to the same colour.',
      w: 460, h: 300,
      init(g) {
        const n = 4;
        const order = U.shuffle([0, 1, 2, 3, 4], Math.random).slice(0, n);
        const right = U.shuffle(order, Math.random);
        g.state = { n, left: order, right, joined: {}, dragging: null, count: 0 };
      },
      down(g, x, y) {
        const s = g.state;
        for (let i = 0; i < s.n; i++) {
          if (s.joined[i] !== undefined) continue;
          if (U.dist(x, y, 92, 58 + i * 62) < 34) { s.dragging = i; return; }
        }
      },
      up(g, x, y) {
        const s = g.state;
        if (s.dragging === null) return;
        for (let k = 0; k < s.n; k++) {
          if (U.dist(x, y, 368, 58 + k * 62) < 38) {
            if (s.right[k] === s.left[s.dragging]) {
              s.joined[s.dragging] = k;
              s.count++;
              NS.audio.play('taskStep');
              g.setProgress(s.count / s.n);
              if (s.count >= s.n) g.finish();
            } else g.fail();
            break;
          }
        }
        s.dragging = null;
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#151d2c');
        label(ctx, 'PORT', 92, 24, 11, DIM, 'center');
        label(ctx, 'STARBOARD', 368, 24, 11, DIM, 'center');
        for (let i = 0; i < s.n; i++) {
          const y = 58 + i * 62;
          ctx.fillStyle = STEEL;
          rr(ctx, 40, y - 22, 52, 44, 6); ctx.fill();
          rr(ctx, 368, y - 22, 52, 44, 6); ctx.fill();
          ctx.fillStyle = WIRE_COLOURS[s.left[i]];
          rr(ctx, 68, y - 13, 26, 26, 5); ctx.fill();
          ctx.fillStyle = WIRE_COLOURS[s.right[i]];
          rr(ctx, 366, y - 13, 26, 26, 5); ctx.fill();
        }
        ctx.lineCap = 'round';
        ctx.lineWidth = 11;
        for (let i = 0; i < s.n; i++) {
          if (s.joined[i] === undefined) continue;
          ctx.strokeStyle = WIRE_COLOURS[s.left[i]];
          ctx.beginPath();
          ctx.moveTo(92, 58 + i * 62);
          ctx.lineTo(368, 58 + s.joined[i] * 62);
          ctx.stroke();
        }
        if (s.dragging !== null) {
          ctx.strokeStyle = WIRE_COLOURS[s.left[s.dragging]];
          ctx.beginPath();
          ctx.moveTo(92, 58 + s.dragging * 62);
          ctx.lineTo(g.pointer.x, g.pointer.y);
          ctx.stroke();
        }
      },
    },

    swipe: {
      title: 'Swipe Card', hint: 'Drag the card through the reader, steadily.',
      w: 460, h: 300, step: 'Not too fast, not too slow.',
      init(g) { g.state = { cx: 60, held: false, start: 0, startX: 0, verdict: '', flash: 0 }; },
      down(g, x, y) {
        const s = g.state;
        if (hit(x, y, s.cx - 52, 176, 104, 68)) { s.held = true; s.start = g.t; s.startX = x; s.verdict = ''; }
      },
      move(g, x) { if (g.state.held) g.state.cx = U.clamp(x, 40, 430); },
      up(g) {
        const s = g.state;
        if (!s.held) return;
        s.held = false;
        const travelled = s.cx - s.startX;
        const took = g.t - s.start;
        if (travelled < 250) { s.verdict = 'Too short. Take it all the way through.'; s.flash = 1; }
        else if (took < 0.42) { s.verdict = 'Too fast.'; s.flash = 1; }
        else if (took > 1.9) { s.verdict = 'Too slow.'; s.flash = 1; }
        else { g.finish(); return; }
        g.fail();
        s.cx = 60;
      },
      update(g, dt) { if (g.state.flash > 0) g.state.flash -= dt * 2; },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#151d2c');
        plate(ctx, 34, 60, g.W - 68, 92, '#0a0f1a');
        ctx.fillStyle = STEEL;
        rr(ctx, 44, 74, g.W - 88, 64, 8); ctx.fill();
        ctx.fillStyle = s.verdict ? BLOOD : VITAL;
        ctx.globalAlpha = s.verdict ? 0.5 + Math.max(0, s.flash) * 0.5 : 0.75;
        rr(ctx, 56, 88, 16, 36, 4); ctx.fill();
        ctx.globalAlpha = 1;
        mono(ctx, s.verdict || 'AURORA-7 CREW ACCESS', 90, 106, 13, s.verdict ? BLOOD : VITAL);
        ctx.fillStyle = '#39435c';
        rr(ctx, 34, 168, g.W - 68, 84, 8); ctx.fill();
        ctx.fillStyle = '#10182a';
        rr(ctx, 40, 174, g.W - 80, 72, 6); ctx.fill();
        /* The card */
        const cg = ctx.createLinearGradient(s.cx - 52, 176, s.cx + 52, 244);
        cg.addColorStop(0, '#e8e2d4'); cg.addColorStop(1, '#b9b2a2');
        ctx.fillStyle = cg;
        rr(ctx, s.cx - 52, 176, 104, 68, 7); ctx.fill();
        ctx.fillStyle = FLARE;
        rr(ctx, s.cx - 42, 188, 26, 20, 3); ctx.fill();
        ctx.fillStyle = 'rgba(20,26,40,0.5)';
        rr(ctx, s.cx - 42, 216, 76, 5, 2); ctx.fill();
        rr(ctx, s.cx - 42, 226, 52, 5, 2); ctx.fill();
      },
    },

    calibrate: {
      title: 'Calibrate Distributor', hint: 'Tap when the marker crosses the green.',
      w: 460, h: 300,
      init(g) { g.state = { round: 0, need: 3, angle: 0, speed: 2.2, target: 0, lock: 0 }; g.state.target = Math.random() * Math.PI * 2; },
      down(g) {
        const s = g.state;
        if (s.lock > 0) return;
        let d = Math.abs(((s.angle - s.target + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        d = Math.PI - d;
        if (d < 0.28) {
          s.round++;
          NS.audio.play('taskStep');
          g.setProgress(s.round / s.need);
          if (s.round >= s.need) { g.finish(); return; }
          s.speed += 0.7;
          s.target = Math.random() * Math.PI * 2;
          s.lock = 0.35;
        } else { g.fail(); s.speed = Math.max(1.8, s.speed - 0.3); }
      },
      update(g, dt) {
        const s = g.state;
        if (s.lock > 0) s.lock -= dt;
        s.angle = (s.angle + s.speed * dt) % (Math.PI * 2);
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#151d2c');
        const cx = g.W / 2, cy = g.H / 2 + 6, r = 96;
        ctx.strokeStyle = '#242f45'; ctx.lineWidth = 26;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = VITAL; ctx.lineWidth = 26;
        ctx.beginPath(); ctx.arc(cx, cy, r, s.target - 0.28, s.target + 0.28); ctx.stroke();
        ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(s.angle) * (r - 20), cy + Math.sin(s.angle) * (r - 20));
        ctx.lineTo(cx + Math.cos(s.angle) * (r + 20), cy + Math.sin(s.angle) * (r + 20));
        ctx.stroke();
        ctx.fillStyle = STEEL;
        ctx.beginPath(); ctx.arc(cx, cy, 44, 0, Math.PI * 2); ctx.fill();
        mono(ctx, s.round + ' / ' + s.need, cx, cy, 22, FLARE, 'center');
      },
    },

    shields: {
      title: 'Prime Shields', hint: 'Tap every dark panel.',
      w: 460, h: 300,
      init(g) {
        const cells = [];
        for (let i = 0; i < 7; i++) {
          const a = (i / 6) * Math.PI * 2;
          cells.push({
            x: i === 6 ? 0 : Math.cos(a) * 92, y: i === 6 ? 0 : Math.sin(a) * 82,
            on: Math.random() > 0.55,
          });
        }
        if (cells.every((c) => c.on)) cells[0].on = false;
        g.state = { cells };
      },
      down(g, x, y) {
        const s = g.state;
        const cx = g.W / 2, cy = g.H / 2;
        for (const c of s.cells) {
          if (U.dist(x, y, cx + c.x, cy + c.y) < 42 && !c.on) {
            c.on = true;
            NS.audio.play('taskStep');
            const done = s.cells.filter((k) => k.on).length;
            g.setProgress(done / s.cells.length);
            if (s.cells.every((k) => k.on)) g.finish();
            return;
          }
        }
      },
      draw(g, ctx) {
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#101827');
        const cx = g.W / 2, cy = g.H / 2;
        for (const c of g.state.cells) {
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
            const vx = cx + c.x + Math.cos(a) * 44, vy = cy + c.y + Math.sin(a) * 44;
            if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
          }
          ctx.closePath();
          ctx.fillStyle = c.on ? 'rgba(77,159,214,0.4)' : 'rgba(30,39,57,0.9)';
          ctx.fill();
          ctx.strokeStyle = c.on ? '#7cc4f0' : '#39435c';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      },
    },

    chart: {
      title: 'Chart Course', hint: 'Drag the ship along the route.',
      w: 460, h: 300,
      init(g) {
        const pts = [];
        let x = 50, y = 150;
        for (let i = 0; i < 6; i++) {
          pts.push({ x, y });
          x += 62 + Math.random() * 12;
          y = 60 + Math.random() * 180;
        }
        g.state = { pts, at: 0, ship: { x: pts[0].x, y: pts[0].y }, dragging: false };
      },
      down(g, x, y) {
        const s = g.state;
        if (U.dist(x, y, s.ship.x, s.ship.y) < 40) s.dragging = true;
      },
      move(g, x, y) {
        const s = g.state;
        if (!s.dragging) return;
        s.ship.x = x; s.ship.y = y;
        const next = s.pts[s.at + 1];
        if (next && U.dist(x, y, next.x, next.y) < 30) {
          s.at++;
          NS.audio.play('taskStep');
          g.setProgress(s.at / (s.pts.length - 1));
          if (s.at >= s.pts.length - 1) { s.dragging = false; g.finish(); }
        }
      },
      up(g) {
        const s = g.state;
        s.dragging = false;
        if (!g.done) { s.ship.x = s.pts[s.at].x; s.ship.y = s.pts[s.at].y; }
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#0a1120');
        for (let i = 0; i < 40; i++) {
          ctx.fillStyle = 'rgba(160,185,220,0.3)';
          ctx.fillRect(20 + ((i * 97) % 420), 24 + ((i * 53) % 250), 1.4, 1.4);
        }
        ctx.setLineDash([7, 7]);
        ctx.strokeStyle = 'rgba(77,159,214,0.55)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        ctx.setLineDash([]);
        s.pts.forEach((p, i) => {
          ctx.fillStyle = i <= s.at ? VITAL : '#39435c';
          ctx.beginPath(); ctx.arc(p.x, p.y, i === s.at + 1 ? 12 : 7, 0, Math.PI * 2); ctx.fill();
        });
        ctx.save();
        ctx.translate(s.ship.x, s.ship.y);
        ctx.fillStyle = FLARE;
        ctx.beginPath();
        ctx.moveTo(14, 0); ctx.lineTo(-10, -9); ctx.lineTo(-6, 0); ctx.lineTo(-10, 9);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      },
    },

    steering: {
      title: 'Stabilise Steering', hint: 'Hold the crosshair on the centre.',
      w: 460, h: 300,
      init(g) { g.state = { x: 0, y: 0, drift: 0, held: 0 }; },
      move(g, x, y) {
        if (!g.pointer.down) return;
        g.state.x = U.clamp((x - g.W / 2) / 110, -1, 1);
        g.state.y = U.clamp((y - g.H / 2) / 96, -1, 1);
      },
      update(g, dt) {
        const s = g.state;
        s.drift += dt;
        if (!g.pointer.down) {
          s.x += Math.sin(s.drift * 1.7) * dt * 0.6;
          s.y += Math.cos(s.drift * 1.3) * dt * 0.6;
          s.x = U.clamp(s.x, -1, 1); s.y = U.clamp(s.y, -1, 1);
        }
        const near = Math.hypot(s.x, s.y) < 0.16;
        s.held = near ? s.held + dt : Math.max(0, s.held - dt * 1.6);
        g.setProgress(s.held / 2.2);
        if (s.held >= 2.2) g.finish();
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#0a1120');
        const cx = g.W / 2, cy = g.H / 2;
        ctx.strokeStyle = '#243045'; ctx.lineWidth = 2;
        for (let r = 32; r <= 112; r += 40) {
          ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.14, r, 0, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.strokeStyle = Math.hypot(s.x, s.y) < 0.16 ? VITAL : '#39435c';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(cx, cy, 26, 23, 0, 0, Math.PI * 2); ctx.stroke();
        const px = cx + s.x * 110, py = cy + s.y * 96;
        ctx.strokeStyle = Math.hypot(s.x, s.y) < 0.16 ? VITAL : FLARE;
        ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px - 18, py); ctx.lineTo(px + 18, py);
        ctx.moveTo(px, py - 18); ctx.lineTo(px, py + 18);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.stroke();
      },
    },

    filter: {
      title: 'Clean O2 Filter', hint: 'Drag every leaf into the chute.',
      w: 460, h: 300,
      init(g) {
        const bits = [];
        for (let i = 0; i < 7; i++) {
          bits.push({
            x: 70 + Math.random() * 150, y: 70 + Math.random() * 150,
            r: Math.random() * Math.PI, gone: false, size: 14 + Math.random() * 8,
          });
        }
        g.state = { bits, holding: null, cleared: 0 };
      },
      down(g, x, y) {
        for (const b of g.state.bits) {
          if (!b.gone && U.dist(x, y, b.x, b.y) < 26) { g.state.holding = b; return; }
        }
      },
      move(g, x, y) {
        const b = g.state.holding;
        if (b) { b.x = x; b.y = y; }
      },
      up(g, x, y) {
        const s = g.state;
        if (!s.holding) return;
        if (x > 300 && y > 80 && y < 230) {
          s.holding.gone = true;
          s.cleared++;
          NS.audio.play('taskStep');
          g.setProgress(s.cleared / s.bits.length);
          if (s.cleared >= s.bits.length) g.finish();
        }
        s.holding = null;
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#151d2c');
        ctx.fillStyle = '#101827';
        rr(ctx, 40, 50, 230, 200, 12); ctx.fill();
        ctx.strokeStyle = '#39435c'; ctx.lineWidth = 3;
        rr(ctx, 40, 50, 230, 200, 12); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
        for (let i = 1; i < 8; i++) {
          ctx.beginPath(); ctx.moveTo(40 + i * 28, 50); ctx.lineTo(40 + i * 28, 250); ctx.stroke();
        }
        ctx.fillStyle = '#0a0f1a';
        rr(ctx, 302, 80, 118, 150, 10); ctx.fill();
        ctx.strokeStyle = VITAL; ctx.lineWidth = 2.5;
        rr(ctx, 302, 80, 118, 150, 10); ctx.stroke();
        label(ctx, 'CHUTE', 361, 100, 12, VITAL, 'center');
        for (const b of s.bits) {
          if (b.gone) continue;
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(b.r);
          ctx.fillStyle = '#4ca85c';
          ctx.beginPath(); ctx.ellipse(0, 0, b.size, b.size * 0.55, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#2f6b3c'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(-b.size, 0); ctx.lineTo(b.size, 0); ctx.stroke();
          ctx.restore();
        }
      },
    },

    manifold: {
      title: 'Unlock Manifolds', hint: 'Press one to ten, in order.',
      w: 460, h: 300,
      init(g) {
        const order = U.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], Math.random);
        g.state = { order, next: 1, wrong: 0 };
      },
      down(g, x, y) {
        const s = g.state;
        for (let i = 0; i < 10; i++) {
          const bx = 58 + (i % 5) * 74, by = 96 + Math.floor(i / 5) * 84;
          if (hit(x, y, bx, by, 64, 72)) {
            if (s.order[i] === s.next) {
              s.next++;
              NS.audio.play('taskStep');
              g.setProgress((s.next - 1) / 10);
              if (s.next > 10) g.finish();
            } else { s.wrong = 0.5; g.fail(); s.next = 1; }
            return;
          }
        }
      },
      update(g, dt) { if (g.state.wrong > 0) g.state.wrong -= dt; },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#151d2c');
        label(ctx, 'NEXT', 40, 52, 12, DIM);
        mono(ctx, String(s.next > 10 ? 10 : s.next), 92, 52, 22, FLARE);
        for (let i = 0; i < 10; i++) {
          const bx = 58 + (i % 5) * 74, by = 96 + Math.floor(i / 5) * 84;
          const done = s.order[i] < s.next;
          ctx.fillStyle = done ? 'rgba(52,224,184,0.18)' : STEEL;
          rr(ctx, bx, by, 64, 72, 8); ctx.fill();
          ctx.strokeStyle = done ? VITAL : (s.wrong > 0 ? BLOOD : '#3f4b66');
          ctx.lineWidth = 2.5;
          rr(ctx, bx, by, 64, 72, 8); ctx.stroke();
          mono(ctx, String(s.order[i]), bx + 32, by + 36, 26, done ? VITAL : INK, 'center');
        }
      },
    },

    telescope: {
      title: 'Align Telescope', hint: 'Turn both rings until the star is sharp.',
      w: 460, h: 300,
      init(g) {
        g.state = {
          a: Math.random() * Math.PI * 2, b: Math.random() * Math.PI * 2,
          ta: Math.random() * Math.PI * 2, tb: Math.random() * Math.PI * 2,
          grab: null, held: 0,
        };
      },
      down(g, x, y) {
        const cx = g.W / 2, cy = g.H / 2;
        const d = U.dist(x, y, cx, cy);
        g.state.grab = d > 100 ? 'a' : (d > 52 ? 'b' : null);
      },
      move(g, x, y) {
        const s = g.state;
        if (!s.grab || !g.pointer.down) return;
        const a = Math.atan2(y - g.H / 2, x - g.W / 2);
        s[s.grab] = a;
      },
      up(g) { g.state.grab = null; },
      update(g, dt) {
        const s = g.state;
        const near = (x, t) => {
          let d = Math.abs(((x - t + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          return Math.PI - d;
        };
        const ok = near(s.a, s.ta) < 0.2 && near(s.b, s.tb) < 0.2;
        s.held = ok ? s.held + dt : Math.max(0, s.held - dt * 2);
        g.setProgress(s.held / 1.4);
        if (s.held >= 1.4) g.finish();
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#0a1120');
        const cx = g.W / 2, cy = g.H / 2;
        const blur = 1 - Math.min(1, g.progress + 0.15);
        ctx.save();
        ctx.globalAlpha = 0.9;
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = 'rgba(207,217,232,' + (0.9 - blur * 0.7) + ')';
          const off = blur * 14;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(i * 1.3) * off, cy + Math.sin(i * 1.3) * off, 7 + blur * 9, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        [['a', 118, s.ta], ['b', 76, s.tb]].forEach(([key, r, target]) => {
          ctx.strokeStyle = '#243045'; ctx.lineWidth = 14;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,176,58,0.35)'; ctx.lineWidth = 14;
          ctx.beginPath(); ctx.arc(cx, cy, r, target - 0.2, target + 0.2); ctx.stroke();
          const a = s[key];
          ctx.fillStyle = FLARE;
          ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 11, 0, Math.PI * 2); ctx.fill();
        });
      },
    },

    temperature: {
      title: 'Record Temperature', hint: 'Drag the dial to the marked value and hold.',
      w: 460, h: 300,
      init(g) {
        const cold = g.spec.arg === 'cold';
        g.state = {
          value: cold ? 20 : 60, target: cold ? -93 : 132,
          min: cold ? -120 : 0, max: cold ? 40 : 180, held: 0, cold,
        };
      },
      move(g, x) {
        const s = g.state;
        if (!g.pointer.down) return;
        const t = U.clamp((x - 60) / (g.W - 120), 0, 1);
        s.value = Math.round(s.min + t * (s.max - s.min));
      },
      update(g, dt) {
        const s = g.state;
        const ok = Math.abs(s.value - s.target) <= 2;
        s.held = ok ? s.held + dt : Math.max(0, s.held - dt * 2);
        g.setProgress(s.held / 1.2);
        if (s.held >= 1.2) g.finish();
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#151d2c');
        const accent = s.cold ? '#4d9fd6' : '#ff7a3d';
        mono(ctx, (s.value > 0 ? '+' : '') + s.value + ' C', g.W / 2, 84, 40, accent, 'center');
        label(ctx, 'TARGET ' + (s.target > 0 ? '+' : '') + s.target + ' C', g.W / 2, 124, 13, DIM, 'center');
        const trackY = 190;
        ctx.fillStyle = '#101827';
        rr(ctx, 60, trackY - 12, g.W - 120, 24, 12); ctx.fill();
        const tt = (s.target - s.min) / (s.max - s.min);
        ctx.fillStyle = VITAL;
        ctx.fillRect(60 + tt * (g.W - 120) - 2, trackY - 22, 4, 44);
        const vt = (s.value - s.min) / (s.max - s.min);
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(60 + vt * (g.W - 120), trackY, 18, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath(); ctx.arc(60 + vt * (g.W - 120) - 5, trackY - 5, 6, 0, Math.PI * 2); ctx.fill();
      },
    },

    asteroids: {
      title: 'Clear Asteroids', hint: 'Tap them before they reach the hull.',
      w: 460, h: 300, step: 'Twenty of them.',
      init(g) { g.state = { rocks: [], shot: 0, need: 20, spawn: 0, shots: [] }; },
      down(g, x, y) {
        const s = g.state;
        s.shots.push({ x, y, life: 0.18 });
        for (let i = s.rocks.length - 1; i >= 0; i--) {
          const r = s.rocks[i];
          if (U.dist(x, y, r.x, r.y) < r.size + 12) {
            s.rocks.splice(i, 1);
            s.shot++;
            NS.audio.play('shoot');
            g.setProgress(s.shot / s.need);
            NS.fx.spark(0, 0);
            if (s.shot >= s.need) g.finish();
            return;
          }
        }
      },
      update(g, dt) {
        const s = g.state;
        s.spawn -= dt;
        if (s.spawn <= 0 && s.rocks.length < 7) {
          s.spawn = 0.34;
          const edge = Math.random();
          s.rocks.push({
            x: edge < 0.5 ? -20 : g.W + 20,
            y: 40 + Math.random() * (g.H - 90),
            vx: (edge < 0.5 ? 1 : -1) * (48 + Math.random() * 44),
            vy: (Math.random() - 0.5) * 30,
            size: 15 + Math.random() * 12, spin: Math.random() * 6,
          });
        }
        for (let i = s.rocks.length - 1; i >= 0; i--) {
          const r = s.rocks[i];
          r.x += r.vx * dt; r.y += r.vy * dt; r.spin += dt;
          if (r.x < -60 || r.x > g.W + 60) s.rocks.splice(i, 1);
        }
        for (let i = s.shots.length - 1; i >= 0; i--) {
          s.shots[i].life -= dt;
          if (s.shots[i].life <= 0) s.shots.splice(i, 1);
        }
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#080d18');
        for (let i = 0; i < 50; i++) {
          ctx.fillStyle = 'rgba(160,185,220,0.28)';
          ctx.fillRect(20 + ((i * 89) % 420), 24 + ((i * 61) % 250), 1.3, 1.3);
        }
        for (const r of s.rocks) {
          ctx.save();
          ctx.translate(r.x, r.y);
          ctx.rotate(r.spin);
          ctx.fillStyle = '#4a5570';
          ctx.beginPath();
          for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2;
            const rad = r.size * (0.78 + ((i * 37) % 11) / 22);
            if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
            else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
          }
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.beginPath(); ctx.arc(r.size * 0.24, r.size * 0.2, r.size * 0.28, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        for (const sh of s.shots) {
          ctx.strokeStyle = 'rgba(255,176,58,' + (sh.life / 0.18) + ')';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(sh.x, sh.y, 22 - sh.life * 60, 0, Math.PI * 2); ctx.stroke();
        }
        mono(ctx, s.shot + ' / ' + s.need, g.W - 40, 40, 16, FLARE, 'right');
      },
    },

    diagnose: {
      title: 'Run Diagnostics', hint: 'Find the system reporting a fault.',
      w: 460, h: 300,
      init(g) {
        const names = ['HULL', 'THRUST', 'COOLANT', 'NAV ARRAY', 'AIRLOCK', 'GRAVITY'];
        g.state = { names, bad: Math.floor(Math.random() * names.length), scan: 0, revealed: false };
      },
      down(g, x, y) {
        const s = g.state;
        if (!s.revealed) return;
        for (let i = 0; i < s.names.length; i++) {
          if (hit(x, y, 44, 66 + i * 34, g.W - 88, 30)) {
            if (i === s.bad) g.finish(); else g.fail();
            return;
          }
        }
      },
      update(g, dt) {
        const s = g.state;
        if (s.revealed) return;
        s.scan += dt / 2.4;
        g.setProgress(Math.min(0.6, s.scan * 0.6));
        if (s.scan >= 1) { s.revealed = true; NS.audio.play('taskStep'); }
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#151d2c');
        label(ctx, s.revealed ? 'SELECT THE FAULT' : 'SCANNING SUBSYSTEMS', 44, 42, 12, DIM);
        for (let i = 0; i < s.names.length; i++) {
          const y = 66 + i * 34;
          const shown = s.revealed || s.scan * s.names.length > i;
          ctx.fillStyle = '#101827';
          rr(ctx, 44, y, g.W - 88, 30, 6); ctx.fill();
          if (!shown) continue;
          const bad = s.revealed && i === s.bad;
          ctx.strokeStyle = bad ? 'rgba(255,63,91,0.55)' : 'rgba(255,255,255,0.07)';
          ctx.lineWidth = 2;
          rr(ctx, 44, y, g.W - 88, 30, 6); ctx.stroke();
          mono(ctx, s.names[i], 60, y + 15, 13, INK);
          mono(ctx, bad ? 'FAULT' : 'NOMINAL', g.W - 60, y + 15, 12, bad ? BLOOD : VITAL, 'right');
        }
      },
    },

    signal: {
      title: 'Boost Signal', hint: 'Release inside the window.',
      w: 460, h: 300,
      init(g) { g.state = { pos: 0, dir: 1, speed: 0.72, round: 0, need: 3, band: 0.16, held: false }; },
      down(g) { g.state.held = true; },
      up(g) {
        const s = g.state;
        s.held = false;
        if (Math.abs(s.pos - 0.5) < s.band / 2) {
          s.round++;
          NS.audio.play('taskStep');
          g.setProgress(s.round / s.need);
          if (s.round >= s.need) { g.finish(); return; }
          s.speed += 0.26;
          s.band = Math.max(0.09, s.band - 0.02);
        } else g.fail();
      },
      update(g, dt) {
        const s = g.state;
        if (g.done) return;
        s.pos += s.dir * s.speed * dt;
        if (s.pos > 1) { s.pos = 1; s.dir = -1; }
        if (s.pos < 0) { s.pos = 0; s.dir = 1; }
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#151d2c');
        const x0 = 50, w = g.W - 100, y = 150;
        ctx.fillStyle = '#101827';
        rr(ctx, x0, y - 34, w, 68, 10); ctx.fill();
        ctx.fillStyle = 'rgba(52,224,184,0.22)';
        ctx.fillRect(x0 + w * (0.5 - s.band / 2), y - 34, w * s.band, 68);
        ctx.strokeStyle = VITAL; ctx.lineWidth = 2;
        ctx.strokeRect(x0 + w * (0.5 - s.band / 2), y - 34, w * s.band, 68);
        ctx.fillStyle = FLARE;
        ctx.fillRect(x0 + w * s.pos - 3, y - 42, 6, 84);
        label(ctx, 'HOLD, THEN RELEASE IN THE GREEN', g.W / 2, 224, 12, DIM, 'center');
        mono(ctx, s.round + ' / ' + s.need, g.W / 2, 68, 20, FLARE, 'center');
      },
    },

    reactor: {
      title: 'Start Reactor', hint: 'Repeat the sequence.',
      w: 460, h: 300,
      init(g) {
        g.state = { seq: [], input: [], showing: 0, show: -1, round: 0, need: 4, wait: 0.8, lit: -1 };
        g.state.seq.push(Math.floor(Math.random() * 4));
      },
      down(g, x, y) {
        const s = g.state;
        if (s.showing) return;
        for (let i = 0; i < 4; i++) {
          const bx = 68 + (i % 2) * 176, by = 60 + Math.floor(i / 2) * 108;
          if (hit(x, y, bx, by, 156, 92)) {
            s.lit = i;
            s.input.push(i);
            NS.audio.play('taskStep');
            if (s.seq[s.input.length - 1] !== i) {
              g.fail();
              s.input = []; s.seq = [Math.floor(Math.random() * 4)];
              s.round = 0; s.showing = 1; s.show = -1; s.wait = 0.7;
              g.setProgress(0);
              return;
            }
            if (s.input.length === s.seq.length) {
              s.round++;
              g.setProgress(s.round / s.need);
              if (s.round >= s.need) { g.finish(); return; }
              s.seq.push(Math.floor(Math.random() * 4));
              s.input = [];
              s.showing = 1; s.show = -1; s.wait = 0.65;
            }
            return;
          }
        }
      },
      update(g, dt) {
        const s = g.state;
        if (s.lit >= 0) { s.litFade = (s.litFade || 0.2) - dt; if (s.litFade <= 0) { s.lit = -1; s.litFade = 0.2; } }
        if (!s.showing && s.round === 0 && s.show === -1 && s.wait > 0) { s.showing = 1; }
        if (!s.showing) return;
        s.wait -= dt;
        if (s.wait > 0) return;
        s.show++;
        if (s.show >= s.seq.length) { s.showing = 0; s.show = -1; s.lit = -1; return; }
        s.lit = s.seq[s.show];
        s.litFade = 0.34;
        s.wait = 0.56;
        NS.audio.play('tap');
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#151d2c');
        const colours = ['#e8563f', '#4d9fd6', '#4ca85c', '#f0a63c'];
        for (let i = 0; i < 4; i++) {
          const bx = 68 + (i % 2) * 176, by = 60 + Math.floor(i / 2) * 108;
          const on = s.lit === i;
          ctx.fillStyle = on ? colours[i] : 'rgba(255,255,255,0.05)';
          rr(ctx, bx, by, 156, 92, 12); ctx.fill();
          ctx.strokeStyle = colours[i];
          ctx.globalAlpha = on ? 1 : 0.4;
          ctx.lineWidth = 3;
          rr(ctx, bx, by, 156, 92, 12); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        label(ctx, s.showing ? 'WATCH' : 'REPEAT', g.W / 2, 268, 13, s.showing ? FLARE : VITAL, 'center');
      },
    },

    sample: {
      title: 'Inspect Sample', hint: 'Start it, wait, then pick the odd one.',
      w: 460, h: 300,
      init(g) {
        g.state = { started: false, timer: 0, ready: false, odd: Math.floor(Math.random() * 5) };
      },
      down(g, x, y) {
        const s = g.state;
        if (!s.started) {
          if (hit(x, y, g.W / 2 - 74, 200, 148, 52)) { s.started = true; NS.audio.play('taskStep'); }
          return;
        }
        if (!s.ready) return;
        for (let i = 0; i < 5; i++) {
          const bx = 44 + i * 76;
          if (hit(x, y, bx, 96, 62, 108)) {
            if (i === s.odd) g.finish(); else g.fail();
            return;
          }
        }
      },
      update(g, dt) {
        const s = g.state;
        if (!s.started || s.ready) return;
        s.timer += dt;
        g.setProgress(Math.min(0.75, s.timer / 8 * 0.75));
        if (s.timer >= 8) { s.ready = true; NS.audio.play('taskStep'); }
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#151d2c');
        for (let i = 0; i < 5; i++) {
          const bx = 44 + i * 76;
          ctx.fillStyle = '#101827';
          rr(ctx, bx, 96, 62, 108, 8); ctx.fill();
          ctx.strokeStyle = '#39435c'; ctx.lineWidth = 2;
          rr(ctx, bx, 96, 62, 108, 8); ctx.stroke();
          if (s.ready) {
            const odd = i === s.odd;
            ctx.fillStyle = odd ? 'rgba(255,63,91,0.55)' : 'rgba(77,159,214,0.4)';
            const h = odd ? 74 : 52;
            rr(ctx, bx + 12, 96 + 108 - h - 10, 38, h, 5); ctx.fill();
            if (odd) {
              ctx.fillStyle = BLOOD;
              for (let k = 0; k < 3; k++) {
                ctx.beginPath();
                ctx.arc(bx + 22 + k * 9, 150 + Math.sin(g.t * 3 + k) * 8, 3.4, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          } else if (s.started) {
            ctx.fillStyle = 'rgba(77,159,214,0.2)';
            rr(ctx, bx + 12, 152, 38, 42, 5); ctx.fill();
          }
        }
        if (!s.started) {
          ctx.fillStyle = FLARE;
          rr(ctx, g.W / 2 - 74, 200, 148, 52, 10); ctx.fill();
          label(ctx, 'START ANALYSIS', g.W / 2, 226, 15, '#1a1305', 'center');
        } else if (!s.ready) {
          label(ctx, 'PROCESSING ' + Math.ceil(8 - s.timer) + 's', g.W / 2, 232, 15, DIM, 'center');
        } else {
          label(ctx, 'PICK THE CONTAMINATED SAMPLE', g.W / 2, 232, 14, BLOOD, 'center');
        }
      },
    },

    hold: {
      title: 'Hold', hint: 'Hold the lever until it is done.',
      w: 460, h: 300,
      init(g) { g.state = { held: 0, need: g.spec.seconds || 5, on: false }; },
      down(g, x, y) { if (hit(x, y, g.W / 2 - 60, 74, 120, 168)) g.state.on = true; },
      up(g) { g.state.on = false; },
      update(g, dt) {
        const s = g.state;
        if (s.on && g.pointer.down) s.held += dt;
        else s.held = Math.max(0, s.held - dt * 1.6);
        g.setProgress(s.held / s.need);
        if (s.held >= s.need) g.finish();
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#151d2c');
        const p = U.clamp(s.held / s.need, 0, 1);
        ctx.fillStyle = '#101827';
        rr(ctx, 60, 74, 84, 168, 10); ctx.fill();
        ctx.fillStyle = g.spec.tint || VITAL;
        rr(ctx, 66, 74 + 160 * (1 - p), 72, 160 * p + 8, 8); ctx.fill();
        ctx.fillStyle = s.on ? FLARE : STEEL;
        rr(ctx, g.W / 2 - 60, 74, 120, 168, 14); ctx.fill();
        ctx.strokeStyle = s.on ? '#ffd08a' : '#3f4b66';
        ctx.lineWidth = 3;
        rr(ctx, g.W / 2 - 60, 74, 120, 168, 14); ctx.stroke();
        label(ctx, s.on ? 'HOLDING' : 'HOLD', g.W / 2, 158, 16, s.on ? '#1a1305' : INK, 'center');
        mono(ctx, Math.max(0, s.need - s.held).toFixed(1) + 's', g.W - 70, 158, 22, DIM, 'right');
      },
    },

    divert: {
      title: 'Divert Power', hint: 'Throw every breaker.',
      w: 460, h: 300,
      init(g) {
        const on = [];
        for (let i = 0; i < 6; i++) on.push(false);
        g.state = { on };
      },
      down(g, x, y) {
        const s = g.state;
        for (let i = 0; i < 6; i++) {
          const bx = 52 + (i % 3) * 122, by = 78 + Math.floor(i / 3) * 108;
          if (hit(x, y, bx, by, 100, 88) && !s.on[i]) {
            s.on[i] = true;
            NS.audio.play('taskStep');
            const done = s.on.filter(Boolean).length;
            g.setProgress(done / 6);
            if (done === 6) g.finish();
            return;
          }
        }
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#151d2c');
        for (let i = 0; i < 6; i++) {
          const bx = 52 + (i % 3) * 122, by = 78 + Math.floor(i / 3) * 108;
          ctx.fillStyle = '#101827';
          rr(ctx, bx, by, 100, 88, 8); ctx.fill();
          ctx.strokeStyle = s.on[i] ? VITAL : '#39435c';
          ctx.lineWidth = 2.5;
          rr(ctx, bx, by, 100, 88, 8); ctx.stroke();
          ctx.fillStyle = s.on[i] ? VITAL : '#4a5570';
          rr(ctx, bx + 32, s.on[i] ? by + 12 : by + 46, 36, 30, 6); ctx.fill();
        }
        label(ctx, 'ROUTING', g.W / 2, 42, 12, DIM, 'center');
      },
    },

    /* ---- sabotage fixes -------------------------------------------------- */

    lightsFix: {
      title: 'Restore Lights', hint: 'Every breaker up.',
      w: 460, h: 300,
      init(g) {
        const on = [];
        for (let i = 0; i < 5; i++) on.push(Math.random() > 0.5);
        if (on.every(Boolean)) on[2] = false;
        g.state = { on };
      },
      down(g, x, y) {
        const s = g.state;
        for (let i = 0; i < 5; i++) {
          const bx = 44 + i * 76;
          if (hit(x, y, bx, 82, 62, 132)) {
            s.on[i] = !s.on[i];
            NS.audio.play('taskStep');
            g.setProgress(s.on.filter(Boolean).length / 5);
            if (s.on.every(Boolean)) g.finish();
            return;
          }
        }
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#0e1420');
        for (let i = 0; i < 5; i++) {
          const bx = 44 + i * 76;
          ctx.fillStyle = '#0a0f1a';
          rr(ctx, bx, 82, 62, 132, 8); ctx.fill();
          ctx.strokeStyle = s.on[i] ? FLARE : '#39435c';
          ctx.lineWidth = 2.5;
          rr(ctx, bx, 82, 62, 132, 8); ctx.stroke();
          ctx.fillStyle = s.on[i] ? FLARE : '#4a5570';
          rr(ctx, bx + 15, s.on[i] ? 92 : 156, 32, 48, 6); ctx.fill();
        }
        label(ctx, 'DECK LIGHTING', g.W / 2, 50, 12, DIM, 'center');
      },
    },

    codeFix: {
      title: 'Restore Oxygen', hint: 'Type the code shown above.',
      w: 460, h: 300,
      init(g) {
        let code = '';
        for (let i = 0; i < 5; i++) code += Math.floor(Math.random() * 10);
        g.state = { code, typed: '' };
      },
      down(g, x, y) {
        const s = g.state;
        for (let i = 0; i < 12; i++) {
          const bx = 128 + (i % 3) * 74, by = 108 + Math.floor(i / 3) * 46;
          if (!hit(x, y, bx, by, 66, 40)) continue;
          if (i === 9) { s.typed = ''; NS.audio.play('tap'); return; }
          if (i === 11) {
            if (s.typed === s.code) g.finish(); else { g.fail(); s.typed = ''; }
            return;
          }
          const digit = i === 10 ? '0' : String(i + 1);
          if (s.typed.length < 5) {
            s.typed += digit;
            NS.audio.play('taskStep');
            g.setProgress(s.typed.length / 5);
            if (s.typed.length === 5) {
              if (s.typed === s.code) g.finish(); else { g.fail(); s.typed = ''; g.setProgress(0); }
            }
          }
          return;
        }
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#151d2c');
        mono(ctx, s.code, g.W / 2, 52, 30, VITAL, 'center');
        ctx.fillStyle = '#0a0f1a';
        rr(ctx, 32, 108, 76, 178, 8); ctx.fill();
        mono(ctx, s.typed.padEnd(5, '-'), 70, 196, 18, FLARE, 'center');
        const faces = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'OK'];
        for (let i = 0; i < 12; i++) {
          const bx = 128 + (i % 3) * 74, by = 108 + Math.floor(i / 3) * 46;
          ctx.fillStyle = i === 11 ? 'rgba(52,224,184,0.2)' : (i === 9 ? 'rgba(255,63,91,0.18)' : STEEL);
          rr(ctx, bx, by, 66, 40, 6); ctx.fill();
          mono(ctx, faces[i], bx + 33, by + 21, i > 8 && i !== 10 ? 13 : 18,
               i === 11 ? VITAL : (i === 9 ? BLOOD : INK), 'center');
        }
      },
    },

    tuneFix: {
      title: 'Restore Comms', hint: 'Tune both dials until the signal is clean.',
      w: 460, h: 300,
      init(g) {
        g.state = { a: Math.random(), b: Math.random(), ta: 0.25 + Math.random() * 0.5, tb: 0.25 + Math.random() * 0.5, grab: null, held: 0 };
      },
      down(g, x, y) {
        if (hit(x, y, 40, 168, g.W - 80, 40)) g.state.grab = 'a';
        else if (hit(x, y, 40, 222, g.W - 80, 40)) g.state.grab = 'b';
      },
      move(g, x) {
        const s = g.state;
        if (!s.grab || !g.pointer.down) return;
        s[s.grab] = U.clamp((x - 50) / (g.W - 100), 0, 1);
      },
      up(g) { g.state.grab = null; },
      update(g, dt) {
        const s = g.state;
        const ok = Math.abs(s.a - s.ta) < 0.04 && Math.abs(s.b - s.tb) < 0.04;
        s.held = ok ? s.held + dt : Math.max(0, s.held - dt * 2);
        g.setProgress(s.held / 1.2);
        if (s.held >= 1.2) g.finish();
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#151d2c');
        const err = Math.abs(s.a - s.ta) + Math.abs(s.b - s.tb);
        ctx.strokeStyle = err < 0.09 ? VITAL : '#4a5570';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let x = 44; x < g.W - 44; x += 3) {
          const noise = err * 34 * (Math.random() - 0.5);
          const y = 106 + Math.sin(x * 0.09 + g.t * 4) * (26 - err * 12) + noise;
          if (x === 44) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        [['a', 168], ['b', 222]].forEach(([key, y]) => {
          ctx.fillStyle = '#101827';
          rr(ctx, 40, y, g.W - 80, 40, 20); ctx.fill();
          const target = key === 'a' ? s.ta : s.tb;
          ctx.fillStyle = 'rgba(52,224,184,0.35)';
          ctx.fillRect(50 + target * (g.W - 100) - 8, y + 4, 16, 32);
          ctx.fillStyle = FLARE;
          ctx.beginPath(); ctx.arc(50 + s[key] * (g.W - 100), y + 20, 16, 0, Math.PI * 2); ctx.fill();
        });
      },
    },

    padFix: {
      title: 'Reactor Hand Scanner', hint: 'Hold. Somebody has to hold the other one.',
      w: 460, h: 300,
      init(g) { g.state = { on: false }; },
      down(g, x, y) {
        if (hit(x, y, g.W / 2 - 90, 66, 180, 178)) {
          g.state.on = true;
          if (g.spec.onHold) g.spec.onHold(true);
        }
      },
      up(g) {
        if (g.state.on && g.spec.onHold) g.spec.onHold(false);
        g.state.on = false;
      },
      update(g) {
        const active = NS.world.state.sabotage;
        if (!active || active.kind !== 'reactor') { g.finish(); }
      },
      draw(g, ctx) {
        const s = g.state;
        plate(ctx, 12, 12, g.W - 24, g.H - 24, '#170f14');
        const active = NS.world.state.sabotage;
        const holds = (active && active.holds) || [];
        const other = holds.length > (s.on ? 1 : 0);
        ctx.fillStyle = s.on ? 'rgba(255,176,58,0.22)' : 'rgba(255,255,255,0.04)';
        rr(ctx, g.W / 2 - 90, 66, 180, 178, 16); ctx.fill();
        ctx.strokeStyle = s.on ? FLARE : '#4a5570';
        ctx.lineWidth = 3;
        rr(ctx, g.W / 2 - 90, 66, 180, 178, 16); ctx.stroke();
        /* A hand. Four fingers, a thumb, a palm. */
        const cx = g.W / 2, cy = 168;
        ctx.fillStyle = s.on ? FLARE : '#5a6580';
        rr(ctx, cx - 42, cy - 6, 84, 66, 22); ctx.fill();
        for (let i = 0; i < 4; i++) { rr(ctx, cx - 38 + i * 21, cy - 62, 16, 62, 8); ctx.fill(); }
        rr(ctx, cx + 34, cy - 12, 16, 44, 8); ctx.fill();
        label(ctx, s.on ? 'HOLDING' : 'PLACE YOUR HAND', g.W / 2, 268, 13, s.on ? FLARE : DIM, 'center');
        label(ctx, other ? 'OTHER PAD IS HELD' : 'WAITING FOR THE OTHER PAD',
              g.W / 2, 42, 12, other ? VITAL : BLOOD, 'center');
      },
    },
  };

  /* Kinds that reuse the lever, differing in how long they take and what the
     panel says -- fuelling an engine and dropping a bin are the same gesture
     and it would be dishonest to pretend otherwise with a fake new mechanic. */
  const HOLDS = {
    fuel: { title: 'Fuel Engines', hint: 'Hold until the tank is full.', seconds: 5, tint: '#e8563f' },
    garbage: { title: 'Empty Garbage', hint: 'Hold the lever down.', seconds: 4, tint: '#8d97ad' },
    chute: { title: 'Empty Chute', hint: 'Hold until the chute is clear.', seconds: 5.5, tint: '#8d97ad' },
    scan: { title: 'Submit Scan', hint: 'Stand still on the pad.', seconds: 8, tint: VITAL },
  };

  function specFor(kind, station, step) {
    if (HOLDS[kind]) return Object.assign({}, GAMES.hold, HOLDS[kind]);
    const base = GAMES[kind];
    if (!base) return null;
    const spec = Object.assign({}, base);
    if (station && station.arg) spec.arg = station.arg;
    if (station && station.steps) {
      spec.step = 'Step ' + (step + 1) + ' of ' + station.steps.length
        + ' - ' + station.steps[step].verb;
    }
    return spec;
  }

  function start(kind, opts) {
    const o = opts || {};
    const spec = specFor(kind, o.station, o.step || 0);
    if (!spec) return null;
    if (o.title) spec.title = o.title;
    if (o.onHold) spec.onHold = o.onHold;
    return panel(spec, o);
  }

  NS.minigames = {
    start, close, GAMES,
    get open() { return open; },
    isOpen: () => !!open,
  };
})(window.NS);
