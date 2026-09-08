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
    if (overlay) { overlay.remove(); overlay = null; W.frozen = false; }
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
    const pad = 10;
    function paint() {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min((rect.width - pad * 2) / M.pixelWidth, (rect.height - pad * 2) / M.pixelHeight);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const ox = (rect.width - M.pixelWidth * scale) / 2;
      const oy = (rect.height - M.pixelHeight * scale) / 2;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);

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
        ctx.fillStyle = 'rgba(207,217,232,0.72)';
        ctx.font = '700 34px Archivo, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(room.name, room.cx, room.cy);
      }
      if (!sabotageMode && !NS.sabotage.commsDown()) {
        for (const task of W.myTasks) {
          if (task.done) continue;
          const spot = W.taskSpot(task);
          if (!spot) continue;
          ctx.fillStyle = '#ffb03a';
          ctx.beginPath(); ctx.arc(spot.x, spot.y, 17, 0, Math.PI * 2); ctx.fill();
        }
      }
      const active = W.state.sabotage;
      if (active) {
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
      wrap.__place = { ox, oy, scale };
    }
    paint();
    const repaint = () => { if (overlay) paint(); };
    window.addEventListener('resize', repaint);
    const stop = new MutationObserver(() => {
      if (!document.body.contains(canvas)) { window.removeEventListener('resize', repaint); stop.disconnect(); }
    });
    stop.observe(document.body, { childList: true });

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
      ctx.sabotageFix ? 'Fix' : ctx.use ? 'Use' : ctx.emergency ? 'Meeting' : 'Use';
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
    setCooldown, forceCooldown, setEmergencies, setAbilitySpent, closeOverlay,
    cooldown,
    get stick() { return nodes.stick; },
  };
})(window.NS);
