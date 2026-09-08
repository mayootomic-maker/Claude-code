/* Painting Aurora-7, once.

   The map never changes during a round, so it is drawn a single time into an
   offscreen canvas the size of the whole station and blitted from every frame
   after that. Three and a half thousand by two thousand pixels is about thirty
   megabytes: one large allocation at load, against redrawing two and a half
   thousand floor tiles sixty times a second on a phone. Only what actually
   moves -- players, doors, particles, the dark -- is drawn live.

   The room styling is not decoration. Every room has to be recognisable from
   a two-second glimpse at the edge of somebody's light, because that glimpse
   is the entire evidence base of an argument two minutes later. So floors
   differ by wing, each room has one silhouette nothing else has, and the
   labels are set large enough to read at a glance and faint enough to stay
   out of the way. */

(function (NS) {
  'use strict';

  const M = NS.map;
  const T = M.TILE;
  const U = NS.util;
  const rr = NS.characters.rr;

  const HULL = '#1b2436';
  const HULL_EDGE = '#2c3648';
  const KEYLINE = '#3a4761';

  const TONES = {
    clean: { floor: '#232d40', accent: '#37e0c8' },
    plain: { floor: '#1e2739', accent: '#8d97ad' },
    cold:  { floor: '#1c2a3d', accent: '#4d9fd6' },
    hot:   { floor: '#2a2634', accent: '#ffb03a' },
    hall:  { floor: '#171f2e', accent: '#8d97ad' },
  };

  let canvas = null;
  let ctx = null;
  let built = false;

  const px = (t) => t * T;

  /* ---- small parts, reused by the rooms ---------------------------------- */

  function panel(x, y, w, h, fill) {
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    rr(ctx, x - 2, y + 5, w + 4, h, 5); ctx.fill();
    ctx.fillStyle = fill || '#2c3648';
    rr(ctx, x, y, w, h, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    rr(ctx, x + 2, y + 2, w - 4, 4, 2); ctx.fill();
  }

  function screen(x, y, w, h, accent, style) {
    panel(x, y, w, h);
    ctx.fillStyle = '#0d1320';
    rr(ctx, x + 4, y + 4, w - 8, h - 12, 3); ctx.fill();
    ctx.save();
    rr(ctx, x + 4, y + 4, w - 8, h - 12, 3); ctx.clip();
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.8;
    if (style === 'bars') {
      const n = Math.max(3, Math.floor((w - 12) / 11));
      for (let i = 0; i < n; i++) {
        const bh = (h - 20) * (0.25 + ((i * 47) % 13) / 17);
        ctx.fillRect(x + 8 + i * ((w - 16) / n), y + h - 12 - bh, (w - 16) / n - 3, bh);
      }
    } else if (style === 'wave') {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = accent; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= w - 12; i += 3) {
        const yy = y + (h - 12) / 2 + Math.sin(i * 0.14) * (h - 22) * 0.3;
        if (i === 0) ctx.moveTo(x + 6 + i, yy); else ctx.lineTo(x + 6 + i, yy);
      }
      ctx.stroke();
    } else {
      for (let i = 0; i < 4; i++) {
        const lw = (w - 16) * [0.9, 0.55, 0.75, 0.4][i];
        if (y + 9 + i * 7 > y + h - 14) break;
        ctx.fillRect(x + 8, y + 9 + i * 7, lw, 2.6);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.1;
    rr(ctx, x + 4, y + 4, w - 8, h - 12, 3); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function crate(x, y, size, tint) {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    rr(ctx, x - 2, y + 5, size + 4, size, 3); ctx.fill();
    ctx.fillStyle = tint || '#3a4560';
    rr(ctx, x, y, size, size, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 5, y + size / 2); ctx.lineTo(x + size - 5, y + size / 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(x + 4, y + 4, size - 8, 3);
  }

  function pipe(x, y, len, vertical, tint) {
    ctx.strokeStyle = tint || '#39435c';
    ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(vertical ? x : x + len, vertical ? y + len : y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(vertical ? x - 2.6 : x, vertical ? y : y - 2.6);
    ctx.lineTo(vertical ? x - 2.6 : x + len, vertical ? y + len : y - 2.6);
    ctx.stroke();
    ctx.fillStyle = '#4a5570';
    const steps = Math.max(1, Math.floor(len / 70));
    for (let i = 1; i <= steps; i++) {
      const cx = vertical ? x : x + (len / (steps + 1)) * i;
      const cy = vertical ? y + (len / (steps + 1)) * i : y;
      rr(ctx, cx - 7.5, cy - 5.5, 15, 11, 2); ctx.fill();
    }
  }

  /* A window onto the outside. The only warm thing in the game is a planet
     nobody on board is going to reach. */
  function viewport(x, y, w, h, rand) {
    ctx.fillStyle = '#05070d';
    rr(ctx, x, y, w, h, 6); ctx.fill();
    ctx.save();
    rr(ctx, x, y, w, h, 6); ctx.clip();
    for (let i = 0; i < w * h / 900; i++) {
      const sx = x + rand() * w, sy = y + rand() * h, r = rand();
      ctx.fillStyle = r > 0.9 ? 'rgba(230,240,255,0.9)' : 'rgba(160,185,220,0.45)';
      ctx.fillRect(sx, sy, r > 0.9 ? 2 : 1.3, r > 0.9 ? 2 : 1.3);
    }
    const g = ctx.createRadialGradient(x + w * 0.78, y + h * 1.25, 8, x + w * 0.78, y + h * 1.25, h * 1.5);
    g.addColorStop(0, 'rgba(255,176,58,0.5)');
    g.addColorStop(0.45, 'rgba(190,90,60,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x + w * 0.78, y + h * 1.25, h * 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#3a4761'; ctx.lineWidth = 5;
    rr(ctx, x, y, w, h, 6); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1.5;
    rr(ctx, x + 3, y + 3, w - 6, h - 6, 4); ctx.stroke();
  }

  function hazardStripe(x, y, w, h) {
    ctx.save();
    rr(ctx, x, y, w, h, 2); ctx.clip();
    ctx.fillStyle = '#3a3320';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,176,58,0.55)';
    for (let i = -h; i < w; i += 22) {
      ctx.beginPath();
      ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y);
      ctx.lineTo(x + i + h + 11, y); ctx.lineTo(x + i + 11, y + h);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function floorGlyph(cx, cy, r, accent, alpha) {
    ctx.strokeStyle = accent;
    ctx.globalAlpha = alpha == null ? 0.16 : alpha;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0.4, Math.PI * 1.4); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* ---- the rooms --------------------------------------------------------- */

  /* Each takes the room's pixel rectangle. Everything is positioned from the
     room's own edges so a layout tweak in world/map.js does not leave the
     furniture behind in empty space. */
  const ROOM_ART = {
    reactor(r, rand) {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const g = ctx.createRadialGradient(cx, cy, 6, cx, cy, 118);
      g.addColorStop(0, 'rgba(255,176,58,0.5)');
      g.addColorStop(0.5, 'rgba(255,110,50,0.16)');
      g.addColorStop(1, 'rgba(255,110,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 130, cy - 130, 260, 260);
      ctx.fillStyle = '#2c3648';
      ctx.beginPath(); ctx.arc(cx, cy, 62, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a2130';
      ctx.beginPath(); ctx.arc(cx, cy, 52, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffb03a';
      ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe0a8';
      ctx.beginPath(); ctx.arc(cx, cy, 19, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3a4761'; ctx.lineWidth = 7;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 60, cy + Math.sin(a) * 60);
        ctx.lineTo(cx + Math.cos(a) * 92, cy + Math.sin(a) * 92);
        ctx.stroke();
      }
      pipe(r.x + 22, r.y + 28, r.h - 56, true);
      pipe(r.x + r.w - 22, r.y + 28, r.h - 56, true);
      hazardStripe(r.x + 12, r.y + r.h - 26, r.w - 24, 14);
    },

    upperEngine(r) { engine(r, 1); },
    lowerEngine(r) { engine(r, -1); },

    security(r) {
      const wallY = r.y + 22;
      for (let i = 0; i < 6; i++) {
        screen(r.x + 24 + i * 44, wallY, 38, 34, '#4d9fd6', i % 2 ? 'bars' : 'wave');
      }
      panel(r.x + 24, wallY + 48, 232, 22);
      ctx.fillStyle = '#39435c';
      rr(ctx, r.x + 120, wallY + 78, 44, 40, 8); ctx.fill();
    },

    medbay(r) {
      for (let i = 0; i < 3; i++) {
        const bx = r.x + 26 + i * 74, by = r.y + 32;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        rr(ctx, bx - 2, by + 5, 54, 92, 8); ctx.fill();
        ctx.fillStyle = '#e2e8f2';
        rr(ctx, bx, by, 52, 90, 8); ctx.fill();
        ctx.fillStyle = '#9fb2cc';
        rr(ctx, bx + 6, by + 8, 40, 26, 5); ctx.fill();
        ctx.fillStyle = '#4d9fd6';
        rr(ctx, bx + 6, by + 42, 40, 40, 4); ctx.fill();
      }
      const sx = r.x + r.w / 2 + 40, sy = r.y + r.h - 62;
      floorGlyph(sx, sy, 34, '#37e0c8', 0.3);
      ctx.fillStyle = 'rgba(55,224,200,0.1)';
      ctx.beginPath(); ctx.arc(sx, sy, 30, 0, Math.PI * 2); ctx.fill();
    },

    electrical(r) {
      for (let i = 0; i < 5; i++) {
        screen(r.x + r.w - 56, r.y + 26 + i * 44, 44, 34, '#ffb03a', 'bars');
      }
      ctx.strokeStyle = '#c0523f'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        ctx.strokeStyle = ['#c0523f', '#f0a63c', '#4ca85c', '#3d6fe0'][i];
        ctx.beginPath();
        ctx.moveTo(r.x + 20, r.y + 40 + i * 16);
        ctx.bezierCurveTo(r.x + 90, r.y + 20 + i * 30, r.x + 130, r.y + 120, r.x + 76, r.y + r.h - 34);
        ctx.stroke();
      }
      ctx.fillStyle = '#141b2a';
      rr(ctx, r.x + 18, r.y + r.h - 74, 90, 56, 4); ctx.fill();
      ctx.strokeStyle = '#39435c'; ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(r.x + 22 + i * 15, r.y + r.h - 70); ctx.lineTo(r.x + 22 + i * 15, r.y + r.h - 22);
        ctx.stroke();
      }
      hazardStripe(r.x + 12, r.y + 14, r.w - 24, 12);
    },

    cafeteria(r, rand) {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      /* The table everyone spawns around, with the button on it. */
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      ctx.beginPath(); ctx.ellipse(cx, cy + 10, 96, 62, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#37455f';
      ctx.beginPath(); ctx.ellipse(cx, cy, 94, 58, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2b3648';
      ctx.beginPath(); ctx.ellipse(cx, cy - 4, 82, 48, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1c2434';
      ctx.beginPath(); ctx.ellipse(cx, cy - 4, 40, 24, 0, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const tx = cx + Math.cos(a) * 200, ty = cy + Math.sin(a) * 128;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(tx, ty + 7, 44, 30, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#33405a';
        ctx.beginPath(); ctx.ellipse(tx, ty, 42, 27, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3d4c6b';
        ctx.beginPath(); ctx.ellipse(tx, ty - 3, 34, 21, 0, 0, Math.PI * 2); ctx.fill();
      }
      viewport(r.x + 22, r.y + 16, 128, 58, rand);
      panel(r.x + r.w - 132, r.y + r.h - 58, 108, 40);
    },

    storage(r) {
      const tints = ['#3a4560', '#44507a', '#3f4a5f'];
      for (let i = 0; i < 5; i++) crate(r.x + 26 + (i % 3) * 52, r.y + 34 + Math.floor(i / 3) * 52, 44, tints[i % 3]);
      for (let i = 0; i < 3; i++) crate(r.x + r.w - 82, r.y + 130 + i * 46, 40, tints[(i + 1) % 3]);
      /* Fuel cans, which is where the long task starts. */
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = '#c0523f';
        rr(ctx, r.x + r.w - 76 + i * 22, r.y + 42, 17, 26, 3); ctx.fill();
        ctx.fillStyle = '#8e3a2c';
        rr(ctx, r.x + r.w - 73 + i * 22, r.y + 36, 11, 8, 2); ctx.fill();
      }
      hazardStripe(r.x + 16, r.y + r.h - 40, r.w - 32, 13);
    },

    admin(r) {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2 + 6;
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      rr(ctx, cx - 88, cy - 40, 176, 84, 10); ctx.fill();
      ctx.fillStyle = '#33405a';
      rr(ctx, cx - 90, cy - 46, 180, 84, 10); ctx.fill();
      ctx.fillStyle = '#0f1626';
      rr(ctx, cx - 80, cy - 38, 160, 68, 6); ctx.fill();
      /* The station's own floor plan, drawn from the real map. */
      ctx.save();
      rr(ctx, cx - 80, cy - 38, 160, 68, 6); ctx.clip();
      const sx = 150 / M.pixelWidth, sy = 60 / M.pixelHeight;
      ctx.fillStyle = 'rgba(55,224,200,0.5)';
      for (const room of M.ROOMS) {
        ctx.fillRect(cx - 75 + room.x * T * sx, cy - 33 + room.y * T * sy,
                     Math.max(2, room.w * T * sx), Math.max(2, room.h * T * sy));
      }
      ctx.restore();
      screen(r.x + 18, r.y + 22, 46, 36, '#4d9fd6');
    },

    weapons(r, rand) {
      viewport(r.x + 30, r.y + 18, r.w - 60, 62, rand);
      const cx = r.x + r.w / 2, cy = r.y + r.h - 62;
      ctx.fillStyle = '#33405a';
      rr(ctx, cx - 46, cy - 26, 92, 56, 10); ctx.fill();
      ctx.fillStyle = '#1c2434';
      rr(ctx, cx - 34, cy - 18, 68, 34, 6); ctx.fill();
      ctx.fillStyle = '#ff3f5b';
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,63,91,0.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2); ctx.stroke();
    },

    o2(r) {
      for (let i = 0; i < 2; i++) {
        const tx = r.x + 32 + i * 64, ty = r.y + 30;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        rr(ctx, tx - 2, ty + 6, 44, 104, 20); ctx.fill();
        ctx.fillStyle = '#2c3648';
        rr(ctx, tx, ty, 42, 102, 20); ctx.fill();
        ctx.fillStyle = 'rgba(55,224,200,0.22)';
        rr(ctx, tx + 7, ty + 12, 28, 80, 14); ctx.fill();
        ctx.fillStyle = '#4ca85c';
        for (let k = 0; k < 5; k++) {
          ctx.beginPath();
          ctx.ellipse(tx + 21 + (k - 2) * 6, ty + 66 - Math.abs(k - 2) * 9, 4.5, 13, (k - 2) * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      pipe(r.x + 18, r.y + r.h - 30, r.w - 36, false);
    },

    navigation(r, rand) {
      viewport(r.x + 22, r.y + 20, r.w - 44, 84, rand);
      screen(r.x + 24, r.y + r.h - 74, 74, 46, '#4d9fd6', 'wave');
      screen(r.x + r.w - 98, r.y + r.h - 74, 74, 46, '#37e0c8', 'bars');
      ctx.fillStyle = '#33405a';
      rr(ctx, r.x + r.w / 2 - 26, r.y + r.h - 66, 52, 30, 6); ctx.fill();
    },

    shields(r) {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2 + 4;
      for (let ring = 0; ring < 7; ring++) {
        const a = (ring / 7) * Math.PI * 2;
        const hx = ring === 6 ? cx : cx + Math.cos(a) * 62;
        const hy = ring === 6 ? cy : cy + Math.sin(a) * 46;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const ha = (i / 6) * Math.PI * 2 + Math.PI / 6;
          const vx = hx + Math.cos(ha) * 26, vy = hy + Math.sin(ha) * 26;
          if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(77,159,214,0.13)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(77,159,214,0.42)';
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }
      panel(r.x + 20, r.y + r.h - 50, 78, 32);
    },

    comms(r) {
      for (let i = 0; i < 4; i++) {
        const bx = r.x + 24 + i * 40;
        panel(bx, r.y + 26, 32, 96);
        ctx.fillStyle = '#37e0c8';
        ctx.globalAlpha = 0.55;
        for (let k = 0; k < 6; k++) ctx.fillRect(bx + 6, r.y + 34 + k * 14, 20 * (0.4 + ((i + k) % 3) / 3), 3);
        ctx.globalAlpha = 1;
      }
      const dx = r.x + r.w - 74, dy = r.y + 54;
      ctx.strokeStyle = '#8d97ad'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(dx, dy, 30, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
      ctx.fillStyle = 'rgba(141,151,173,0.16)';
      ctx.beginPath(); ctx.arc(dx, dy, 30, Math.PI * 0.75, Math.PI * 2.25); ctx.fill();
      ctx.strokeStyle = '#8d97ad'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx + 4, dy + 34); ctx.stroke();
    },
  };

  function engine(r, facing) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    rr(ctx, r.x + 24, cy - 52 + 6, r.w - 48, 104, 26); ctx.fill();
    ctx.fillStyle = '#2c3648';
    rr(ctx, r.x + 24, cy - 52, r.w - 48, 104, 26); ctx.fill();
    ctx.fillStyle = '#212a3c';
    rr(ctx, r.x + 40, cy - 36, r.w - 80, 72, 18); ctx.fill();
    const g = ctx.createLinearGradient(r.x + 40, 0, r.x + r.w - 40, 0);
    g.addColorStop(0, 'rgba(255,176,58,0.05)');
    g.addColorStop(0.5, 'rgba(255,176,58,0.42)');
    g.addColorStop(1, 'rgba(255,176,58,0.05)');
    ctx.fillStyle = g;
    rr(ctx, r.x + 48, cy - 18, r.w - 96, 36, 12); ctx.fill();
    ctx.strokeStyle = '#39435c'; ctx.lineWidth = 5;
    for (let i = 0; i < 4; i++) {
      const lx = r.x + 46 + i * ((r.w - 92) / 3);
      ctx.beginPath(); ctx.moveTo(lx, cy - 50); ctx.lineTo(lx, cy + 50); ctx.stroke();
    }
    pipe(r.x + 18, cy + facing * 62, r.w - 36, false);
    hazardStripe(r.x + 20, cy - facing * 66, r.w - 40, 12);
  }

  /* ---- fixtures ---------------------------------------------------------- */

  function taskConsole(spot, accent) {
    const w = M.toWorld(spot);
    panel(w.x - 21, w.y - 26, 42, 40);
    ctx.fillStyle = '#0d1320';
    rr(ctx, w.x - 16, w.y - 21, 32, 24, 3); ctx.fill();
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(w.x - 11, w.y - 16, 22, 3);
    ctx.fillRect(w.x - 11, w.y - 10, 14, 3);
    ctx.fillRect(w.x - 11, w.y - 4, 18, 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(w.x, w.y + 16, 22, 7, 0, 0, Math.PI * 2); ctx.fill();
  }

  function ventCover(spot) {
    const w = M.toWorld(spot);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    rr(ctx, w.x - 20, w.y - 12, 40, 30, 4); ctx.fill();
    ctx.fillStyle = '#39435c';
    rr(ctx, w.x - 21, w.y - 15, 42, 30, 4); ctx.fill();
    ctx.fillStyle = '#161d2c';
    rr(ctx, w.x - 16, w.y - 11, 32, 22, 3); ctx.fill();
    ctx.strokeStyle = '#4a5570'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(w.x - 12, w.y - 6 + i * 5); ctx.lineTo(w.x + 12, w.y - 6 + i * 5);
      ctx.stroke();
    }
  }

  function emergencyButton() {
    const w = M.toWorld(M.EMERGENCY);
    ctx.fillStyle = '#2c3648';
    rr(ctx, w.x - 22, w.y - 18, 44, 34, 8); ctx.fill();
    ctx.fillStyle = '#ff3f5b';
    ctx.beginPath(); ctx.arc(w.x, w.y - 4, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(w.x - 4, w.y - 8, 5, 3.4, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,63,91,0.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(w.x, w.y - 4, 19, 0, Math.PI * 2); ctx.stroke();
  }

  function sabotagePad(spot, accent) {
    const w = M.toWorld(spot);
    ctx.fillStyle = 'rgba(255,176,58,0.1)';
    rr(ctx, w.x - 26, w.y - 18, 52, 36, 6); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.55;
    rr(ctx, w.x - 26, w.y - 18, 52, 36, 6); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(w.x, w.y, 12, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* ---- labels ------------------------------------------------------------ */

  /* Letter spacing by hand: ctx.letterSpacing is too new to rely on, and
     these labels are wide-tracked on purpose -- it is what makes them read as
     signage painted on the floor rather than as a caption. */
  function tracked(text, cx, cy, size, spacing, colour, alpha) {
    ctx.font = '800 ' + size + 'px Archivo, "Archivo Black", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const widths = [];
    let total = 0;
    for (const ch of text) {
      const w = ctx.measureText(ch).width;
      widths.push(w);
      total += w + spacing;
    }
    total -= spacing;
    let x = cx - total / 2;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colour;
    let i = 0;
    for (const ch of text) {
      ctx.fillText(ch, x, cy);
      x += widths[i++] + spacing;
    }
    ctx.globalAlpha = 1;
  }

  /* ---- build ------------------------------------------------------------- */

  function build() {
    if (built) return canvas;
    canvas = document.createElement('canvas');
    canvas.width = M.pixelWidth;
    canvas.height = M.pixelHeight;
    ctx = canvas.getContext('2d');
    const rand = U.mulberry32(0x4a1b7);

    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    /* Stars first, so the hull covers the ones that would show through. */
    for (let i = 0; i < 1700; i++) {
      const x = rand() * canvas.width, y = rand() * canvas.height, v = rand();
      ctx.fillStyle = v > 0.94 ? 'rgba(215,228,245,0.85)'
        : v > 0.72 ? 'rgba(150,172,205,0.45)' : 'rgba(110,130,168,0.28)';
      const s = v > 0.94 ? 2 : 1.2;
      ctx.fillRect(x, y, s, s);
    }

    /* Hull: one solid tile around everything walkable. */
    ctx.fillStyle = HULL;
    for (let ty = 0; ty < M.H; ty++) {
      for (let tx = 0; tx < M.W; tx++) {
        if (M.FLOOR[M.at(tx, ty)]) continue;
        let touches = false;
        for (let dy = -1; dy <= 1 && !touches; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((!dx && !dy) || tx + dx < 0 || ty + dy < 0 || tx + dx >= M.W || ty + dy >= M.H) continue;
            if (M.FLOOR[M.at(tx + dx, ty + dy)]) { touches = true; break; }
          }
        }
        if (touches) ctx.fillRect(px(tx), px(ty), T, T);
      }
    }

    /* Floors. */
    for (let ty = 0; ty < M.H; ty++) {
      for (let tx = 0; tx < M.W; tx++) {
        if (!M.FLOOR[M.at(tx, ty)]) continue;
        const room = M.roomAt(px(tx) + T / 2, px(ty) + T / 2);
        const tone = room ? TONES[room.tone] : TONES.hall;
        ctx.fillStyle = tone.floor;
        ctx.fillRect(px(tx), px(ty), T, T);
        const v = rand();
        if (v > 0.88) { ctx.fillStyle = 'rgba(255,255,255,0.016)'; ctx.fillRect(px(tx), px(ty), T, T); }
        else if (v < 0.09) { ctx.fillStyle = 'rgba(0,0,0,0.11)'; ctx.fillRect(px(tx), px(ty), T, T); }
      }
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.032)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let ty = 0; ty < M.H; ty++) {
      for (let tx = 0; tx < M.W; tx++) {
        if (!M.FLOOR[M.at(tx, ty)]) continue;
        if (M.FLOOR[M.at(tx + 1, ty)]) { ctx.moveTo(px(tx + 1) + 0.5, px(ty)); ctx.lineTo(px(tx + 1) + 0.5, px(ty + 1)); }
        if (M.FLOOR[M.at(tx, ty + 1)]) { ctx.moveTo(px(tx), px(ty + 1) + 0.5); ctx.lineTo(px(tx + 1), px(ty + 1) + 0.5); }
      }
    }
    ctx.stroke();

    /* Room labels sit under the furniture so a console never has type on it. */
    for (const room of ROOMS_WITH_LABELS()) {
      tracked(room.name.toUpperCase(), room.cx, room.cy, room.w > 12 ? 30 : 22,
              room.w > 12 ? 11 : 7, TONES[room.tone].accent, 0.11);
    }

    for (const room of M.ROOMS) {
      const art = ROOM_ART[room.id];
      if (!art) continue;
      ctx.save();
      art({ x: px(room.x), y: px(room.y), w: px(room.w), h: px(room.h) }, rand);
      ctx.restore();
    }

    /* Wall faces last, over the furniture, so nothing bleeds into a corridor. */
    for (let ty = 0; ty < M.H; ty++) {
      for (let tx = 0; tx < M.W; tx++) {
        if (!M.FLOOR[M.at(tx, ty)]) continue;
        const x = px(tx), y = px(ty);
        if (!M.FLOOR[M.at(tx, ty - 1)]) {
          const g = ctx.createLinearGradient(0, y, 0, y + 14);
          g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(x, y, T, 14);
          ctx.fillStyle = KEYLINE; ctx.fillRect(x, y - 3, T, 4);
        }
        if (!M.FLOOR[M.at(tx, ty + 1)]) {
          const g = ctx.createLinearGradient(0, y + T, 0, y + T - 11);
          g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(x, y + T - 11, T, 11);
          ctx.fillStyle = '#121a28'; ctx.fillRect(x, y + T - 1, T, 4);
        }
        if (!M.FLOOR[M.at(tx - 1, ty)]) {
          const g = ctx.createLinearGradient(x, 0, x + 12, 0);
          g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(x, y, 12, T);
          ctx.fillStyle = HULL_EDGE; ctx.fillRect(x - 3, y, 4, T);
        }
        if (!M.FLOOR[M.at(tx + 1, ty)]) {
          const g = ctx.createLinearGradient(x + T, 0, x + T - 12, 0);
          g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(x + T - 12, y, 12, T);
          ctx.fillStyle = HULL_EDGE; ctx.fillRect(x + T - 1, y, 4, T);
        }
      }
    }

    for (const station of M.STATIONS) {
      const spots = station.steps || [station];
      for (const spot of spots) taskConsole(spot, TONES[M.roomById[spot.room].tone].accent);
    }
    for (const group of M.VENT_GROUPS) for (const v of group) ventCover(v);
    for (const key in M.SABOTAGE_SPOTS) {
      sabotagePad(M.SABOTAGE_SPOTS[key], key.indexOf('reactor') === 0 ? '#ffb03a' : '#37e0c8');
    }
    emergencyButton();

    built = true;
    return canvas;
  }

  function ROOMS_WITH_LABELS() { return M.ROOMS; }

  NS.station = {
    build,
    rebuild() { built = false; canvas = null; return build(); },
    get canvas() { return canvas; },
    TONES,
  };
})(window.NS);
