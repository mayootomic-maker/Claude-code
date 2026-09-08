/* Drawing a person.

   Everything is drawn with paths rather than sprites, which is what lets a
   colour, a hat and a walk cycle combine freely -- fourteen colours by twelve
   hats is a spritesheet nobody wants to maintain, and the shading has to
   change with the colour anyway or the dark suits read as holes in the floor.

   The silhouette is the readable thing at the size these are on screen, so it
   is the part that got the attention: a wide flat base, a high shoulder, and a
   visor that sits proud of the head. You should be able to tell who is who
   from the shape alone at the edge of the light, before the colour resolves. */

(function (NS) {
  'use strict';

  const C = NS.config;

  /* Rounded rectangles by hand: ctx.roundRect is recent enough that a school
     iPad might not have it, and this is four lines. */
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

  const BODY_W = 27;
  const BODY_H = 34;
  const LEG_H = 8;

  /* The bean. Drawn facing right and mirrored for the other direction, so
     there is one shape to get right rather than two to keep matching. */
  function beanPath(ctx, w, h) {
    const halfW = w / 2;
    ctx.beginPath();
    ctx.moveTo(-halfW, 0);
    ctx.lineTo(-halfW, -h * 0.42);
    ctx.bezierCurveTo(-halfW, -h * 0.86, -halfW * 0.72, -h, 0, -h);
    ctx.bezierCurveTo(halfW * 0.86, -h, halfW, -h * 0.82, halfW, -h * 0.44);
    ctx.lineTo(halfW, 0);
    ctx.closePath();
  }

  function shade(ctx, colour, h) {
    const g = ctx.createLinearGradient(0, -h, 0, 0);
    g.addColorStop(0, colour.rim);
    g.addColorStop(0.34, colour.body);
    g.addColorStop(1, colour.dark);
    return g;
  }

  /* ---- hats -------------------------------------------------------------- */

  /* Each hat is drawn at the top of the head, in a space where (0,0) is the
     crown and x grows the way the player faces. */
  const HAT_ART = {
    none() {},
    hardhat(ctx) {
      ctx.fillStyle = '#f2b134';
      ctx.beginPath();
      ctx.ellipse(0, 1, 15, 5, 0, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 1, 11, 10, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#d1941f';
      ctx.fillRect(-1.6, -9, 3.2, 10);
    },
    beanie(ctx) {
      ctx.fillStyle = '#c0523f';
      ctx.beginPath();
      ctx.ellipse(0, 1, 12, 11, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#e8e2d4';
      rr(ctx, -12.5, -1, 25, 5, 2.5); ctx.fill();
      ctx.fillStyle = '#e8e2d4';
      ctx.beginPath(); ctx.arc(0, -12, 4, 0, Math.PI * 2); ctx.fill();
    },
    headset(ctx) {
      ctx.strokeStyle = '#2b3348'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 2, 12, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      ctx.fillStyle = '#39435c';
      rr(ctx, -14.5, 0, 6, 10, 3); ctx.fill();
      rr(ctx, 8.5, 0, 6, 10, 3); ctx.fill();
      ctx.strokeStyle = '#39435c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(11, 9); ctx.quadraticCurveTo(15, 15, 9, 17); ctx.stroke();
      ctx.fillStyle = '#34e0b8';
      ctx.beginPath(); ctx.arc(8, 17.5, 2.2, 0, Math.PI * 2); ctx.fill();
    },
    antenna(ctx) {
      ctx.strokeStyle = '#8d97ad'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 2); ctx.quadraticCurveTo(4, -8, 1, -16); ctx.stroke();
      ctx.fillStyle = '#ff3f5b';
      ctx.beginPath(); ctx.arc(1, -18, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,63,91,0.35)';
      ctx.beginPath(); ctx.arc(1, -18, 6.5, 0, Math.PI * 2); ctx.fill();
    },
    crown(ctx) {
      ctx.fillStyle = '#f0c04a';
      ctx.beginPath();
      ctx.moveTo(-11, 2); ctx.lineTo(-11, -7); ctx.lineTo(-5.5, -2); ctx.lineTo(0, -10);
      ctx.lineTo(5.5, -2); ctx.lineTo(11, -7); ctx.lineTo(11, 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff3f5b';
      ctx.beginPath(); ctx.arc(0, -1, 2, 0, Math.PI * 2); ctx.fill();
    },
    flower(ctx) {
      ctx.strokeStyle = '#4ca85c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-6, 3); ctx.quadraticCurveTo(-9, -4, -7, -9); ctx.stroke();
      ctx.fillStyle = '#f18fb0';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath(); ctx.ellipse(-7 + Math.cos(a) * 4, -10 + Math.sin(a) * 4, 3.4, 3.4, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#f0c04a';
      ctx.beginPath(); ctx.arc(-7, -10, 2.6, 0, Math.PI * 2); ctx.fill();
    },
    cap(ctx) {
      ctx.fillStyle = '#3d6fe0';
      ctx.beginPath(); ctx.ellipse(0, 2, 12, 10, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#2b52ab';
      rr(ctx, -17, -1, 8, 4.5, 2); ctx.fill();
      ctx.fillStyle = '#e8e2d4';
      ctx.beginPath(); ctx.arc(2, -6, 2, 0, Math.PI * 2); ctx.fill();
    },
    halo(ctx) {
      ctx.strokeStyle = '#ffd77a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, -10, 11, 3.6, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,215,122,0.28)'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.ellipse(0, -10, 11, 3.6, 0, 0, Math.PI * 2); ctx.stroke();
    },
    cone(ctx) {
      ctx.fillStyle = '#ff7a3d';
      ctx.beginPath(); ctx.moveTo(-9, 2); ctx.lineTo(0, -17); ctx.lineTo(9, 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8e2d4';
      ctx.beginPath(); ctx.moveTo(-6.2, -5); ctx.lineTo(-4.4, -9); ctx.lineTo(4.4, -9); ctx.lineTo(6.2, -5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d1541f';
      rr(ctx, -11, 0, 22, 4, 1.5); ctx.fill();
    },
    plant(ctx) {
      ctx.fillStyle = '#a3603c';
      ctx.beginPath(); ctx.moveTo(-8, 3); ctx.lineTo(-6, -6); ctx.lineTo(6, -6); ctx.lineTo(8, 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4ca85c';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(i * 5, -12 - Math.abs(i) * -2, 3.6, 8, i * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    band(ctx) {
      ctx.fillStyle = '#ff3f5b';
      rr(ctx, -13, -1, 26, 5.5, 2.5); ctx.fill();
      ctx.strokeStyle = '#ff3f5b'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-12, 2); ctx.quadraticCurveTo(-19, 5, -16, 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-12, 3); ctx.quadraticCurveTo(-21, 9, -14, 15); ctx.stroke();
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

  /* Drawn upright rather than mirrored with the body, so an arrow means the
     same thing whichever way somebody is walking. Light fill on a dark ring so
     it reads on every one of the fourteen suits, including Bone and Ink. */
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

  /* ---- the player -------------------------------------------------------- */

  /* `p` is a world entity. `opts.alpha` dims a peer standing in your light's
     falloff; `opts.outline` is the teammate glow an impostor sees on another
     impostor, and the only information the renderer adds that the game did
     not already know. */
  function drawPlayer(ctx, p, opts) {
    const o = opts || {};
    const colour = C.colorById((C.COLORS[p.shiftIdx >= 0 ? p.shiftIdx : p.colorIdx] || C.COLORS[0]).id);
    const scale = o.scale || 1;
    const ghost = p.ghost;
    const alpha = o.alpha == null ? 1 : o.alpha;
    if (alpha <= 0.02) return;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha * (ghost ? 0.46 : (p.invisible ? 0.16 : 1));

    const walk = p.walk || 0;
    const bob = ghost ? Math.sin(walk * 0.35 + p.x * 0.01) * 2.6 : (p.bob || 0);

    if (!ghost) {
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.beginPath();
      ctx.ellipse(0, 2, BODY_W * 0.52, 5.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.translate(0, bob);

    if (o.outline) {
      ctx.save();
      ctx.strokeStyle = o.outline;
      ctx.lineWidth = 5;
      ctx.globalAlpha = alpha * 0.55;
      ctx.scale(p.dir, 1);
      beanPath(ctx, BODY_W, BODY_H);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.scale(p.dir, 1);

    if (!ghost) {
      /* Legs first, so the body overlaps them at the hip. */
      const swing = p.moving ? Math.sin(walk) * 3.4 : 0;
      ctx.fillStyle = colour.dark;
      rr(ctx, -9.5, -LEG_H + swing * 0.2, 8, LEG_H + 2 + swing, 3.4); ctx.fill();
      rr(ctx, 1.5, -LEG_H - swing * 0.2, 8, LEG_H + 2 - swing, 3.4); ctx.fill();
    }

    /* Backpack, behind the body and on the side away from the face. */
    ctx.fillStyle = colour.dark;
    rr(ctx, -BODY_W / 2 - 6.5, -BODY_H * 0.76, 8, BODY_H * 0.46, 4);
    ctx.fill();

    if (ghost) {
      /* A tail instead of legs: three scallops that drift with the bob. */
      ctx.fillStyle = shade(ctx, colour, BODY_H);
      ctx.beginPath();
      ctx.moveTo(-BODY_W / 2, -BODY_H * 0.42);
      ctx.bezierCurveTo(-BODY_W / 2, -BODY_H * 0.86, -BODY_W * 0.36, -BODY_H, 0, -BODY_H);
      ctx.bezierCurveTo(BODY_W * 0.43, -BODY_H, BODY_W / 2, -BODY_H * 0.82, BODY_W / 2, -BODY_H * 0.44);
      ctx.lineTo(BODY_W / 2, -2);
      for (let i = 0; i < 3; i++) {
        const x0 = BODY_W / 2 - (i * BODY_W) / 3;
        ctx.quadraticCurveTo(x0 - BODY_W / 6, 5 + Math.sin(walk * 0.5 + i) * 2.4, x0 - BODY_W / 3, -2);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = shade(ctx, colour, BODY_H);
      beanPath(ctx, BODY_W, BODY_H);
      ctx.fill();
      /* A rim on the lit side keeps Ink and Slate off the floor colour. */
      ctx.strokeStyle = colour.rim;
      ctx.globalAlpha *= 0.5;
      ctx.lineWidth = 1.6;
      ctx.save();
      ctx.clip();
      beanPath(ctx, BODY_W, BODY_H);
      ctx.translate(1.6, -1.6);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha /= 0.5;
    }

    /* Visor. The glint is a fixed highlight rather than a reflection of
       anything -- it reads as glass and costs one arc. */
    const vx = 4.2, vy = -BODY_H + 12.5;
    const vg = ctx.createLinearGradient(vx - 8, vy - 7, vx + 8, vy + 7);
    vg.addColorStop(0, '#cfe4f5');
    vg.addColorStop(0.5, '#8fb4d4');
    vg.addColorStop(1, '#5d7f9e');
    ctx.fillStyle = vg;
    ctx.beginPath();
    ctx.ellipse(vx, vy, 11.5, 8, -0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(11,16,26,0.5)';
    ctx.beginPath();
    ctx.ellipse(vx, vy, 11.5, 8, -0.06, Math.PI * 0.15, Math.PI * 0.72);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(vx - 3.6, vy - 2.8, 3.6, 2.4, -0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    if (showSymbols && !ghost) {
      ctx.save();
      ctx.translate(0, -BODY_H * 0.36);
      drawSymbol(ctx, p.shiftIdx >= 0 ? p.shiftIdx : p.colorIdx, 5.4);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(0, -BODY_H - 1);
    drawHat(ctx, p.hatIdx, p.dir);
    ctx.restore();

    if (p.shielded) {
      ctx.strokeStyle = 'rgba(52,224,184,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, -BODY_H * 0.5, BODY_W * 0.82, BODY_H * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  /* A body reads as a person who fell, not as a prop: same bean, tipped, with
     the visor still catching light. The stain is small on purpose -- this gets
     played in classrooms. */
  function drawBody(ctx, body) {
    const colour = C.COLORS[body.colorIdx] || C.COLORS[0];
    ctx.save();
    ctx.translate(body.x, body.y);

    ctx.fillStyle = 'rgba(120,18,32,0.42)';
    ctx.beginPath();
    ctx.ellipse(0, 3, 26, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(160,26,44,0.5)';
    ctx.beginPath();
    ctx.ellipse(-9, 5, 11, 4.5, 0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.scale(body.facing < 0 ? -1 : 1, 1);
    ctx.rotate(-Math.PI / 2);
    ctx.translate(0, 9);

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(0, 2, BODY_W * 0.5, 5, 0, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = colour.dark;
    rr(ctx, -BODY_W / 2 - 6, -BODY_H * 0.7, 7.5, BODY_H * 0.42, 3.6); ctx.fill();
    ctx.fillStyle = shade(ctx, colour, BODY_H);
    beanPath(ctx, BODY_W, BODY_H * 0.82);
    ctx.fill();

    ctx.fillStyle = '#7e9ab5';
    ctx.beginPath();
    ctx.ellipse(4, -BODY_H * 0.82 + 11, 10, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(11,16,26,0.55)';
    ctx.beginPath();
    ctx.ellipse(4, -BODY_H * 0.82 + 11, 10, 7, 0, Math.PI * 0.1, Math.PI * 0.8);
    ctx.fill();

    ctx.restore();
  }

  /* The lobby, the meeting grid and the role card all need a portrait. Same
     drawing, standing still, centred in a box of `size`. */
  /* The drawing's origin is the feet, and a hat reaches about 22 above the
     head, so the content runs from -(BODY_H + 22) to +6. Centring on the body
     alone -- which is what this did at first -- crops every hat against the
     top of the box. */
  const AVATAR_TOP = BODY_H + 24;
  const AVATAR_BOTTOM = 7;
  function drawAvatar(ctx, colorIdx, hatIdx, size, opts) {
    const o = opts || {};
    const scale = size / (AVATAR_TOP + AVATAR_BOTTOM);
    ctx.save();
    ctx.translate(0, ((AVATAR_TOP - AVATAR_BOTTOM) / 2) * scale);
    drawPlayer(ctx, {
      x: 0, y: 0, dir: 1, colorIdx, hatIdx, shiftIdx: -1,
      moving: false, walk: 0, bob: 0, ghost: !!o.ghost, alive: !o.ghost,
    }, { scale, alpha: o.alpha == null ? 1 : o.alpha, outline: o.outline });
    ctx.restore();
  }

  NS.characters = {
    drawPlayer, drawBody, drawAvatar, drawHat, drawSymbol, setSymbols,
    rr, BODY_W, BODY_H, beanPath,
  };
})(window.NS);
