/* One frame.

   Order matters more than anything else in this file, because the darkness is
   not an effect painted over a finished picture -- it is what decides who is
   in the picture at all. The station is drawn, then the dark is laid over it,
   and only then are people drawn back in, clipped to what you can actually
   see. Drawing them first and dimming them afterwards would leave a smudge
   where somebody is standing in the next room, and a smudge is enough to win
   an argument you should have lost. */

(function (NS) {
  'use strict';

  const U = NS.util;
  const C = NS.config;
  const M = NS.map;
  const W = NS.world;

  const BASE_VISION = 215;
  const GROUND = '#05070d';
  /* Not fully opaque: three per cent of the station bleeds through the dark,
     which is enough to keep the walls readable as a memory of the map and far
     too little to make out a person. */
  const DARK_ALPHA = 0.968;

  let canvas = null, ctx = null;
  let dark = null, darkCtx = null;
  let cssW = 0, cssH = 0, dpr = 1;
  let scale = 1;
  const camera = { x: 0, y: 0, shake: 0, flash: 0, flashColour: '#ff3f5b' };

  /* The stylesheet honours prefers-reduced-motion, but a canvas is not styled.
     Screen shake is the one thing in here that can make somebody feel ill, so
     it asks the same question the CSS does. */
  let calm = false;
  try {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    calm = query.matches;
    if (query.addEventListener) query.addEventListener('change', (e) => { calm = e.matches; });
  } catch (e) { calm = false; }

  function attach(node) {
    canvas = node;
    ctx = canvas.getContext('2d');
    dark = document.createElement('canvas');
    darkCtx = dark.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, Math.round(rect.width));
    cssH = Math.max(1, Math.round(rect.height));
    /* Capped at 2: past that the extra pixels are invisible on a phone and
       the fill rate is not. */
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    dark.width = canvas.width;
    dark.height = canvas.height;

    /* How much station fits on screen. Held between 420 and 900 world pixels
       across so a phone is not playing a different game from a laptop: the
       laptop gets a wider view, but the people on it are the same size. */
    const visible = U.clamp(cssW * 0.62, 400, 780);
    scale = cssW / visible;
    const minHeight = 330;
    if (cssH / scale < minHeight) scale = cssH / minHeight;
  }

  function centreOn(x, y, snap) {
    if (snap) { camera.x = x; camera.y = y; return; }
    camera.x = x; camera.y = y;
  }

  function follow(target, dt) {
    if (!target) return;
    const k = Math.min(1, dt * 7);
    camera.x += (target.x - camera.x) * k;
    camera.y += (target.y - camera.y) * k;
  }

  const worldToScreen = (x, y) => ({
    x: (x - camera.x) * scale + cssW / 2,
    y: (y - camera.y) * scale + cssH / 2,
  });

  function visionRadius() {
    const me = W.me;
    if (!me) return BASE_VISION;
    const impostor = W.myRole && C.ROLES[W.myRole].team === 'impostor';
    const setting = impostor ? W.state.settings.impostorVision : W.state.settings.crewVision;
    return BASE_VISION * setting * NS.sabotage.visionScale(impostor);
  }

  function shake(amount) { camera.shake = Math.min(18, camera.shake + amount); }
  function flash(colour, amount) { camera.flash = amount; camera.flashColour = colour; }

  /* ---- pieces ------------------------------------------------------------ */

  /* Vent covers, thrown open for half a second. Without it somebody simply
     stops existing where they were standing, and the one thing a vent has to
     communicate is that this is how they left. */
  const ventFlashes = [];
  function ventOpened(x, y) {
    ventFlashes.push({ x, y, life: 0.55 });
    if (ventFlashes.length > 6) ventFlashes.shift();
  }

  function drawVents(dt) {
    for (let i = ventFlashes.length - 1; i >= 0; i--) {
      const v = ventFlashes[i];
      v.life -= dt;
      if (v.life <= 0) { ventFlashes.splice(i, 1); continue; }
      const t = 1 - v.life / 0.55;
      const lid = Math.sin(Math.min(1, t * 1.6) * Math.PI) * 26;
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.fillStyle = '#0a0f1a';
      NS.characters.rr(ctx, -16, -11, 32, 22, 3);
      ctx.fill();
      ctx.fillStyle = '#4a5570';
      NS.characters.rr(ctx, -21, -15 - lid, 42, 8, 3);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawDoors(now) {
    const closed = W.state.closedRooms || [];
    if (!closed.length) return;
    const at = W.state.doorAt || {};
    for (const roomId of closed) {
      const doors = M.DOORS[roomId];
      if (!doors) continue;
      /* Slid shut over a quarter of a second rather than appearing: a barrier
         that pops into existence reads as a rendering glitch, and you need to
         see which way it came from to know you have been shut in. */
      const age = at[roomId] ? Math.min(1, (now - at[roomId]) / 260) : 1;
      const slide = 1 - Math.pow(1 - age, 3);
      for (const d of doors) {
        const fullW = d.w * M.TILE, fullH = d.h * M.TILE;
        const horizontal = fullW > fullH;
        const x = d.x * M.TILE + (horizontal ? 0 : (fullW * (1 - slide)) / 2);
        const y = d.y * M.TILE + (horizontal ? (fullH * (1 - slide)) / 2 : 0);
        const w = horizontal ? fullW : fullW * slide;
        const h = horizontal ? fullH * slide : fullH;
        ctx.fillStyle = '#c0523f';
        NS.characters.rr(ctx, x + 1, y + 1, w - 2, h - 2, 4);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let i = 0; i < Math.max(w, h); i += 18) {
          if (w > h) ctx.fillRect(x + i, y, 8, h);
          else ctx.fillRect(x, y + i, w, 8);
        }
        ctx.strokeStyle = '#ffb03a';
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.5 + Math.sin(now * 0.006) * 0.3;
        NS.characters.rr(ctx, x + 1, y + 1, w - 2, h - 2, 4);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  /* A ring under every console you still owe, so a task list is something you
     can follow with your feet rather than something you have to memorise. */
  function drawObjectives(now) {
    if (W.state.phase !== 'play') return;
    if (NS.sabotage.commsDown()) return;
    ctx.save();
    for (const task of W.myTasks) {
      if (task.done) continue;
      const spot = W.taskSpot(task);
      if (!spot) continue;
      const pulse = 0.55 + Math.sin(now * 0.004 + spot.x) * 0.25;
      ctx.strokeStyle = 'rgba(255,176,58,' + pulse.toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(spot.x, spot.y + 14, 26, 11, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,176,58,0.12)';
      ctx.fill();
    }
    const active = W.state.sabotage;
    if (active) {
      for (const spot of NS.sabotage.activeSpots()) {
        if (spot.done) continue;
        ctx.strokeStyle = 'rgba(255,63,91,' + (0.5 + Math.sin(now * 0.008) * 0.3).toFixed(3) + ')';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(spot.x, spot.y + 12, 30, 13, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* Every camera blinks while anybody is at the console in Security. It is the
     impostor's only warning, and it has to be visible from across a room, so
     it is a hard on/off rather than a fade. */
  function drawCameraLights(now) {
    if (!W.state.cameras) return;
    const on = Math.floor(now / 520) % 2 === 0;
    if (!on) return;
    for (const camera of M.CAMERAS) {
      const w = M.toWorld(camera);
      ctx.fillStyle = '#ff3f5b';
      ctx.beginPath();
      ctx.arc(w.x, w.y - 10, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,63,91,0.3)';
      ctx.beginPath();
      ctx.arc(w.x, w.y - 10, 8.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function nameTag(p, alpha) {
    const label = p.name;
    ctx.font = '700 13px Archivo, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width + 14;
    const y = p.y - NS.characters.BODY_H - 26;
    ctx.globalAlpha = alpha * 0.72;
    ctx.fillStyle = 'rgba(5,7,13,0.72)';
    NS.characters.rr(ctx, p.x - w / 2, y - 9, w, 18, 9);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.ghost ? '#9d8cff' : '#e6ecf6';
    ctx.fillText(label, p.x, y);
    ctx.globalAlpha = 1;
  }

  /* Who is drawn, and how brightly. A body at the very edge of the light
     fades rather than popping, which is the difference between "somebody is
     there" and "somebody appeared". */
  function alphaFor(x, y, radius, meGhost) {
    if (meGhost) return 1;
    const me = W.me;
    if (!me) return 1;
    const d = U.dist(me.x, me.y, x, y);
    if (d > radius) return 0;
    if (!NS.los.clear(me.x, me.y, x, y)) return 0;
    const fade = radius * 0.72;
    return d <= fade ? 1 : 1 - (d - fade) / (radius - fade);
  }

  function drawScene(now, dt) {
    const me = W.me;
    const meGhost = !!(me && me.ghost);
    const radius = visionRadius();
    const station = NS.station.canvas;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, cssW, cssH);

    let shakeX = 0, shakeY = 0;
    if (camera.shake > 0.1 && !calm) {
      shakeX = (Math.random() - 0.5) * camera.shake;
      shakeY = (Math.random() - 0.5) * camera.shake;
    }
    if (camera.shake > 0.1) camera.shake *= Math.pow(0.0016, dt);

    ctx.save();
    ctx.translate(cssW / 2 + shakeX, cssH / 2 + shakeY);
    ctx.scale(scale, scale);
    ctx.translate(-camera.x, -camera.y);

    /* Only the visible slice of the station is blitted. */
    const halfW = cssW / (2 * scale) + 64;
    const halfH = cssH / (2 * scale) + 64;
    const sx = U.clamp(camera.x - halfW, 0, M.pixelWidth);
    const sy = U.clamp(camera.y - halfH, 0, M.pixelHeight);
    const sw = U.clamp(halfW * 2, 1, M.pixelWidth - sx);
    const sh = U.clamp(halfH * 2, 1, M.pixelHeight - sy);
    if (station) {
      const k = NS.station.scale;
      ctx.drawImage(station, sx * k, sy * k, sw * k, sh * k, sx, sy, sw, sh);
    }

    drawObjectives(now);
    drawDoors(now);
    drawCameraLights(now);
    drawVents(dt);
    NS.fx.drawVisuals(ctx);

    ctx.restore();

    /* ---- the dark ------------------------------------------------------- */

    if (!meGhost && me && W.state.phase !== 'lobby') {
      darkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      darkCtx.clearRect(0, 0, cssW, cssH);
      darkCtx.fillStyle = 'rgba(5,7,13,' + DARK_ALPHA + ')';
      darkCtx.fillRect(0, 0, cssW, cssH);

      const poly = NS.los.visible(me.x, me.y, radius);
      darkCtx.save();
      darkCtx.translate(cssW / 2 + shakeX, cssH / 2 + shakeY);
      darkCtx.scale(scale, scale);
      darkCtx.translate(-camera.x, -camera.y);
      darkCtx.beginPath();
      darkCtx.moveTo(poly[0], poly[1]);
      for (let i = 1; i < NS.los.RAYS; i++) darkCtx.lineTo(poly[i * 2], poly[i * 2 + 1]);
      darkCtx.closePath();
      darkCtx.clip();
      const g = darkCtx.createRadialGradient(me.x, me.y, radius * 0.2, me.x, me.y, radius);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.72, 'rgba(0,0,0,0.98)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      darkCtx.globalCompositeOperation = 'destination-out';
      darkCtx.fillStyle = g;
      darkCtx.fillRect(me.x - radius, me.y - radius, radius * 2, radius * 2);
      darkCtx.restore();
      darkCtx.globalCompositeOperation = 'source-over';

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(dark, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /* ---- people, back on top, clipped to what is lit -------------------- */

    ctx.save();
    ctx.translate(cssW / 2 + shakeX, cssH / 2 + shakeY);
    ctx.scale(scale, scale);
    ctx.translate(-camera.x, -camera.y);

    const drawable = [];
    for (const body of W.bodies) {
      const a = alphaFor(body.x, body.y, radius, meGhost);
      if (a > 0.02) drawable.push({ y: body.y, body, alpha: a });
    }
    const impostorTeam = W.myRole && C.ROLES[W.myRole].team === 'impostor';
    for (const p of W.players.values()) {
      if (p.inVent) continue;
      /* The dead are a room only the dead are in. */
      if (p.ghost && !meGhost && !p.isMe) continue;
      if (p.isMe) { drawable.push({ y: p.y, player: p, alpha: 1 }); continue; }
      if (!p.connected) continue;
      const a = alphaFor(p.x, p.y, radius, meGhost);
      if (a <= 0.02) continue;
      if (p.invisible && !(impostorTeam || meGhost)) continue;
      drawable.push({ y: p.y, player: p, alpha: a });
    }
    drawable.sort((a, b) => a.y - b.y);

    for (const item of drawable) {
      if (item.body) { ctx.globalAlpha = item.alpha; NS.characters.drawBody(ctx, item.body); ctx.globalAlpha = 1; continue; }
      const p = item.player;
      let outline = null;
      if (impostorTeam && !p.isMe && W.state.roles && C.ROLES[W.state.roles[p.id] || 'crewmate'].team === 'impostor') {
        outline = 'rgba(255,63,91,0.85)';
      }
      NS.characters.drawPlayer(ctx, p, { alpha: item.alpha, outline });
    }
    for (const item of drawable) {
      if (item.player && item.alpha > 0.25) nameTag(item.player, item.alpha);
    }

    NS.fx.draw(ctx);
    NS.fx.drawFloaters(ctx);
    ctx.restore();

    if (camera.flash > 0.01) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = Math.min(0.85, camera.flash);
      ctx.fillStyle = camera.flashColour;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.globalAlpha = 1;
      camera.flash *= Math.pow(0.004, dt);
    }

    drawEdgePointers();
  }

  /* Off-screen things you are meant to walk to: a chevron on the edge of the
     screen for the live sabotage. Only for the sabotage -- doing it for every
     task turns the border into a light show and stops meaning anything. */
  function drawEdgePointers() {
    const active = W.state.sabotage;
    if (!active || !W.me || W.me.ghost) return;
    const def = NS.sabotage.SABOTAGES[active.kind];
    if (!def || !def.fix) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const margin = 34;
    for (const spot of NS.sabotage.activeSpots()) {
      if (spot.done) continue;
      const s = worldToScreen(spot.x, spot.y);
      if (s.x > margin && s.x < cssW - margin && s.y > margin && s.y < cssH - margin) continue;
      const cx = cssW / 2, cy = cssH / 2;
      const a = Math.atan2(s.y - cy, s.x - cx);
      const rx = Math.min(cssW / 2 - margin, cssH / 2 - margin);
      const px = cx + Math.cos(a) * rx;
      const py = cy + Math.sin(a) * rx;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      ctx.fillStyle = '#ff3f5b';
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /* Draw straight onto the finished frame in screen space. The cinematics use
     it, and nothing else should: anything that belongs in the world belongs in
     drawScene where the darkness can reach it. */
  function drawOverlay(fn) {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fn(ctx, cssW, cssH);
  }

  NS.render = {
    attach, resize, drawScene, follow, centreOn, worldToScreen, shake, flash, ventOpened, drawOverlay,
    visionRadius,
    get scale() { return scale; },
    get width() { return cssW; },
    get height() { return cssH; },
    camera,
  };
})(window.NS);
