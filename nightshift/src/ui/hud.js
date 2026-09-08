/* Everything drawn over the station.

   Two constraints shaped all of it. It is played on phones, so the controls
   live in the bottom corners where thumbs already are and nothing important
   sits under a notch. And it is played by people who have never seen it
   before, at a table, being talked over -- so every button says what it does
   in words rather than relying on an icon anyone has to learn. */

(function (NS) {
  'use strict';

  const U = NS.util;
  const C = NS.config;
  const M = NS.map;
  const W = NS.world;
  const el = U.el;

  let send = function () {};
  let onLeave = function () {};

  const nodes = {};
  const cooldown = { kill: 0, ability: 0, sabotage: 0, emergency: 0 };
  let emergenciesLeft = 0;
  let abilitySpent = false;
  let overlay = null;

  function init(opts) {
    send = opts.send;
    onLeave = opts.onLeave || function () {};
    build();
  }

  /* ---- structure --------------------------------------------------------- */

  function actionButton(id, label, kind) {
    const btn = el('button', {
      class: 'act act--' + kind, type: 'button', id: 'act-' + id, hidden: true,
    }, [
      el('span', { class: 'act-ring' }),
      el('span', { class: 'act-label', text: label }),
    ]);
    nodes[id] = btn;
    return btn;
  }

  function build() {
    const host = el('div', { class: 'hud' });

    nodes.taskbar = el('div', { class: 'taskbar' }, [
      el('div', { class: 'taskbar-track' }, [el('i')]),
      el('span', { class: 'taskbar-label', text: 'Tasks' }),
    ]);

    nodes.alert = el('div', { class: 'alert', hidden: true }, [
      el('strong', { class: 'alert-title', text: '' }),
      el('span', { class: 'alert-body', text: '' }),
      el('span', { class: 'alert-clock', text: '' }),
    ]);

    nodes.topRight = el('div', { class: 'hud-tools' }, [
      toolButton('tasks', 'Tasks', () => showTasks()),
      toolButton('map', 'Map', () => showMap(false)),
      toolButton('sound', NS.audio.muted ? 'Sound off' : 'Sound on', toggleSound),
      toolButton('chat', 'Ghost chat', showGhostChat),
      toolButton('gear', 'Options', showOptions),
      toolButton('close', 'Leave', async () => {
        if (await NS.bits.confirm({
          title: 'Leave the round?',
          body: 'You will not be able to rejoin until the next one starts.',
          confirm: 'Leave', danger: true,
        })) onLeave();
      }),
    ]);

    nodes.actions = el('div', { class: 'actions' }, [
      actionButton('sabotage', 'Sabotage', 'small'),
      actionButton('vent', 'Vent', 'small'),
      actionButton('ability', 'Ability', 'small'),
      actionButton('report', 'Report', 'report'),
      actionButton('kill', 'Kill', 'kill'),
      actionButton('use', 'Use', 'use'),
    ]);

    nodes.stick = el('div', { class: 'stick', hidden: true }, [
      el('span', { class: 'stick-base' }),
      el('span', { class: 'stick-knob' }),
    ]);

    nodes.roleTag = el('div', { class: 'role-tag', hidden: true }, [
      el('span', { class: 'role-tag-name', text: '' }),
      el('span', { class: 'role-tag-team', text: '' }),
    ]);

    host.appendChild(nodes.taskbar);
    host.appendChild(nodes.alert);
    host.appendChild(nodes.topRight);
    host.appendChild(nodes.roleTag);
    host.appendChild(nodes.actions);
    host.appendChild(nodes.stick);
    document.body.appendChild(host);
    nodes.host = host;

    for (const id of ['use', 'report', 'kill', 'vent', 'sabotage', 'ability']) {
      nodes[id].addEventListener('click', () => press(id));
    }
  }

  function toolButton(icon, label, fn) {
    const btn = el('button', { class: 'tool', type: 'button', 'aria-label': label, title: label, onclick: fn });
    btn.appendChild(NS.bits.icon(icon, 20));
    nodes['tool_' + icon] = btn;
    return btn;
  }

  function toggleSound() {
    NS.audio.wake();
    NS.audio.setMuted(!NS.audio.muted);
    const btn = nodes.tool_sound;
    btn.textContent = '';
    btn.appendChild(NS.bits.icon(NS.audio.muted ? 'mute' : 'sound', 20));
    btn.setAttribute('aria-label', NS.audio.muted ? 'Sound off' : 'Sound on');
  }

  /* ---- pressing things --------------------------------------------------- */

  const context = () => W.context();

  function press(id) {
    NS.audio.wake();
    const ctx = context();
    if (id === 'use') {
      if (ctx.sabotageFix) return openFix(ctx.sabotageFix);
      if (ctx.use && ctx.use.kind === 'task') return openTask(ctx.use);
      if (ctx.use && ctx.use.kind === 'console') return openConsole(ctx.use.console);
      if (ctx.emergency) return callEmergency();
      return;
    }
    if (id === 'report' && ctx.report) {
      send('act', { t: 'report', body: ctx.report.id });
      NS.audio.play('report');
      return;
    }
    if (id === 'kill' && ctx.kill && cooldown.kill <= 0) {
      send('act', { t: 'kill', target: ctx.kill.id });
      /* Predicted locally from the same rule the host uses. If the host
         refuses, no kill event comes back and the button is still live -- the
         cooldown only really starts when the kill is confirmed. */
      return;
    }
    if (id === 'vent' && ctx.vent) {
      if (ctx.vent.kind === 'enter') {
        W.me.inVent = true;
        W.me.x = W.me.tx = ctx.vent.x;
        W.me.y = W.me.ty = ctx.vent.y;
        W.me.ventGroup = ctx.vent.group;
        W.me.ventIndex = ctx.vent.index;
        send('act', { t: 'vent', a: 'in', g: ctx.vent.group, i: ctx.vent.index });
        NS.fx.vent(ctx.vent.x, ctx.vent.y);
        NS.audio.play('vent');
      } else {
        W.me.inVent = false;
        send('act', { t: 'vent', a: 'out', g: W.me.ventGroup, i: W.me.ventIndex });
        NS.fx.vent(W.me.x, W.me.y);
        NS.audio.play('vent');
      }
      return;
    }
    if (id === 'sabotage') return showMap(true);
    if (id === 'ability') return useAbility();
  }

  function callEmergency() {
    NS.bits.confirm({
      title: 'Call everyone in?',
      body: emergenciesLeft + ' left for the whole round.',
      confirm: 'Call the meeting',
    }).then((yes) => {
      if (yes) { send('act', { t: 'emergency' }); NS.audio.play('report'); }
    });
  }

  function openTask(use) {
    W.frozen = true;
    NS.minigames.start(use.station.kind, {
      station: use.station,
      step: use.task.step,
      onDone() {
        W.frozen = false;
        send('act', { t: 'task', sid: use.task.sid, step: use.task.step });
        NS.fx.task(W.me.x, W.me.y);
        NS.fx.say(W.me.x, W.me.y - 46, 'Done', '#34e0b8');
      },
      onClose() { W.frozen = false; },
    });
  }

  function openFix(fix) {
    const kind = fix.def.fix;
    W.frozen = true;
    const spec = kind === 'switches' ? 'lightsFix'
      : kind === 'code' ? 'codeFix'
      : kind === 'tune' ? 'tuneFix' : 'padFix';
    NS.minigames.start(spec, {
      title: fix.def.name,
      onHold: kind === 'hold' ? (on) => send('act', { t: 'fix', i: fix.index, on: on }) : null,
      onDone() {
        W.frozen = false;
        if (kind !== 'hold') send('act', { t: 'fix', i: fix.index, on: true });
      },
      onClose() {
        W.frozen = false;
        if (kind === 'hold') send('act', { t: 'fix', i: fix.index, on: false });
      },
    });
  }

  /* ---- role abilities ---------------------------------------------------- */

  function abilityInfo() {
    const role = C.ROLES[W.myRole || 'crewmate'];
    if (!role.ability) return null;
    const map = {
      shoot: { label: 'Shoot', needsTarget: true },
      shield: { label: 'Shield', needsTarget: true, once: true },
      vitals: { label: 'Vitals', needsTarget: false },
      trail: { label: 'Read trail', needsTarget: false },
      vanish: { label: 'Vanish', needsTarget: false },
      shift: { label: 'Shapeshift', needsTarget: true },
      vent: null,
    };
    const info = map[role.ability];
    return info ? Object.assign({ kind: role.ability }, info) : null;
  }

  function nearestLiving(range) {
    const me = W.me;
    let best = null, bestD = (range || 130) * (range || 130);
    for (const p of W.players.values()) {
      if (p.isMe || !p.alive || p.ghost || p.inVent || !p.connected) continue;
      const d = U.dist2(me.x, me.y, p.x, p.y);
      if (d < bestD && NS.los.clear(me.x, me.y, p.x, p.y)) { bestD = d; best = p; }
    }
    return best;
  }

  function useAbility() {
    const info = abilityInfo();
    if (!info) return;
    if (info.kind === 'vitals') return showVitals();
    if (info.kind === 'trail') return readTrail();
    if (cooldown.ability > 0) return;
    if (info.kind === 'shoot') {
      const target = nearestLiving(C.KILL_RANGE.Long);
      if (!target) { NS.bits.toast('Nobody in your sights.', 'warn'); return; }
      NS.bits.confirm({
        title: 'Shoot ' + target.name + '?',
        body: 'If they are not an impostor, you die instead.',
        confirm: 'Shoot', danger: true,
      }).then((yes) => { if (yes) send('act', { t: 'shoot' }); });
      return;
    }
    if (info.kind === 'shield') {
      if (abilitySpent) return;
      const target = nearestLiving(140);
      if (!target) { NS.bits.toast('Stand closer to whoever you want to protect.', 'warn'); return; }
      NS.bits.confirm({
        title: 'Shield ' + target.name + '?',
        body: 'One player, once, for the whole round.',
        confirm: 'Shield them',
      }).then((yes) => { if (yes) send('act', { t: 'shield', target: target.id }); });
      return;
    }
    if (info.kind === 'vanish') { send('act', { t: 'ability', k: 'vanish' }); return; }
    if (info.kind === 'shift') {
      const target = nearestLiving(140);
      if (!target) { NS.bits.toast('Get closer to whoever you want to become.', 'warn'); return; }
      send('act', { t: 'ability', k: 'shift', target: target.id });
    }
  }

  function readTrail() {
    const body = W.nearestBody();
    if (!body) { NS.bits.toast('Stand over a body to read the trail.', 'warn'); return; }
    const room = M.roomAt(body.x, body.y);
    const dir = body.facing > 0 ? 'east' : body.facing < 0 ? 'west' : 'nowhere obvious';
    NS.bits.toast('The trail leaves ' + (room ? room.name : 'here') + ' heading ' + dir + '.', 'info', 6);
  }

  /* ---- overlays ---------------------------------------------------------- */

  function closeOverlay() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    W.frozen = false;
    if (overlayLoop) { cancelAnimationFrame(overlayLoop); overlayLoop = null; }
    if (overlayClose) { const fn = overlayClose; overlayClose = null; fn(); }
  }

  function shell(title, sub) {
    closeOverlay();
    const root = el('div', { class: 'sheet sheet--panel', role: 'dialog', 'aria-modal': 'true' });
    const box = el('div', { class: 'sheet-box sheet-box--wide' });
    box.appendChild(el('header', { class: 'sheet-head' }, [
      el('div', {}, [el('h3', { text: title }), sub ? el('p', { text: sub }) : null]),
      el('button', { class: 'tool', type: 'button', 'aria-label': 'Close', onclick: closeOverlay },
        [NS.bits.icon('close', 20)]),
    ]));
    root.appendChild(box);
    root.addEventListener('click', (e) => { if (e.target === root) closeOverlay(); });
    document.body.appendChild(root);
    overlay = root;
    W.frozen = true;
    return box;
  }

  /* Everything in this room runs on the station's own network, which is what
     the comms sabotage cuts. Refusing with the reason is the point: a crew
     that finds the cameras dark should know why, because that is information. */
  function openConsole(console) {
    if (NS.sabotage.commsDown()) {
      NS.bits.toast('Comms are down, so ' + console.name.toLowerCase() + ' is dead until they are fixed.', 'warn', 5);
      return;
    }
    if (console.kind === 'admin') return showAdmin();
    if (console.kind === 'cameras') return showCameras();
    if (console.kind === 'vitals') return showVitals();
  }

  /* A map with a head count per room, and nothing else. It cannot tell you who
     is where, which is exactly why it is worth arguing about: four people in
     Electrical and one of them walks out is a fact, and who walked out is not. */
  function showAdmin() {
    const box = shell('Admin table', 'Counts only. It cannot tell you who.');
    const wrap = el('div', { class: 'map-wrap' });
    const canvas = el('canvas', { class: 'map-canvas' });
    wrap.appendChild(canvas);
    box.appendChild(wrap);
    box.appendChild(el('p', { class: 'sheet-note', text: 'The dead are not counted.' }));
    const ctx = canvas.getContext('2d');

    live(canvas, () => {
      const place = fitMap(canvas, wrap, ctx);
      paintRooms(ctx, { labels: false });
      ctx.restore();

      const counts = {};
      for (const p of W.players.values()) {
        if (!p.alive || p.ghost || !p.connected || p.inVent) continue;
        const room = M.roomAt(p.x, p.y);
        if (room) counts[room.id] = (counts[room.id] || 0) + 1;
      }
      /* Labels are drawn after the map transform is undone, so they are the
         same readable size on a phone and a projector rather than scaling with
         the station. */
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const room of M.ROOMS) {
        const n = counts[room.id] || 0;
        const x = place.ox + room.cx * place.scale;
        const y = place.oy + room.cy * place.scale;
        ctx.fillStyle = 'rgba(207,217,232,0.6)';
        ctx.font = '700 11px Archivo, system-ui, sans-serif';
        ctx.fillText(room.name, x, y - 13);
        ctx.fillStyle = n ? '#ffb03a' : 'rgba(141,154,177,0.35)';
        ctx.font = '800 ' + (n ? 26 : 17) + 'px Archivo, system-ui, sans-serif';
        ctx.fillText(String(n), x, y + 8);
      }
    });
  }

  /* Four corridors, live, and every camera on the station blinks while
     somebody is here. That tell is the whole reason this is fair -- an
     impostor who checks the housing knows whether they are being watched. */
  function showCameras() {
    const box = shell('Cameras', 'Four corridors. Everyone can see that you are watching.');
    const grid = el('div', { class: 'cams' });
    const feeds = M.CAMERAS.map((camera) => {
      const cell = el('div', { class: 'cam' });
      const canvas = el('canvas', { class: 'cam-canvas' });
      cell.appendChild(canvas);
      cell.appendChild(el('span', { class: 'cam-name', text: camera.name }));
      cell.appendChild(el('span', { class: 'cam-live', text: 'LIVE' }));
      grid.appendChild(cell);
      return { camera, canvas, ctx: canvas.getContext('2d') };
    });
    box.appendChild(grid);

    const alive = W.me && W.me.alive && !W.me.ghost;
    if (alive) send('act', { t: 'watching', on: true });
    onOverlayClose(() => { if (alive) send('act', { t: 'watching', on: false }); });

    /* Four station blits plus every character, four times a frame, is more
       than a phone should spend on a picture that is mostly a corridor. Twenty
       a second is smooth enough to follow somebody walking and a third of the
       work. */
    let last = 0;
    live(feeds[0].canvas, () => {
      const now = U.now();
      if (now - last < 48) return;
      last = now;
      for (const feed of feeds) paintFeed(feed);
    });
  }

  const FEED_W = 300, FEED_H = 190;

  function paintFeed(feed) {
    const { camera, canvas, ctx } = feed;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(80, rect.width), h = Math.max(50, rect.height);
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, w, h);

    const look = M.toWorld(camera.look);
    const scale = (w / FEED_W) * camera.zoom * 1.6;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-look.x, -look.y);

    const station = NS.station.canvas;
    if (station) {
      const halfW = w / (2 * scale) + 40, halfH = h / (2 * scale) + 40;
      const sx = U.clamp(look.x - halfW, 0, M.pixelWidth);
      const sy = U.clamp(look.y - halfH, 0, M.pixelHeight);
      const sw = U.clamp(halfW * 2, 1, M.pixelWidth - sx);
      const sh = U.clamp(halfH * 2, 1, M.pixelHeight - sy);
      const k = NS.station.scale;
      ctx.drawImage(station, sx * k, sy * k, sw * k, sh * k, sx, sy, sw, sh);
    }
    for (const body of W.bodies) {
      if (Math.abs(body.x - look.x) > 700 || Math.abs(body.y - look.y) > 500) continue;
      NS.characters.drawBody(ctx, body);
    }
    const seen = [];
    for (const p of W.players.values()) {
      if (!p.connected || p.ghost || p.inVent || p.invisible) continue;
      if (Math.abs(p.x - look.x) > 700 || Math.abs(p.y - look.y) > 500) continue;
      seen.push(p);
    }
    seen.sort((a, b) => a.y - b.y);
    for (const p of seen) NS.characters.drawPlayer(ctx, p, {});
    ctx.restore();

    /* A cheap tube: scanlines, a green cast and a soft edge. It reads as a
       feed rather than as a second window onto the game, which matters --
       looking at cameras should feel like looking at cameras. */
    ctx.fillStyle = 'rgba(52,224,184,0.05)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.85);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }

  /* ---- panel plumbing ----------------------------------------------------- */

  let overlayLoop = null;
  let overlayClose = null;

  function onOverlayClose(fn) { overlayClose = fn; }

  /* Runs a paint function every frame for as long as the panel is on screen,
     and stops the moment it is not -- a camera feed left running behind a
     closed panel is a phone getting warm for nothing. */
  function live(canvas, paint) {
    cancelAnimationFrame(overlayLoop);
    function tick() {
      if (!overlay || !document.body.contains(canvas)) { overlayLoop = null; return; }
      paint();
      overlayLoop = requestAnimationFrame(tick);
    }
    overlayLoop = requestAnimationFrame(tick);
  }

  function fitMap(canvas, wrap, ctx) {
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pad = 10;
    const scale = Math.min((rect.width - pad * 2) / M.pixelWidth, (rect.height - pad * 2) / M.pixelHeight);
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const ox = (rect.width - M.pixelWidth * scale) / 2;
    const oy = (rect.height - M.pixelHeight * scale) / 2;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    return { ox, oy, scale };
  }

  function paintRooms(ctx, opts) {
    const o = opts || {};
    for (const hall of M.HALLS) {
      ctx.fillStyle = 'rgba(44,54,72,0.55)';
      ctx.fillRect(hall.x * M.TILE, hall.y * M.TILE, hall.w * M.TILE, hall.h * M.TILE);
    }
    for (const room of M.ROOMS) {
      const sealed = (W.state.closedRooms || []).indexOf(room.id) >= 0;
      ctx.fillStyle = sealed ? 'rgba(192,82,63,0.4)' : 'rgba(44,54,72,0.85)';
      ctx.fillRect(room.x * M.TILE, room.y * M.TILE, room.w * M.TILE, room.h * M.TILE);
      ctx.strokeStyle = sealed ? '#ff3f5b' : '#3a4761';
      ctx.lineWidth = 4;
      ctx.strokeRect(room.x * M.TILE, room.y * M.TILE, room.w * M.TILE, room.h * M.TILE);
      if (o.labels === false) continue;
      ctx.fillStyle = 'rgba(207,217,232,0.72)';
      ctx.font = '700 34px Archivo, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(room.name, room.cx, room.cy);
    }
  }

  /* Personal, not a game setting: nobody else is affected by how loud your
     phone is or whether you need the shapes, so these are kept on the device
     and are changeable mid-round rather than locked to the lobby. */
  function showOptions() {
    const box = shell('Options', 'Yours alone. Nobody else in the game is affected.');
    const list = el('div', { class: 'options' });

    const volume = el('input', {
      class: 'slider', type: 'range', min: '0', max: '100', step: '5',
      value: String(Math.round(NS.audio.volume * 100)), 'aria-label': 'Volume',
      oninput: (e) => { NS.audio.wake(); NS.audio.setVolume(Number(e.target.value) / 100); },
    });
    list.appendChild(el('div', { class: 'setting' }, [
      el('label', { class: 'setting-name', text: 'Volume' }),
      el('div', { class: 'slider-row' }, [volume, el('output', { class: 'setting-value', text: 'sound' })]),
    ]));

    const mute = el('button', {
      class: 'toggle' + (NS.audio.muted ? '' : ' is-on'), type: 'button', role: 'switch',
      'aria-checked': String(!NS.audio.muted), text: NS.audio.muted ? 'Off' : 'On',
      onclick: () => {
        toggleSound();
        mute.classList.toggle('is-on', !NS.audio.muted);
        mute.setAttribute('aria-checked', String(!NS.audio.muted));
        mute.textContent = NS.audio.muted ? 'Off' : 'On';
      },
    });
    list.appendChild(el('div', { class: 'setting' }, [
      el('label', { class: 'setting-name', text: 'Sound' }), mute,
    ]));

    const on = !!U.store.get('symbols', false);
    const symbols = el('button', {
      class: 'toggle' + (on ? ' is-on' : ''), type: 'button', role: 'switch',
      'aria-checked': String(on), text: on ? 'On' : 'Off',
      onclick: () => {
        const next = !U.store.get('symbols', false);
        U.store.set('symbols', next);
        NS.characters.setSymbols(next);
        symbols.classList.toggle('is-on', next);
        symbols.setAttribute('aria-checked', String(next));
        symbols.textContent = next ? 'On' : 'Off';
        preview.textContent = '';
        preview.appendChild(NS.bits.avatar(W.me ? W.me.colorIdx : 0, W.me ? W.me.hatIdx : 0, 74));
      },
    });
    const preview = el('div', { class: 'options-preview' }, [
      NS.bits.avatar(W.me ? W.me.colorIdx : 0, W.me ? W.me.hatIdx : 0, 74),
    ]);
    list.appendChild(el('div', { class: 'setting' }, [
      el('label', { class: 'setting-name', text: 'Shapes on suits' }),
      symbols,
      el('p', { class: 'setting-hint', text: 'A different shape per colour, so colour is never the only way to tell two people apart.' }),
      preview,
    ]));

    list.appendChild(el('p', {
      class: 'setting-hint',
      text: 'Motion is already reduced automatically if your device asks for it.',
    }));
    box.appendChild(list);
  }

  /* Where the dead talk. The conversation exists whether or not there is a
     meeting on, and before this there was nowhere to read it outside one --
     so being killed meant being cut off from the only thing left to do. */
  function showGhostChat() {
    const box = shell('The dead', 'Only ghosts can read this.');
    const log = el('div', { class: 'chat-log', 'aria-live': 'polite', 'aria-label': 'Ghost chat' });
    for (const msg of NS.meeting.history) log.appendChild(NS.meeting.renderRow(msg));
    const input = el('input', {
      class: 'chat-input', type: 'text', maxlength: '120',
      placeholder: 'Say something', autocomplete: 'off', 'aria-label': 'Message',
    });
    const form = el('form', {
      class: 'chat-form',
      onsubmit: (e) => {
        e.preventDefault();
        const text = U.cleanName(input.value, 120);
        if (!text) return;
        NS.meeting.send(text);
        input.value = '';
      },
    }, [input, el('button', { class: 'btn btn--primary chat-send', type: 'submit', text: 'Send' })]);

    const stop = NS.meeting.subscribe((msg) => {
      if (!document.body.contains(log)) { stop(); return; }
      log.appendChild(NS.meeting.renderRow(msg));
      log.scrollTop = log.scrollHeight;
    });
    onOverlayClose(stop);

    box.appendChild(el('div', { class: 'ghost-chat' }, [log, form]));
    log.scrollTop = log.scrollHeight;
    setTimeout(() => input.focus(), 50);
  }

  function showTasks() {
    if (NS.sabotage.commsDown()) {
      NS.bits.toast('Comms are down. No task list until they are fixed.', 'warn');
      return;
    }
    const box = shell('Your tasks', W.myTasks.length + ' in total');
    const list = el('ul', { class: 'task-list' });
    for (const task of W.myTasks) {
      const station = NS.rules.stationById[task.sid];
      const spot = station.steps ? station.steps[Math.min(task.step, station.steps.length - 1)] : station;
      const room = M.roomById[spot.room];
      const item = el('li', { class: 'task-item' + (task.done ? ' is-done' : '') }, [
        el('span', { class: 'task-tick' }),
        el('div', {}, [
          el('strong', { text: station.name }),
          el('span', { class: 'task-where', text: room ? room.name : '' }),
        ]),
        station.steps ? el('span', { class: 'task-steps', text: task.step + '/' + task.steps }) : null,
      ]);
      list.appendChild(item);
    }
    if (!W.myTasks.length) {
      list.appendChild(el('li', { class: 'task-item', text: 'Nothing yet. Tasks are dealt when the round starts.' }));
    }
    box.appendChild(list);
  }

  function showVitals() {
    const box = shell('Vitals', 'Read from the medical bay sensors');
    const list = el('div', { class: 'vitals' });
    const players = Array.from(W.players.values()).filter((p) => p.connected);
    players.sort((a, b) => a.name.localeCompare(b.name));
    for (const p of players) {
      list.appendChild(el('div', { class: 'vital' + (p.alive ? '' : ' is-dead') }, [
        NS.bits.avatar(p.colorIdx, p.hatIdx, 40, { ghost: !p.alive }),
        el('strong', { text: p.name }),
        el('span', { class: 'vital-state', text: p.alive ? 'Alive' : 'Dead' }),
      ]));
    }
    box.appendChild(list);
  }

  /* The map is also the sabotage console, which is how Among Us does it and
     is right: the impostor picks a room to break by pointing at the room. */
  function showMap(sabotageMode) {
    const impostor = W.myRole && C.ROLES[W.myRole].kill;
    if (sabotageMode && !impostor) return;
    const box = shell(sabotageMode ? 'Sabotage' : 'Aurora-7',
      sabotageMode ? 'Pick a system, or a room to seal.' : 'You are the amber marker.');

    if (sabotageMode) {
      const row = el('div', { class: 'sab-row' });
      for (const kind of NS.sabotage.MENU) {
        const def = NS.sabotage.SABOTAGES[kind];
        const disabled = cooldown.sabotage > 0 || !!W.state.sabotage;
        row.appendChild(el('button', {
          class: 'btn btn--danger sab-btn', type: 'button', disabled,
          onclick: () => { send('act', { t: 'sabotage', k: kind }); closeOverlay(); },
        }, [el('strong', { text: def.short }), el('span', { text: def.name })]));
      }
      box.appendChild(row);
    }

    const wrap = el('div', { class: 'map-wrap' });
    const canvas = el('canvas', { class: 'map-canvas' });
    wrap.appendChild(canvas);
    box.appendChild(wrap);

    const ctx = canvas.getContext('2d');
    let place = null;

    live(canvas, () => {
      place = fitMap(canvas, wrap, ctx);
      paintRooms(ctx);
      if (!sabotageMode && !NS.sabotage.commsDown()) {
        for (const task of W.myTasks) {
          if (task.done) continue;
          const spot = W.taskSpot(task);
          if (!spot) continue;
          ctx.fillStyle = '#ffb03a';
          ctx.beginPath(); ctx.arc(spot.x, spot.y, 17, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (W.state.sabotage) {
        for (const spot of NS.sabotage.activeSpots()) {
          if (spot.done) continue;
          ctx.fillStyle = '#ff3f5b';
          ctx.beginPath(); ctx.arc(spot.x, spot.y, 20, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (W.me) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(W.me.x, W.me.y, 22, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = (C.COLORS[W.me.colorIdx] || C.COLORS[0]).body;
        ctx.beginPath(); ctx.arc(W.me.x, W.me.y, 16, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      wrap.__place = place;
    });

    if (sabotageMode) {
      canvas.addEventListener('click', (e) => {
        const place = wrap.__place;
        if (!place) return;
        const rect = canvas.getBoundingClientRect();
        const wx = (e.clientX - rect.left - place.ox) / place.scale;
        const wy = (e.clientY - rect.top - place.oy) / place.scale;
        const room = M.roomAt(wx, wy);
        if (!room || M.SEALABLE.indexOf(room.id) < 0) return;
        send('act', { t: 'sabotage', k: 'doors', room: room.id });
        closeOverlay();
      });
      box.appendChild(el('p', { class: 'sheet-note', text: 'Tap a room to seal its doors for twelve seconds.' }));
    }
  }

  /* ---- role card and ejection -------------------------------------------- */

  function showRole(role, mates) {
    const def = C.ROLES[role] || C.ROLES.crewmate;
    const card = el('div', { class: 'reveal reveal--' + def.team });
    const inner = el('div', { class: 'reveal-inner' });
    inner.appendChild(NS.bits.avatar(W.me.colorIdx, W.me.hatIdx, 148));
    inner.appendChild(el('p', { class: 'reveal-eyebrow', text: def.team === 'impostor' ? 'Impostor' : def.team === 'jester' ? 'Neutral' : 'Crew' }));
    inner.appendChild(el('h2', { class: 'reveal-role', text: def.name }));
    inner.appendChild(el('p', { class: 'reveal-blurb', text: def.blurb }));
    if (mates && mates.length) {
      const row = el('div', { class: 'reveal-mates' });
      row.appendChild(el('span', { text: mates.length === 1 ? 'With you:' : 'With you:' }));
      for (const m of mates) {
        row.appendChild(el('span', { class: 'reveal-mate' }, [
          NS.bits.avatar(m.colorIdx, m.hatIdx, 44), el('em', { text: m.name }),
        ]));
      }
      inner.appendChild(row);
    }
    card.appendChild(inner);
    document.body.appendChild(card);
    nodes.reveal = card;
    requestAnimationFrame(() => card.classList.add('is-in'));
    NS.audio.play(def.team === 'impostor' ? 'sabotage' : 'taskDone');
  }

  function hideRole() {
    if (!nodes.reveal) return;
    nodes.reveal.classList.remove('is-in');
    const node = nodes.reveal;
    nodes.reveal = null;
    setTimeout(() => node.remove(), 400);
  }

  function showEject(ejected) {
    hideEject();
    const wrap = el('div', { class: 'eject' });
    const stage = el('div', { class: 'eject-stage' });
    if (ejected.id) {
      const body = el('div', { class: 'eject-body' });
      body.appendChild(NS.bits.avatar(ejected.colorIdx, ejected.hatIdx, 120, { ghost: true }));
      stage.appendChild(body);
    }
    const line = ejected.id
      ? ejected.name + ' was ' + (W.state.settings.confirmEjects
        ? (ejected.impostor ? 'an impostor.' : 'not an impostor.')
        : 'ejected.')
      : (ejected.tie ? 'Nobody was ejected. The vote tied.' : 'Nobody was ejected. The crew skipped.');
    stage.appendChild(el('p', { class: 'eject-line', text: line }));
    if (ejected.id && W.state.settings.confirmEjects) {
      stage.appendChild(el('p', {
        class: 'eject-sub',
        text: ejected.remaining === 1 ? '1 impostor remains.' : ejected.remaining + ' impostors remain.',
      }));
    }

    /* Who voted for whom, revealed only now the vote is closed. Showing it
       during the vote would turn it into a stampede; not showing it at all
       throws away the one hard fact a meeting produces. */
    if (!W.state.settings.anonymousVotes && ejected.votes && ejected.votes.length) {
      const groups = new Map();
      for (const [voter, target] of ejected.votes) {
        if (!groups.has(target)) groups.set(target, []);
        groups.get(target).push(voter);
      }
      const tally = el('div', { class: 'tally' });
      const order = Array.from(groups.keys())
        .sort((a, b) => groups.get(b).length - groups.get(a).length);
      for (const target of order) {
        const who = target === 'skip' ? null : W.players.get(target);
        const row = el('div', { class: 'tally-row' + (target === ejected.id ? ' is-out' : '') });
        row.appendChild(el('span', { class: 'tally-name', text: who ? who.name : 'Skipped' }));
        const faces = el('span', { class: 'tally-faces' });
        for (const voter of groups.get(target)) {
          const p = W.players.get(voter);
          faces.appendChild(p
            ? NS.bits.avatar(p.colorIdx, p.hatIdx, 30)
            : el('span', { class: 'tally-unknown' }));
        }
        row.appendChild(faces);
        tally.appendChild(row);
      }
      stage.appendChild(tally);
    }

    wrap.appendChild(stage);
    document.body.appendChild(wrap);
    nodes.eject = wrap;
    requestAnimationFrame(() => wrap.classList.add('is-in'));
    NS.audio.play('eject');
  }

  function hideEject() {
    if (!nodes.eject) return;
    nodes.eject.remove();
    nodes.eject = null;
  }

  /* ---- per frame --------------------------------------------------------- */

  function setCooldown(which, seconds) { cooldown[which] = Math.max(cooldown[which], seconds); }
  function forceCooldown(which, seconds) { cooldown[which] = seconds; }

  function update(dt) {
    for (const key in cooldown) if (cooldown[key] > 0) cooldown[key] = Math.max(0, cooldown[key] - dt);

    const state = W.state;
    const playing = state.phase === 'play';
    const me = W.me;
    nodes.host.hidden = !(playing || state.phase === 'reveal');
    if (!me) return;

    const mode = state.settings.taskBar;
    const showBar = mode === 'Always' || (mode === 'Meetings' && state.phase === 'meeting');
    nodes.taskbar.hidden = !showBar || state.tasksTotal === 0;
    if (!nodes.taskbar.hidden) {
      const ratio = state.tasksTotal ? state.tasksDone / state.tasksTotal : 0;
      nodes.taskbar.querySelector('i').style.transform = 'scaleX(' + ratio.toFixed(3) + ')';
      nodes.taskbar.querySelector('.taskbar-label').textContent =
        'Tasks ' + state.tasksDone + ' / ' + state.tasksTotal;
    }

    const sab = state.sabotage;
    nodes.alert.hidden = !sab;
    if (sab) {
      const def = NS.sabotage.SABOTAGES[sab.kind];
      nodes.alert.querySelector('.alert-title').textContent = def.name;
      nodes.alert.querySelector('.alert-body').textContent = def.warn;
      const clockNode = nodes.alert.querySelector('.alert-clock');
      clockNode.textContent = def.critical ? U.clock(sab.remaining) : '';
      nodes.alert.classList.toggle('is-critical', !!def.critical);
    }

    const dead = !!(me.ghost || !me.alive);
    if (nodes.tool_chat) nodes.tool_chat.hidden = !dead;

    const role = C.ROLES[W.myRole || 'crewmate'];
    nodes.roleTag.hidden = !W.myRole || state.phase !== 'play';
    if (!nodes.roleTag.hidden) {
      nodes.roleTag.querySelector('.role-tag-name').textContent = role.name;
      nodes.roleTag.querySelector('.role-tag-team').textContent =
        me.ghost ? 'Ghost' : (role.team === 'impostor' ? 'Impostor' : role.team === 'jester' ? 'Neutral' : 'Crew');
      nodes.roleTag.dataset.team = me.ghost ? 'ghost' : role.team;
    }

    const ctx = playing ? context() : {};
    const ghost = me.ghost;

    /* A button you own stays on screen greyed out rather than vanishing. A HUD
       that empties itself as you walk teaches nobody what they can do, and on
       a phone the buttons moving under your thumb is worse than useless. */
    const use = ctx.sabotageFix || ctx.use || ctx.emergency;
    show(nodes.use, playing);
    nodes.use.querySelector('.act-label').textContent =
      ctx.sabotageFix ? 'Fix'
        : ctx.use && ctx.use.kind === 'console' ? ctx.use.console.kind.replace('cameras', 'Cameras')
          .replace('admin', 'Admin').replace('vitals', 'Vitals')
        : ctx.use ? 'Use' : ctx.emergency ? 'Meeting' : 'Use';
    nodes.use.disabled = !use || !!(ctx.emergency && !ctx.use && !ctx.sabotageFix
      && (emergenciesLeft <= 0 || cooldown.emergency > 0));

    show(nodes.report, playing && !ghost);
    nodes.report.disabled = !ctx.report;

    show(nodes.kill, playing && !ghost && !!(W.myRole && role.kill));
    if (!nodes.kill.hidden) {
      nodes.kill.disabled = !ctx.kill || cooldown.kill > 0;
      ring(nodes.kill, cooldown.kill, state.settings.killCooldown);
      nodes.kill.querySelector('.act-label').textContent =
        cooldown.kill > 0 ? Math.ceil(cooldown.kill) + '' : 'Kill';
    }

    const canVent = W.myRole && (role.kill || role.ability === 'vent');
    show(nodes.vent, playing && !ghost && !!canVent);
    if (!nodes.vent.hidden) {
      nodes.vent.disabled = !ctx.vent;
      nodes.vent.querySelector('.act-label').textContent =
        ctx.vent && ctx.vent.kind === 'exit' ? 'Climb out' : 'Vent';
    }

    show(nodes.sabotage, playing && !ghost && !!(W.myRole && role.kill));
    if (!nodes.sabotage.hidden) {
      nodes.sabotage.disabled = cooldown.sabotage > 0;
      ring(nodes.sabotage, cooldown.sabotage, 25);
    }

    const ability = abilityInfo();
    show(nodes.ability, playing && !!ability && (!ghost || ability.kind === 'vitals'));
    if (ability && !nodes.ability.hidden) {
      const spent = ability.once && abilitySpent;
      nodes.ability.disabled = spent || (cooldown.ability > 0 && ability.kind !== 'vitals' && ability.kind !== 'trail');
      nodes.ability.querySelector('.act-label').textContent =
        spent ? 'Used' : (cooldown.ability > 0 && ability.kind !== 'vitals' && ability.kind !== 'trail'
          ? Math.ceil(cooldown.ability) + '' : ability.label);
      ring(nodes.ability, cooldown.ability, 30);
    }
  }

  function show(node, on) { node.hidden = !on; }

  function ring(node, left, total) {
    const p = total > 0 ? U.clamp(1 - left / total, 0, 1) : 1;
    node.style.setProperty('--cool', p.toFixed(3));
    node.classList.toggle('is-cooling', left > 0.05);
  }

  function setEmergencies(n) { emergenciesLeft = n; }
  function setAbilitySpent(v) { abilitySpent = !!v; }

  NS.hud = {
    init, update, showRole, hideRole, showEject, hideEject, showMap, showTasks,
    showAdmin, showCameras, showVitals, openConsole, showOptions, showGhostChat,
    setCooldown, forceCooldown, setEmergencies, setAbilitySpent, closeOverlay,
    cooldown,
    get stick() { return nodes.stick; },
  };
})(window.NS);
