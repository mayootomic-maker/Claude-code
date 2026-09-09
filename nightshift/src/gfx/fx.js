/* Dust, sparks, splashes and the words that float up off a finished task.

   One flat pool, no allocation once it is warm, and everything is drawn with
   the same four fields. Effects are the cheapest way to make an action feel
   like it landed -- a vent that puffs is a vent you believe somebody went
   into -- so the budget goes on having them at all rather than on making any
   one of them elaborate. */

(function (NS) {
  'use strict';

  const U = NS.util;
  const MAX = 320;
  const pool = [];
  for (let i = 0; i < MAX; i++) {
    pool.push({ live: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 3, colour: '#fff', kind: 'dot', spin: 0 });
  }
  let cursor = 0;
  const floaters = [];

  function take() {
    for (let i = 0; i < MAX; i++) {
      cursor = (cursor + 1) % MAX;
      if (!pool[cursor].live) return pool[cursor];
    }
    return pool[cursor];
  }

  function spawn(o) {
    const p = take();
    p.live = true;
    p.x = o.x; p.y = o.y;
    p.vx = o.vx || 0; p.vy = o.vy || 0;
    p.max = p.life = o.life || 0.6;
    p.size = o.size || 3;
    p.colour = o.colour || '#cfd9e8';
    p.kind = o.kind || 'dot';
    p.drag = o.drag == null ? 0.9 : o.drag;
    p.gravity = o.gravity || 0;
    p.spin = Math.random() * Math.PI * 2;
    return p;
  }

  const burst = (x, y, n, opts) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (opts.speed || 90) * (0.35 + Math.random() * 0.65);
      spawn({
        x: x + (Math.random() - 0.5) * (opts.spread || 8),
        y: y + (Math.random() - 0.5) * (opts.spread || 8),
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * 0.6,
        life: (opts.life || 0.6) * (0.6 + Math.random() * 0.6),
        size: (opts.size || 3) * (0.6 + Math.random() * 0.8),
        colour: opts.colour, kind: opts.kind || 'dot',
        gravity: opts.gravity || 0, drag: opts.drag,
      });
    }
  };

  const FX = {
    vent(x, y) {
      burst(x, y, 14, { colour: '#8d97ad', speed: 130, life: 0.5, size: 5, kind: 'puff' });
      burst(x, y, 6, { colour: '#4a5570', speed: 60, life: 0.75, size: 8, kind: 'puff' });
    },
    kill(x, y) {
      burst(x, y, 18, { colour: '#c0243c', speed: 200, life: 0.65, size: 4, gravity: 260, drag: 0.86 });
      burst(x, y, 8, { colour: '#ff3f5b', speed: 90, life: 0.9, size: 6 });
    },
    shot(x, y) {
      burst(x, y, 12, { colour: '#ffb03a', speed: 240, life: 0.35, size: 3 });
    },
    shield(x, y) {
      burst(x, y, 16, { colour: '#34e0b8', speed: 150, life: 0.7, size: 4 });
    },
    vanish(x, y) {
      burst(x, y, 20, { colour: '#9d8cff', speed: 110, life: 0.8, size: 4, kind: 'puff' });
    },
    task(x, y) {
      burst(x, y - 18, 12, { colour: '#34e0b8', speed: 80, life: 0.8, size: 3, gravity: -60 });
    },
    spark(x, y) {
      burst(x, y, 6, { colour: '#ffb03a', speed: 160, life: 0.4, size: 2.5, gravity: 300 });
    },
    /* Feathers, because it is a duck. They fall slower than debris and drift,
       which is the tell that something soft came apart. */
    feathers(x, y, colorIdx) {
      const colour = (NS.config.COLORS[colorIdx] || NS.config.COLORS[0]);
      burst(x, y - 12, 14, {
        colour: colour.body, speed: 130, life: 1.6, size: 4.5, gravity: 55, drag: 0.9, kind: 'puff',
      });
      burst(x, y - 8, 8, {
        colour: colour.rim, speed: 80, life: 2, size: 3.5, gravity: 35, drag: 0.88, kind: 'puff',
      });
    },
    step(x, y) {
      spawn({ x, y: y + 2, vx: (Math.random() - 0.5) * 18, vy: -6, life: 0.45, size: 4, colour: '#3a4560', kind: 'puff' });
    },
  };

  /* The machine a visual task drives, running where the station is. Its whole
     job is to be witnessed: if you are in the room you can see the shields
     light or the chute blow, and that is the alibi. */
  const visuals = [];
  const VISUAL_ART = {
    asteroids: { colour: '#ffb03a', rings: 3, life: 2.4 },
    shields:   { colour: '#4d9fd6', rings: 5, life: 2.6 },
    filter:    { colour: '#4ca85c', rings: 2, life: 2.4 },
    signal:    { colour: '#37e0c8', rings: 4, life: 2.8 },
    scan:      { colour: '#37e0c8', rings: 3, life: 3.2 },
    chute:     { colour: '#8d97ad', rings: 2, life: 2.4 },
  };

  function visual(kind, x, y) {
    const art = VISUAL_ART[kind] || { colour: '#34e0b8', rings: 3, life: 2.4 };
    visuals.push({ x, y, kind, art, life: art.life, max: art.life });
    if (visuals.length > 6) visuals.shift();
    burst(x, y - 10, 16, { colour: art.colour, speed: 120, life: 1, size: 4, gravity: -30 });
  }

  function drawVisuals(ctx) {
    for (const v of visuals) {
      const t = 1 - v.life / v.max;
      ctx.save();
      ctx.globalAlpha = Math.min(1, v.life * 1.6) * 0.7;
      ctx.strokeStyle = v.art.colour;
      ctx.lineWidth = 3;
      for (let i = 0; i < v.art.rings; i++) {
        const phase = (t * 1.6 + i / v.art.rings) % 1;
        ctx.globalAlpha = Math.min(1, v.life * 1.6) * (1 - phase) * 0.6;
        ctx.beginPath();
        ctx.ellipse(v.x, v.y + 6, 26 + phase * 62, 12 + phase * 28, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = Math.min(1, v.life * 1.6) * 0.32;
      const glow = ctx.createRadialGradient(v.x, v.y, 4, v.x, v.y, 74);
      glow.addColorStop(0, v.art.colour);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(v.x, v.y, 74, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function say(x, y, text, colour) {
    floaters.push({ x, y, text, colour: colour || '#cfd9e8', life: 1.5, max: 1.5 });
    if (floaters.length > 12) floaters.shift();
  }

  function step(dt) {
    for (let i = 0; i < MAX; i++) {
      const p = pool[i];
      if (!p.live) continue;
      p.life -= dt;
      if (p.life <= 0) { p.live = false; continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = Math.pow(p.drag, dt * 60);
      p.vx *= k; p.vy *= k;
    }
    for (let i = visuals.length - 1; i >= 0; i--) {
      visuals[i].life -= dt;
      if (visuals[i].life <= 0) visuals.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt;
      f.y -= dt * 34;
      if (f.life <= 0) floaters.splice(i, 1);
    }
  }

  function draw(ctx) {
    for (let i = 0; i < MAX; i++) {
      const p = pool[i];
      if (!p.live) continue;
      const t = p.life / p.max;
      ctx.globalAlpha = p.kind === 'puff' ? t * 0.55 : t;
      ctx.fillStyle = p.colour;
      if (p.kind === 'puff') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.6 - t * 0.7), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFloaters(ctx) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floaters) {
      const t = f.life / f.max;
      ctx.globalAlpha = Math.min(1, t * 2.2);
      ctx.font = '700 15px Archivo, system-ui, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(5,7,13,0.85)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.colour;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function clear() {
    for (let i = 0; i < MAX; i++) pool[i].live = false;
    floaters.length = 0;
    visuals.length = 0;
  }

  NS.fx = Object.assign({ spawn, burst, step, draw, drawFloaters, drawVisuals, visual, say, clear }, FX);
})(window.NS);
