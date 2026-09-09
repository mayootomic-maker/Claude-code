/* The moments the game stops for.

   Three things in a round deserve to interrupt everything: a kill, an
   ejection, and being told who you are. Everywhere else the game should get
   out of the way -- but those three are the beats a table remembers, and
   playing them as a toast in the corner throws them away.

   Each is a short timeline drawn over the finished frame: bars in, a staged
   shot, a hit, bars out. Nothing here reads game state on its own; it is
   handed everything it needs when it starts, so a cinematic can never
   disagree with the round or hold a reference to somebody who has since left.

   All of it is skippable and all of it is short. A dramatic flourish you
   cannot skip is a dramatic flourish you resent by the fourth round. */

(function (NS) {
  'use strict';

  const U = NS.util;
  const C = NS.config;

  let calm = false;
  try {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    calm = q.matches;
    if (q.addEventListener) q.addEventListener('change', (e) => { calm = e.matches; });
  } catch (e) { calm = false; }

  let scene = null;

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const outCubic = (t) => 1 - Math.pow(1 - t, 3);
  const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const span = (t, a, b) => clamp01((t - a) / (b - a));

  function play(kind, data) {
    const spec = SCENES[kind];
    if (!spec) return;
    /* Reduced motion gets the information without the camera work: a still
       frame, held, with the same words on it. */
    scene = {
      kind, spec, t: 0,
      length: calm ? Math.min(spec.length, 1.6) : spec.length,
      calm, data: data || {},
    };
    /* The HUD is DOM and sits above the canvas, so it has to be told to get
       out of the way -- otherwise the task bar and the action buttons float
       over the shot. */
    document.body.classList.add('in-cinema');
    if (spec.enter) spec.enter(scene.data, calm);
  }

  const active = () => !!scene;
  function stop() {
    scene = null;
    document.body.classList.remove('in-cinema');
  }

  function step(dt) {
    if (!scene) return;
    scene.t += dt;
    if (scene.t >= scene.length) {
      const done = scene.spec.done;
      const data = scene.data;
      scene = null;
      document.body.classList.remove('in-cinema');
      if (done) done(data);
    }
  }

  /* Letterbox. The bars are the whole grammar: as soon as they move, everyone
     knows to stop pressing things and watch. */
  function bars(ctx, w, h, amount) {
    const bar = Math.round(h * 0.13 * amount);
    if (bar <= 0) return 0;
    ctx.fillStyle = '#04060b';
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
    return bar;
  }

  function duck(ctx, colorIdx, hatIdx, scale, opts) {
    NS.characters.drawPlayer(ctx, Object.assign({
      x: 0, y: 0, dir: 1, colorIdx, hatIdx, shiftIdx: -1,
      moving: false, walk: 0, blink: 0, look: 0, quack: 0, ghost: false,
    }, opts || {}), { scale });
  }

  function title(ctx, w, y, text, size, colour, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 ' + size + 'px Archivo, "Archivo Black", system-ui, sans-serif';
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = 'rgba(4,6,11,0.85)';
    ctx.strokeText(text, w / 2, y);
    ctx.fillStyle = colour;
    ctx.fillText(text, w / 2, y);
    ctx.restore();
  }

  const SCENES = {

    /* ---- the kill -------------------------------------------------------
       Held on the two of them, close. The lunge is the whole shot: the
       killer crosses the gap in four frames and the victim goes over. */
    kill: {
      length: 2.5,
      enter(data) {
        NS.audio.play('stingerLow');
        NS.audio.play('quackHurt');
      },
      draw(ctx, w, h, s) {
        const t = s.t / s.length;
        const inBars = span(t, 0, 0.1);
        const outBars = 1 - span(t, 0.88, 1);
        const amount = Math.min(inBars, outBars);
        ctx.fillStyle = 'rgba(4,6,11,' + (0.55 + 0.35 * span(t, 0, 0.14)).toFixed(3) + ')';
        ctx.fillRect(0, 0, w, h);

        const cx = w / 2, cy = h / 2 + h * 0.02;
        const scale = Math.min(w, h) / 190 * (s.calm ? 1 : (1 + span(t, 0, 0.5) * 0.22));
        const lunge = s.calm ? 1 : ease(span(t, 0.16, 0.34));
        /* Measured in duck-widths rather than pixels, so the pair are framed
           the same on a phone and a projector -- a fixed pixel gap had them
           overlapping completely on a large screen, where the ducks are drawn
           bigger but the gap was not. */
        const gap = (1.5 - lunge * 0.62) * 34 * scale;

        /* The victim, tipping over once the killer arrives. */
        const fall = ease(span(t, 0.32, 0.62));
        ctx.save();
        ctx.translate(cx + gap * 0.5, cy);
        ctx.rotate(fall * 1.5);
        ctx.translate(0, fall * 16);
        duck(ctx, s.data.victimColour, s.data.victimHat, scale * 0.9, {
          dir: -1, blink: fall > 0.3 ? 1 : 0, quack: fall < 0.3 ? 1 : 0,
        });
        ctx.restore();

        /* The killer, arriving. */
        ctx.save();
        ctx.translate(cx - gap * 0.5, cy);
        const crouch = Math.sin(clamp01(lunge) * Math.PI) * 0.14;
        ctx.rotate(crouch);
        duck(ctx, s.data.killerColour, s.data.killerHat, scale * 0.95, {
          dir: 1, flap: true, walk: s.t * 22, moving: true,
        });
        ctx.restore();

        /* Impact: a hard red wipe, once. */
        const hit = span(t, 0.3, 0.42);
        if (hit > 0 && hit < 1) {
          ctx.save();
          ctx.globalAlpha = Math.sin(hit * Math.PI) * 0.75;
          ctx.fillStyle = '#ff3f5b';
          ctx.fillRect(0, 0, w, h);
          ctx.restore();
        }

        const bar = bars(ctx, w, h, amount);
        const words = span(t, 0.5, 0.62) * (1 - span(t, 0.9, 1));
        if (words > 0 && s.data.line) {
          title(ctx, w, h - bar - h * 0.09, s.data.line, Math.max(20, Math.min(46, w * 0.045)),
            '#ff6b7f', words);
        }
        if (words > 0 && s.data.sub) {
          title(ctx, w, h - bar - h * 0.045, s.data.sub, Math.max(13, Math.min(20, w * 0.02)),
            '#cfd9e8', words * 0.85);
        }
      },
    },

    /* ---- the airlock -----------------------------------------------------
       A long shot of somebody going away from you. The starfield does the
       work: the duck barely moves, everything else does. */
    eject: {
      length: 5.4,
      enter(data) {
        NS.audio.play('airlock');
        if (data.name) NS.bits.announce(data.line || '');
      },
      draw(ctx, w, h, s) {
        const t = s.t / s.length;
        ctx.fillStyle = '#04060b';
        ctx.fillRect(0, 0, w, h);

        /* Stars, streaming past faster than the duck is drifting, which is
           what sells the speed. */
        const drift = s.t * (s.calm ? 20 : 120);
        ctx.fillStyle = '#cfd9e8';
        for (let i = 0; i < 130; i++) {
          const seed = i * 137.5;
          const y = (seed % h);
          const x = ((seed * 3.7 + drift * (0.4 + (i % 5) / 5)) % (w + 80)) - 40;
          const size = i % 9 === 0 ? 2.4 : 1.2;
          ctx.globalAlpha = i % 9 === 0 ? 0.9 : 0.4;
          ctx.fillRect(w - x, y, size, size);
        }
        ctx.globalAlpha = 1;

        const g = ctx.createRadialGradient(w * 0.78, h * 1.1, 10, w * 0.78, h * 1.1, h * 1.1);
        g.addColorStop(0, 'rgba(255,176,58,0.4)');
        g.addColorStop(0.5, 'rgba(190,90,60,0.2)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);

        if (s.data.name) {
          const cross = span(t, 0.05, 0.78);
          const x = -w * 0.15 + cross * w * 1.3;
          const y = h * 0.44 + Math.sin(s.t * 1.4) * h * 0.05;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(s.calm ? 0.3 : s.t * 1.9);
          duck(ctx, s.data.colorIdx, s.data.hatIdx, Math.min(w, h) / 260, { ghost: false, dir: 1 });
          ctx.restore();
        }

        const bar = bars(ctx, w, h, Math.min(span(t, 0, 0.08), 1 - span(t, 0.92, 1)));
        const words = span(t, 0.3, 0.42);
        title(ctx, w, h * 0.72, s.data.line || '', Math.max(20, Math.min(44, w * 0.042)),
          s.data.impostor ? '#ff6b7f' : '#cfd9e8', words);
        if (s.data.sub) {
          title(ctx, w, h * 0.79, s.data.sub, Math.max(13, Math.min(19, w * 0.019)), '#8d9ab1', words * 0.9);
        }
        void bar;
      },
    },

    /* ---- who you are ----------------------------------------------------- */
    reveal: {
      length: 2.6,
      enter(data) {
        NS.audio.play(data.team === 'impostor' ? 'stingerLow' : 'stingerHigh');
      },
      draw(ctx, w, h, s) {
        const t = s.t / s.length;
        const wash = span(t, 0, 0.12);
        ctx.fillStyle = 'rgba(4,6,11,' + (0.92 * wash).toFixed(3) + ')';
        ctx.fillRect(0, 0, w, h);

        const accent = s.data.team === 'impostor' ? '#ff3f5b'
          : s.data.team === 'jester' ? '#f18fb0' : '#34e0b8';
        const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * 0.6);
        g.addColorStop(0, accent + '2e');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = wash * (1 - span(t, 0.85, 1));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;

        /* The duck drops in and settles. */
        const drop = s.calm ? 1 : outCubic(span(t, 0.08, 0.42));
        const bounce = Math.sin(span(t, 0.35, 0.6) * Math.PI) * 0.1;
        ctx.save();
        ctx.translate(w / 2, h * 0.44 - (1 - drop) * h * 0.4);
        ctx.scale(1 + bounce, 1 - bounce);
        duck(ctx, s.data.colorIdx, s.data.hatIdx, Math.min(w, h) / 175, {
          dir: 1, quack: span(t, 0.4, 0.55) * (1 - span(t, 0.55, 0.75)),
        });
        ctx.restore();

        const words = span(t, 0.34, 0.5) * (1 - span(t, 0.88, 1));
        title(ctx, w, h * 0.68, (s.data.name || '').toUpperCase(),
          Math.max(30, Math.min(76, w * 0.07)), accent, words);
        if (s.data.sub) {
          title(ctx, w, h * 0.76, s.data.sub, Math.max(13, Math.min(19, w * 0.019)), '#cfd9e8', words * 0.9);
        }
        bars(ctx, w, h, Math.min(span(t, 0, 0.1), 1 - span(t, 0.9, 1)));
      },
    },
  };

  function draw(ctx, w, h, dt) {
    if (!scene) return;
    step(dt);
    if (!scene) return;
    scene.spec.draw(ctx, w, h, scene);
  }

  NS.cinema = { play, draw, active, stop, get calm() { return calm; } };
})(window.NS);
