/* Ducks.

   Every one is drawn with paths, so a colour, a hat and a walk cycle combine
   freely and the same drawing serves the world, the portraits, the meeting
   grid and the camera feeds. Nothing here is a sprite sheet.

   What makes a duck read as a duck at thirty pixels is not detail, it is the
   silhouette and the walk: a heavy low body, a round head set forward on a
   short neck, a bill that breaks the outline, and a side-to-side waddle that
   nothing else in the game does. The shading is a single radial gradient plus
   a rim light -- volume, not decoration, because a flat fill at this size
   reads as a hole in the floor rather than an animal. */

(function (NS) {
  'use strict';

  const C = NS.config;
  const U = NS.util;

  function rr(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  /* The duck fits the space the old body took, so the camera, the name tags
     and the interaction ranges are all still tuned. */
  const BODY_W = 34;
  const BODY_H = 34;
  const HEAD_Y = -31;
  const HEAD_R = 10.5;

  const BILL = '#f0a63c';
  const BILL_DARK = '#c47c1c';
  const FOOT = '#e08a2a';

  /* ---- parts --------------------------------------------------------------
     All drawn facing right, in a space where (0,0) is between the feet and y
     runs negative upward. The caller mirrors for the other direction. */

  function drawFeet(ctx, walk, moving, lift) {
    const swing = moving ? Math.sin(walk) : 0;
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const phase = moving ? Math.sin(walk + (i ? 0 : Math.PI)) : 0;
      const fx = 1.5 + side * 5.5 + phase * 3.2;
      const fy = -Math.max(0, phase) * 3.4 - (lift || 0);
      ctx.save();
      ctx.translate(fx, fy);
      ctx.fillStyle = i ? FOOT : BILL_DARK;   // the far foot sits in shadow
      ctx.beginPath();
      ctx.moveTo(-1.5, -4);
      ctx.lineTo(6.5, 0.5);
      ctx.lineTo(3.5, 1.5);
      ctx.lineTo(5, 2.6);
      ctx.lineTo(0.5, 2.2);
      ctx.lineTo(-2.5, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    return swing;
  }

  /* A short upturned fan, not a spike. The first version was a long point at
     tail height and every duck looked like it had a beak at both ends. */
  function drawTail(ctx, colour, walk, moving) {
    const wag = moving ? Math.sin(walk * 0.5) * 0.14 : 0;
    ctx.save();
    ctx.translate(-13, -23);
    ctx.rotate(-0.6 + wag);
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate((i - 1) * 0.32);
      ctx.fillStyle = i === 1 ? colour.body : colour.dark;
      ctx.beginPath();
      ctx.moveTo(1, 2.6);
      ctx.quadraticCurveTo(-5, 2.2, -8.5, -1.4);
      ctx.quadraticCurveTo(-5, -3, 1, -2.4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawWing(ctx, colour, walk, moving, flap) {
    const beat = flap ? Math.sin(walk * 2.4) * 0.55 : (moving ? Math.sin(walk) * 0.14 : 0);
    ctx.save();
    ctx.translate(-1, -19);
    ctx.rotate(beat);
    const g = ctx.createLinearGradient(0, -8, 0, 9);
    g.addColorStop(0, colour.body);
    g.addColorStop(1, colour.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(6, -7);
    ctx.quadraticCurveTo(11, 0, 3, 8.5);
    ctx.quadraticCurveTo(-6, 9, -8.5, 1);
    ctx.quadraticCurveTo(-6, -7, 6, -7);
    ctx.closePath();
    ctx.fill();
    /* Three feather lines, which is all it takes to stop the wing reading as
       a smudge of a slightly darker colour. */
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(4 - i * 3.4, 6.5 - i * 0.6);
      ctx.quadraticCurveTo(-2 - i * 2, 3 - i, -6 - i * 0.8, -1.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBill(ctx, open) {
    const spread = (open || 0) * 3.4;
    ctx.save();
    ctx.translate(7, HEAD_Y + 2);
    const g = ctx.createLinearGradient(0, -4, 0, 5);
    g.addColorStop(0, '#ffc76b');
    g.addColorStop(1, BILL);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -3.5 - spread * 1.5);
    ctx.quadraticCurveTo(12, -4.5 - spread * 3, 15.5, -1.5 - spread * 3.5);
    ctx.quadraticCurveTo(13, 0.5 - spread * 1.5, 0, 0.5 - spread * 1.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = BILL_DARK;
    ctx.beginPath();
    ctx.moveTo(0, 0.6 + spread * 1.2);
    ctx.quadraticCurveTo(11, 1.4 + spread * 3, 14, 2.4 + spread * 4);
    ctx.quadraticCurveTo(9, 4.4 + spread * 3, 0, 3.6 + spread * 1.4);
    ctx.closePath();
    ctx.fill();
    /* One nostril. It is two pixels and it is the difference between a beak
       and an orange wedge. */
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(5.5, -1.6 - spread, 1.1, 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEye(ctx, blink, look) {
    const x = 4.4, y = HEAD_Y - 2.2;
    if (blink > 0.5) {
      ctx.strokeStyle = '#1a1f2c';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 2.6, y);
      ctx.quadraticCurveTo(x, y + 1.6, x + 2.6, y);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = '#fdfefe';
    ctx.beginPath();
    ctx.ellipse(x, y, 3.4, 3.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#12161f';
    ctx.beginPath();
    ctx.ellipse(x + 0.9 + (look || 0), y + 0.3, 2, 2.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(x + 0.2 + (look || 0), y - 1, 0.9, 1, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function bodyGradient(ctx, colour) {
    const g = ctx.createRadialGradient(-3, -25, 2, 0, -15, 24);
    g.addColorStop(0, colour.rim);
    g.addColorStop(0.4, colour.body);
    g.addColorStop(1, colour.dark);
    return g;
  }

  /* ---- hats ---------------------------------------------------------------
     Drawn with the crown of the head at the origin. A duck's head is smaller
     than the old body's, so everything sits tighter. */

  const HAT_ART = {
    none() {},
    hardhat(ctx) {
      ctx.fillStyle = '#f2b134';
      ctx.beginPath(); ctx.ellipse(0, 1, 12, 4, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 1, 9, 8.5, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#d1941f';
      ctx.fillRect(-1.3, -7.5, 2.6, 8.5);
    },
    beanie(ctx) {
      ctx.fillStyle = '#c0523f';
      ctx.beginPath(); ctx.ellipse(0, 1, 9.5, 9, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#e8e2d4';
      rr(ctx, -10, -1, 20, 4.4, 2.2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -10, 3.4, 0, Math.PI * 2); ctx.fill();
    },
    headset(ctx) {
      ctx.strokeStyle = '#2b3348'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 2, 9.5, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      ctx.fillStyle = '#39435c';
      rr(ctx, -11.5, 0, 5, 8.5, 2.5); ctx.fill();
      rr(ctx, 6.5, 0, 5, 8.5, 2.5); ctx.fill();
      ctx.fillStyle = '#34e0b8';
      ctx.beginPath(); ctx.arc(9, 10, 1.9, 0, Math.PI * 2); ctx.fill();
    },
    antenna(ctx) {
      ctx.strokeStyle = '#8d97ad'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 2); ctx.quadraticCurveTo(3.5, -7, 1, -14); ctx.stroke();
      ctx.fillStyle = '#ff3f5b';
      ctx.beginPath(); ctx.arc(1, -16, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,63,91,0.32)';
      ctx.beginPath(); ctx.arc(1, -16, 5.8, 0, Math.PI * 2); ctx.fill();
    },
    crown(ctx) {
      ctx.fillStyle = '#f0c04a';
      ctx.beginPath();
      ctx.moveTo(-9, 2); ctx.lineTo(-9, -6); ctx.lineTo(-4.5, -1.5); ctx.lineTo(0, -8.5);
      ctx.lineTo(4.5, -1.5); ctx.lineTo(9, -6); ctx.lineTo(9, 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff3f5b';
      ctx.beginPath(); ctx.arc(0, -0.5, 1.7, 0, Math.PI * 2); ctx.fill();
    },
    flower(ctx) {
      ctx.strokeStyle = '#4ca85c'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(-5, 3); ctx.quadraticCurveTo(-7.5, -3, -6, -7.5); ctx.stroke();
      ctx.fillStyle = '#f18fb0';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(-6 + Math.cos(a) * 3.4, -8.5 + Math.sin(a) * 3.4, 2.9, 2.9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#f0c04a';
      ctx.beginPath(); ctx.arc(-6, -8.5, 2.2, 0, Math.PI * 2); ctx.fill();
    },
    cap(ctx) {
      ctx.fillStyle = '#3d6fe0';
      ctx.beginPath(); ctx.ellipse(0, 2, 9.5, 8, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#2b52ab';
      rr(ctx, -14.5, -1, 7, 4, 2); ctx.fill();
      ctx.fillStyle = '#e8e2d4';
      ctx.beginPath(); ctx.arc(1.5, -5, 1.7, 0, Math.PI * 2); ctx.fill();
    },
    halo(ctx) {
      ctx.strokeStyle = '#ffd77a'; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.ellipse(0, -9, 9, 3, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,215,122,0.3)'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.ellipse(0, -9, 9, 3, 0, 0, Math.PI * 2); ctx.stroke();
    },
    cone(ctx) {
      ctx.fillStyle = '#ff7a3d';
      ctx.beginPath(); ctx.moveTo(-7.5, 2); ctx.lineTo(0, -15); ctx.lineTo(7.5, 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8e2d4';
      ctx.beginPath();
      ctx.moveTo(-5.2, -4); ctx.lineTo(-3.7, -7.5); ctx.lineTo(3.7, -7.5); ctx.lineTo(5.2, -4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d1541f';
      rr(ctx, -9.5, 0, 19, 3.4, 1.4); ctx.fill();
    },
    plant(ctx) {
      ctx.fillStyle = '#a3603c';
      ctx.beginPath(); ctx.moveTo(-6.5, 3); ctx.lineTo(-5, -5); ctx.lineTo(5, -5); ctx.lineTo(6.5, 3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4ca85c';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(i * 4.2, -10.5, 3, 6.5, i * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    band(ctx) {
      ctx.fillStyle = '#ff3f5b';
      rr(ctx, -10.5, -1, 21, 4.6, 2); ctx.fill();
      ctx.strokeStyle = '#ff3f5b'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-9.5, 2); ctx.quadraticCurveTo(-15, 4.5, -13, 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-9.5, 3); ctx.quadraticCurveTo(-17, 7.5, -11, 12); ctx.stroke();
    },
  };

  function drawHat(ctx, hatIdx, dir) {
    const hat = C.HATS[hatIdx];
    if (!hat || hat.id === 'none') return;
    const art = HAT_ART[hat.id];
    if (!art) return;
    ctx.save();
    ctx.scale(dir, 1);
    art(ctx);
    ctx.restore();
  }

  /* ---- colourblind marks -------------------------------------------------- */

  const SYMBOL_ART = {
    circle(ctx, r) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); },
    square(ctx, r) { ctx.fillRect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7); },
    triangle(ctx, r) {
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.92, r * 0.72);
      ctx.lineTo(-r * 0.92, r * 0.72); ctx.closePath(); ctx.fill();
    },
    diamond(ctx, r) {
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r);
      ctx.lineTo(-r, 0); ctx.closePath(); ctx.fill();
    },
    star(ctx, r) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rad = i % 2 ? r * 0.45 : r;
        if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
        else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath(); ctx.fill();
    },
    cross(ctx, r) {
      ctx.fillRect(-r * 0.32, -r, r * 0.64, r * 2);
      ctx.fillRect(-r, -r * 0.32, r * 2, r * 0.64);
    },
    chevron(ctx, r) {
      ctx.beginPath(); ctx.moveTo(-r, r * 0.2); ctx.lineTo(0, -r * 0.7); ctx.lineTo(r, r * 0.2);
      ctx.lineTo(r, r * 0.85); ctx.lineTo(0, -r * 0.05); ctx.lineTo(-r, r * 0.85);
      ctx.closePath(); ctx.fill();
    },
    ring(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
      ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    },
    bar(ctx, r) { ctx.fillRect(-r, -r * 0.34, r * 2, r * 0.68); },
    dots(ctx, r) {
      ctx.beginPath(); ctx.arc(-r * 0.5, 0, r * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.5, 0, r * 0.42, 0, Math.PI * 2); ctx.fill();
    },
    hexagon(ctx, r) {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
    },
    drop(ctx, r) {
      ctx.beginPath(); ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r, 0, 0, r); ctx.quadraticCurveTo(-r, 0, 0, -r);
      ctx.fill();
    },
    arrow(ctx, r) {
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.9, r * 0.1);
      ctx.lineTo(r * 0.34, r * 0.1); ctx.lineTo(r * 0.34, r);
      ctx.lineTo(-r * 0.34, r); ctx.lineTo(-r * 0.34, r * 0.1);
      ctx.lineTo(-r * 0.9, r * 0.1); ctx.closePath(); ctx.fill();
    },
    wave(ctx, r) {
      ctx.lineWidth = r * 0.44;
      ctx.lineCap = 'round';
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(-r, r * 0.3);
      ctx.quadraticCurveTo(-r * 0.35, -r * 0.9, 0, r * 0.1);
      ctx.quadraticCurveTo(r * 0.35, r * 0.95, r, -r * 0.2);
      ctx.stroke();
    },
  };

  let showSymbols = false;
  function setSymbols(on) { showSymbols = !!on; }

  function drawSymbol(ctx, colorIdx, size) {
    const art = SYMBOL_ART[C.SYMBOLS[colorIdx % C.SYMBOLS.length]];
    if (!art) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(5,7,13,0.75)';
    ctx.lineWidth = size * 0.55;
    ctx.lineJoin = 'round';
    ctx.fillStyle = 'rgba(5,7,13,0.75)';
    art(ctx, size * 1.12);
    ctx.fillStyle = '#f2f6fb';
    art(ctx, size);
    ctx.restore();
  }

  /* ---- the whole duck ----------------------------------------------------- */

  function drawPlayer(ctx, p, opts) {
    const o = opts || {};
    const colour = C.COLORS[p.shiftIdx >= 0 ? p.shiftIdx : p.colorIdx] || C.COLORS[0];
    const scale = o.scale || 1;
    const ghost = p.ghost;
    const alpha = o.alpha == null ? 1 : o.alpha;
    if (alpha <= 0.02) return;

    const walk = p.walk || 0;
    const moving = !!p.moving;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha * (ghost ? 0.68 : (p.invisible ? 0.16 : 1));

    if (!ghost) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(1, 1, 15, 4.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    /* The waddle. Everything below rocks around a point between the feet,
       which is what a duck does and what nothing else on the station does --
       you can pick a moving player out of the dark by the rhythm alone. */
    const waddle = moving && !ghost ? Math.sin(walk) * 0.13 : 0;
    const bob = ghost
      ? Math.sin(walk * 0.35 + p.x * 0.01) * 3
      : (moving ? Math.abs(Math.sin(walk)) * -2.2 : 0);
    ctx.translate(0, bob);
    ctx.rotate(waddle);

    if (o.outline) {
      ctx.save();
      ctx.globalAlpha = alpha * 0.6;
      ctx.strokeStyle = o.outline;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(0, -16, 17, 15, 0, 0, Math.PI * 2);
      ctx.moveTo(p.dir * 7 + HEAD_R, HEAD_Y);
      ctx.arc(p.dir * 7, HEAD_Y, HEAD_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.scale(p.dir < 0 ? -1 : 1, 1);

    if (!ghost) drawFeet(ctx, walk, moving, 0);
    drawTail(ctx, colour, walk, moving);

    if (ghost) {
      /* A tail of scallops instead of a body bottom: the duck is still a duck,
         it just stopped touching the floor. Lit from its own colour rather
         than shaded down -- a ghost drawn with the solid gradient at half
         opacity came out as a brown smudge you could not identify. */
      const gg = ctx.createRadialGradient(-3, -25, 2, 0, -15, 26);
      gg.addColorStop(0, colour.rim);
      gg.addColorStop(0.5, colour.body);
      gg.addColorStop(1, colour.dark);
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.moveTo(-16, -16);
      ctx.quadraticCurveTo(-17, -30, 0, -31);
      ctx.quadraticCurveTo(16, -30, 16, -14);
      ctx.lineTo(16, -3);
      for (let i = 0; i < 3; i++) {
        const x0 = 16 - (i * 32) / 3;
        ctx.quadraticCurveTo(x0 - 32 / 6, 4 + Math.sin(walk * 0.5 + i) * 2.6, x0 - 32 / 3, -3);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = bodyGradient(ctx, colour);
      ctx.beginPath();
      ctx.ellipse(0, -15.5, 16.5, 14.5, -0.06, 0, Math.PI * 2);
      ctx.fill();
      /* Belly: a lighter crescent low and forward, so the light has a
         direction and the body is not a sphere. */
      ctx.globalAlpha *= 0.5;
      ctx.fillStyle = colour.rim;
      ctx.beginPath();
      ctx.ellipse(4, -10, 10, 6.5, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha /= 0.5;
    }

    drawWing(ctx, colour, walk, moving, !!p.flap);

    /* Head, on a neck short enough to keep the silhouette compact. */
    ctx.fillStyle = colour.dark;
    ctx.beginPath();
    ctx.ellipse(4.5, -24, 8, 7.5, 0.25, 0, Math.PI * 2);
    ctx.fill();

    drawBill(ctx, p.quack || 0);

    const hg = ctx.createRadialGradient(4, HEAD_Y - 5, 1, 7, HEAD_Y, HEAD_R + 3);
    hg.addColorStop(0, ghost ? colour.body : colour.rim);
    hg.addColorStop(0.55, ghost ? colour.body : colour.body);
    hg.addColorStop(1, colour.dark);
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(7, HEAD_Y, HEAD_R, 0, Math.PI * 2);
    ctx.fill();

    drawEye(ctx, p.blink || 0, p.look || 0);

    /* A rim light along the top, drawn last over head and body so it ties the
       two shapes into one animal. */
    ctx.globalAlpha *= 0.4;
    ctx.strokeStyle = colour.rim;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(7, HEAD_Y, HEAD_R - 0.8, Math.PI * 1.15, Math.PI * 1.75);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -15.5, 15.5, 13.5, -0.06, Math.PI * 1.15, Math.PI * 1.72);
    ctx.stroke();
    ctx.globalAlpha /= 0.4;

    ctx.restore();

    if (showSymbols && !ghost) {
      ctx.save();
      ctx.translate(0, -13);
      drawSymbol(ctx, p.shiftIdx >= 0 ? p.shiftIdx : p.colorIdx, 5);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(p.dir * 7, HEAD_Y - HEAD_R + 1);
    drawHat(ctx, p.hatIdx, p.dir < 0 ? -1 : 1);
    ctx.restore();

    if (p.shielded) {
      ctx.strokeStyle = 'rgba(52,224,184,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(1, -19, 22, 22, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  /* A dead duck is on its back with its feet in the air. It is the reading
     everyone already has for a dead cartoon bird, it is legible from across a
     dark room, and it is a great deal easier to have in a classroom than a
     body in a pool of blood. */
  function drawBody(ctx, body) {
    const colour = C.COLORS[body.colorIdx] || C.COLORS[0];
    const dir = body.facing < 0 ? -1 : 1;
    ctx.save();
    ctx.translate(body.x, body.y);

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 5, 24, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();

    /* Loose feathers where it happened. */
    ctx.fillStyle = colour.dark;
    for (let i = 0; i < 5; i++) {
      const a = i * 1.9;
      ctx.save();
      ctx.translate(Math.cos(a) * (18 + i * 2.5), 4 + Math.sin(a) * 6);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, 0, 4.6, 1.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.scale(dir, 1);

    /* Head, thrown back and low, with the bill up. Drawn first so the body
       overlaps the neck. */
    ctx.save();
    ctx.translate(-18, -1);
    ctx.rotate(0.5);
    ctx.fillStyle = BILL;
    ctx.beginPath();
    ctx.moveTo(-4, -4.5);
    ctx.quadraticCurveTo(-13, -6.5, -16, -3.5);
    ctx.quadraticCurveTo(-12, -0.5, -4, -1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = BILL_DARK;
    ctx.beginPath();
    ctx.moveTo(-4, -0.8);
    ctx.quadraticCurveTo(-11, 0.4, -14, -0.6);
    ctx.quadraticCurveTo(-10, 2.2, -4, 2);
    ctx.closePath();
    ctx.fill();
    const hg = ctx.createRadialGradient(-2, -6, 1, 0, -1, 11);
    hg.addColorStop(0, colour.rim);
    hg.addColorStop(1, colour.dark);
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(0, 0, 8.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#12161f';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    for (const ox of [-2.5, 3]) {
      ctx.beginPath();
      ctx.moveTo(ox - 2.2, -4); ctx.lineTo(ox + 2.2, 0.4);
      ctx.moveTo(ox + 2.2, -4); ctx.lineTo(ox - 2.2, 0.4);
      ctx.stroke();
    }
    ctx.restore();

    /* Belly up: the light side of the duck facing the ceiling. */
    const g = ctx.createRadialGradient(2, -10, 2, 2, -2, 20);
    g.addColorStop(0, colour.rim);
    g.addColorStop(0.55, colour.body);
    g.addColorStop(1, colour.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(2, -2, 16, 11.5, 0, 0, Math.PI * 2);
    ctx.fill();

    /* Feet, straight up. This is the whole read at a distance. */
    ctx.strokeStyle = BILL_DARK;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const fx = -2 + i * 9;
      ctx.beginPath();
      ctx.moveTo(fx, -8);
      ctx.lineTo(fx + (i ? 2.5 : -2), -19);
      ctx.stroke();
      ctx.save();
      ctx.translate(fx + (i ? 2.5 : -2), -19);
      ctx.rotate(i ? 0.3 : -0.3);
      ctx.fillStyle = FOOT;
      ctx.beginPath();
      ctx.moveTo(0, 1.5);
      ctx.lineTo(-4.5, -5.5); ctx.lineTo(-1.5, -4); ctx.lineTo(0, -6.5);
      ctx.lineTo(1.5, -4); ctx.lineTo(4.5, -5.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    /* One wing flopped out to the side. */
    ctx.save();
    ctx.translate(9, 2);
    ctx.rotate(0.9);
    ctx.fillStyle = colour.dark;
    ctx.beginPath();
    ctx.moveTo(5, -6);
    ctx.quadraticCurveTo(10, 0, 2.5, 7.5);
    ctx.quadraticCurveTo(-5, 8, -7.5, 1);
    ctx.quadraticCurveTo(-5, -6, 5, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  const AVATAR_TOP = 52;
  const AVATAR_BOTTOM = 8;

  function drawAvatar(ctx, colorIdx, hatIdx, size, opts) {
    const o = opts || {};
    const scale = size / (AVATAR_TOP + AVATAR_BOTTOM);
    ctx.save();
    ctx.translate(0, ((AVATAR_TOP - AVATAR_BOTTOM) / 2) * scale);
    drawPlayer(ctx, {
      x: 0, y: 0, dir: 1, colorIdx, hatIdx, shiftIdx: -1,
      moving: false, walk: 0, ghost: !!o.ghost, alive: !o.ghost,
      blink: 0, quack: o.quack || 0,
    }, { scale, alpha: o.alpha == null ? 1 : o.alpha, outline: o.outline });
    ctx.restore();
  }

  /* Ducks blink, look about and quack. Driven from one place so every duck on
     screen is not doing it in lockstep -- the offset is derived from the id so
     it is stable rather than random every frame. */
  function idle(p, dt, now) {
    if (p.seed === undefined) {
      let h = 0;
      const id = String(p.id || '');
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
      p.seed = h / 997;
    }
    const cycle = (now / 1000 + p.seed * 9) % 4.4;
    p.blink = cycle > 4.24 ? 1 : 0;
    p.look = Math.sin(now / 1400 + p.seed * 6) * 0.7;
    if (p.quack > 0) p.quack = Math.max(0, p.quack - dt * 4);
  }

  NS.characters = {
    drawPlayer, drawBody, drawAvatar, drawHat, drawSymbol, setSymbols, idle,
    rr, BODY_W, BODY_H,
  };
})(window.NS);
