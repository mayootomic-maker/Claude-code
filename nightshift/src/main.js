/* Wiring.

   Everything above this file is a piece that does one thing and knows nothing
   about the others: the map does not know about the network, the renderer
   does not know the rules, the host does not know what a button is. This is
   where they are joined, which makes it the only file where a change can
   break something far away -- so the seams are named rather than implied.

   Three of them matter. Presence carries where people are and is allowed to
   be slightly wrong. Snapshots carry what is true and overwrite anything this
   device believed. Events carry what just happened, once, and are the only
   thing allowed to make a noise. */

(function (NS) {
  'use strict';

  const U = NS.util;
  const C = NS.config;
  const M = NS.map;
  const W = NS.world;

  const session = {
    link: null, mode: 'solo', code: '', isHost: false,
    myId: null, hostId: null, ready: false, botCount: 3,
    connection: '', settings: C.defaults(), inGame: false,
  };

  let canvas = null;
  let pendingRole = null;
  let pendingRoleSince = 0;
  let lastPhase = 'lobby';

  const send = (kind, data) => { if (session.link) session.link.send(kind, data); };

  /* ---- boot -------------------------------------------------------------- */

  function boot() {
    canvas = U.$('#stage');
    NS.render.attach(canvas);
    NS.secrets.init();
    NS.hud.init({ send, onLeave: leaveToTitle });
    NS.input.init({ stick: NS.hud.stick, onAction: keyAction, surface: document.body });
    NS.meeting.init({ send });
    NS.screens.init({
      onHost: hostGame, onJoin: joinGame, onSolo: soloGame,
      onStart: startRound, onReady: toggleReady, onBots: changeBots,
      onLeave: leaveToTitle, onPlayAgain: backToLobby,
    });
    NS.screens.showTitle();

    /* The station is a thirty megabyte draw. It waits for the fonts so the
       room signage is set in the right face, and for a painted frame so the
       title is on screen before the main thread is busy for a moment. */
    const build = () => requestAnimationFrame(() => { NS.station.build(); });
    if (document.fonts && document.fonts.ready) {
      const timeout = new Promise((r) => setTimeout(r, 1500));
      Promise.race([document.fonts.ready, timeout]).then(build);
    } else build();

    requestAnimationFrame(frame);
    setInterval(beat, 60);
    window.addEventListener('pointerdown', () => NS.audio.wake(), { once: true });
    window.addEventListener('keydown', () => NS.audio.wake(), { once: true });
  }

  function keyAction(action) {
    if (NS.minigames.isOpen()) return;
    if (action === 'map') return NS.hud.showMap(false);
    if (action === 'tasks') return NS.hud.showTasks();
    const button = U.$('#act-' + action);
    if (button && !button.hidden && !button.disabled) button.click();
  }

  /* ---- sessions ---------------------------------------------------------- */

  function openLink(mode, code, asHost) {
    closeLink();
    session.mode = mode;
    session.code = code;
    session.isHost = asHost;
    session.ready = asHost;
    session.connection = '';
    W.reset();
    NS.bots.clear();
    NS.meeting.clear();
    lastPhase = 'lobby';

    session.link = NS.link.open({
      mode, code,
      onStatus(text) { session.connection = text; refreshLobby(); },
      onReady() {
        session.myId = session.link.id;
        W.spawnMe(session.myId, NS.screens.profile);
        if (asHost) {
          session.hostId = session.myId;
          NS.host.begin({ send, settings: session.settings });
          NS.host.addPlayer(session.myId, {
            n: NS.screens.profile.name, c: NS.screens.profile.colorIdx,
            h: NS.screens.profile.hatIdx, k: NS.secrets.publicKey,
          });
          if (mode === 'solo') NS.bots.fill(session.botCount, NS.host);
        } else {
          send('act', {
            t: 'hello', n: NS.screens.profile.name, c: NS.screens.profile.colorIdx,
            h: NS.screens.profile.hatIdx, k: NS.secrets.publicKey,
          });
        }
        showLobby();
      },
      onError(text) {
        NS.bits.toast(text, 'bad', 8);
        if (!session.link || !session.link.ready) leaveToTitle(text);
      },
      onMessage,
      onPeers() { refreshLobby(); },
    });
  }

  function closeLink() {
    if (session.link) { session.link.close(); session.link = null; }
    NS.host.stop();
    session.isHost = false;
    session.hostId = null;
    session.inGame = false;
  }

  /* `#local` puts the game on a BroadcastChannel between tabs of this browser:
     two people on one laptop, and the only way to try the join flow before a
     class without a second device. Otherwise the artifact room where there is
     one, and a public broker everywhere else. */
  function transport() {
    if (location.hash === '#local' && NS.link.localAvailable()) return 'local';
    return NS.link.roomAvailable() ? 'room' : 'mqtt';
  }

  const hostGame = () => openLink(transport(), U.roomCode(4), true);
  const joinGame = (profile, code) => openLink(transport(), code, false);
  const soloGame = () => openLink('solo', 'SOLO', true);

  function leaveToTitle(why) {
    closeLink();
    NS.minigames.close(true);
    NS.hud.closeOverlay();
    NS.hud.hideRole();
    NS.hud.hideEject();
    NS.meeting.hide();
    W.reset();
    NS.bots.clear();
    NS.fx.clear();
    NS.screens.showTitle(typeof why === 'string' ? why : null);
  }

  /* Two people in the same colour is a game where nobody can say who they saw,
     and everybody shares a browser profile often enough -- two tabs, a shared
     laptop, a saved default -- that it happens on the first try.

     Resolved by a rule rather than by asking: the lower peer id keeps the
     colour and everybody else moves. That is decided the same way on every
     device, so exactly one of a clashing pair moves and the two do not swap
     back and forth. It runs on a timer rather than once on arrival, because
     the person you clash with may not have arrived yet. */
  let clashCheck = 0;
  let lobbyTick = 0;
  function avoidColourClash() {
    if (!session.link || W.state.phase !== 'lobby') return;
    const taken = {};
    for (const peer of session.link.peers()) {
      if (peer.isMe || !peer.presence) continue;
      if (peer.id < session.myId) taken[peer.presence.c] = true;
    }
    const mine = NS.screens.profile.colorIdx;
    if (!taken[mine]) return;
    /* Anything anyone here is wearing is off the table, not just the colours
       of the people who outrank us -- otherwise we move onto a third person. */
    for (const peer of session.link.peers()) {
      if (peer.isMe || !peer.presence) continue;
      taken[peer.presence.c] = true;
    }
    for (let i = 0; i < C.COLORS.length; i++) {
      if (taken[i]) continue;
      NS.screens.profile.colorIdx = i;
      if (W.me) W.me.colorIdx = i;
      U.store.set('colour', i);
      send('act', { t: 'profile', c: i });
      NS.bits.toast('Somebody already had that colour. You are ' + C.COLORS[i].name + '.', 'info', 5);
      return;
    }
    NS.bits.toast('Every colour is taken.', 'warn', 5);
  }

  /* ---- lobby ------------------------------------------------------------- */

  function showLobby() {
    session.inGame = false;
    NS.screens.showLobby({ code: session.code });
    NS.screens.buildSettings(session.settings, session.isHost, changeSetting);
    refreshLobby();
  }

  function changeSetting(key, value) {
    if (!session.isHost) return;
    if (key.indexOf('role:') === 0) session.settings.roles[key.slice(5)] = value;
    else session.settings[key] = value;
    session.settings = C.sanitise(session.settings);
    NS.host.setSettings(session.settings);
    refreshLobby();
  }

  function changeBots(delta) {
    if (!session.isHost) return;
    const room = C.MAX_PLAYERS - NS.host.list().filter((id) => !NS.host.H.players[id].bot).length;
    session.botCount = U.clamp(session.botCount + delta, 0, Math.max(0, room));
    NS.bots.fill(session.botCount, NS.host);
    refreshLobby();
  }

  function toggleReady() {
    session.ready = !session.ready;
    send('act', { t: 'ready', v: session.ready });
    refreshLobby();
  }

  function refreshLobby() {
    if (session.inGame || !NS.screens.current || !NS.screens.current.classList.contains('screen--lobby')) return;
    const players = [];
    for (const p of W.players.values()) {
      if (!p.connected) continue;
      players.push({
        name: p.name, colorIdx: p.colorIdx, hatIdx: p.hatIdx, bot: p.bot,
        ready: p.ready, isHost: p.id === session.hostId,
      });
    }
    players.sort((a, b) => (b.isHost ? 1 : 0) - (a.isHost ? 1 : 0));
    NS.screens.updateLobby({
      code: session.code, isHost: session.isHost, players,
      bots: NS.bots.count(), ready: session.ready,
      connection: session.connection,
      blocked: session.isHost ? NS.host.canStart() : null,
    });
  }

  function startRound() {
    if (!session.isHost) return;
    NS.audio.wake();
    NS.host.start();
  }

  function backToLobby() {
    if (!session.isHost) return;
    NS.host.H.phase = 'lobby';
    NS.host.H.winner = null;
    NS.host.H.ejected = null;
    NS.host.H.bodies = [];
    for (const id of NS.host.list()) {
      NS.host.H.players[id].alive = true;
      NS.host.H.players[id].ghost = false;
      NS.host.H.players[id].ready = false;
    }
    NS.bots.resetForRound();
    NS.host.snapshot(true);
  }

  /* ---- incoming ---------------------------------------------------------- */

  function onMessage(msg) {
    if (!msg) return;
    if (msg.kind === 'act') {
      if (session.isHost) NS.host.handle(msg.from, msg.data);
      return;
    }
    if (msg.kind === 'sys') {
      /* Only the host speaks on this channel. Before the first snapshot the
         host is whoever sent one, and after that nobody else can. */
      if (!session.hostId) session.hostId = msg.from;
      if (msg.from !== session.hostId) return;
      applySys(msg.data);
      return;
    }
    if (msg.kind === 'chat') onChat(msg.from, msg.data);
  }

  function applySys(data) {
    if (!data || typeof data !== 'object') return;
    if (data.t === 'S') return applySnapshot(data);
    if (data.t === 'R') return takeRole(data);
    if (data.t === 'E') return onEvent(data);
  }

  function takeRole(data) {
    if (data.to !== session.myId) return;
    if (data.plain) return setRole(data.plain, !!data.clear);
    pendingRole = data;
    pendingRoleSince = U.now();
    tryPendingRole();
  }

  function tryPendingRole() {
    if (!pendingRole) return;
    if (!W.hostKey) {
      if (U.now() - pendingRoleSince > 6000) {
        pendingRole = null;
        NS.bits.toast('Your role did not arrive. Ask the host to restart the round.', 'bad', 8);
      }
      return;
    }
    const message = pendingRole;
    pendingRole = null;
    NS.secrets.openFrom(W.hostKey, message.s).then((payload) => {
      if (payload) setRole(payload, false);
      else NS.bits.toast('Your role could not be unsealed. Ask the host to restart the round.', 'bad', 8);
    });
  }

  function setRole(payload, wasClear) {
    W.myRole = payload.role || 'crewmate';
    W.myTasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    W.state.roles = W.state.roles || {};
    W.state.roles[session.myId] = W.myRole;
    for (const id of (payload.mates || [])) W.state.roles[id] = 'impostor';
    NS.hud.setAbilitySpent(false);
    if (W.state.phase === 'reveal') showRoleCard();
    if (wasClear) {
      NS.bits.toast('This browser cannot encrypt, so roles were sent in the clear on this round.', 'warn', 7);
    }
  }

  function showRoleCard() {
    const mates = (Object.keys(W.state.roles || {}))
      .filter((id) => id !== session.myId && W.state.roles[id] === 'impostor')
      .map((id) => W.players.get(id))
      .filter(Boolean);
    NS.hud.showRole(W.myRole, C.ROLES[W.myRole].team === 'impostor' ? mates : []);
  }

  function applySnapshot(s) {
    const st = W.state;
    st.seq = s.q | 0;
    st.settings = C.sanitise(s.st);
    if (!session.isHost) session.settings = st.settings;
    st.tasksDone = s.td | 0;
    st.tasksTotal = s.tt | 0;

    const seen = Object.create(null);
    for (const row of (s.pl || [])) {
      if (!Array.isArray(row)) continue;
      const id = String(row[0]);
      seen[id] = true;
      let p = W.players.get(id);
      if (!p) {
        p = W.entity(id, { isMe: id === session.myId });
        const spot = M.toWorld(M.SPAWN);
        p.x = p.tx = spot.x; p.y = p.ty = spot.y;
        W.players.set(id, p);
        if (p.isMe) W.me = p;
      }
      if (!p.isMe) {
        p.name = U.cleanName(row[1], C.NAME_MAX) || 'Someone';
        p.colorIdx = U.clamp(row[2] | 0, 0, C.COLORS.length - 1);
        p.hatIdx = U.clamp(row[3] | 0, 0, C.HATS.length - 1);
      }
      const flags = row[4] | 0;
      p.alive = !!(flags & 1);
      p.ghost = !!(flags & 2);
      p.bot = !!(flags & 4);
      p.connected = !(flags & 8);
      p.ready = !!(flags & 16);
      p.shielded = !!(flags & 32);
    }
    for (const [id, p] of Array.from(W.players)) {
      if (!seen[id] && !p.isMe) W.players.delete(id);
    }

    W.bodies = (s.bo || []).map((b) => ({
      id: String(b[0]), x: Number(b[1]) || 0, y: Number(b[2]) || 0,
      colorIdx: U.clamp(b[3] | 0, 0, C.COLORS.length - 1),
      hatIdx: U.clamp(b[4] | 0, 0, C.HATS.length - 1),
      facing: b[5] | 0,
    }));

    const invisible = s.iv || [];
    const shifted = new Map((s.sh || []).map((row) => [row[0], row[1]]));
    for (const p of W.players.values()) {
      p.invisible = invisible.indexOf(p.id) >= 0;
      const as = shifted.get(p.id);
      const other = as ? W.players.get(as) : null;
      p.shiftIdx = other ? other.colorIdx : -1;
    }

    st.sabotage = s.sb ? {
      kind: s.sb.k, remaining: Number(s.sb.r) || 0,
      done: s.sb.d || [], holds: s.sb.h || [],
    } : null;

    applyDoors(s.cd || []);

    st.meeting = s.mt ? {
      reason: s.mt.r, by: s.mt.by, bodyId: s.mt.bd, stage: s.mt.s,
      time: Number(s.mt.t) || 0, voted: s.mt.vd || [],
    } : null;
    st.ejected = s.ej || null;
    st.winner = s.wn ? { team: s.wn.tm, reason: s.wn.rs, roles: s.wn.rl || [] } : null;
    if (st.winner) {
      st.roles = st.roles || {};
      for (const row of st.winner.roles) st.roles[row[0]] = row[1];
    }

    const phase = s.ph;
    if (phase !== st.phase) {
      const from = st.phase;
      st.phase = phase;
      onPhase(from, phase);
    }
  }

  function applyDoors(list) {
    const wanted = {};
    for (const id of list) wanted[id] = true;
    const current = W.state.closedRooms || [];
    for (const id of current) if (!wanted[id]) M.sealRoom(id, false);
    for (const id of list) if (current.indexOf(id) < 0) M.sealRoom(id, true);
    W.state.closedRooms = list.slice();
  }

  function onPhase(from, to) {
    NS.minigames.close(true);
    NS.hud.closeOverlay();

    if (to === 'reveal') {
      session.inGame = true;
      NS.screens.hideAll();
      NS.fx.clear();
      W.placeAtSpawn(Array.from(W.players.keys()));
      NS.render.centreOn(W.me.x, W.me.y, true);
      NS.hud.forceCooldown('kill', W.state.settings.killCooldown + 5);
      NS.hud.forceCooldown('ability', 20);
      NS.hud.forceCooldown('sabotage', 15);
      NS.hud.setEmergencies(W.state.settings.emergencies);
      NS.meeting.clear();
      if (W.myRole) showRoleCard();
      return;
    }
    if (from === 'reveal' && to === 'play') { NS.hud.hideRole(); return; }
    if (to === 'meeting') {
      NS.hud.hideRole();
      NS.hud.hideEject();
      W.placeAtSpawn(Array.from(W.players.keys()));
      NS.render.centreOn(W.me.x, W.me.y, true);
      NS.input.setEnabled(false);
      NS.meeting.show(W.state);
      return;
    }
    if (to === 'eject') {
      NS.meeting.hide();
      NS.input.setEnabled(false);
      if (W.state.ejected) NS.hud.showEject(W.state.ejected);
      return;
    }
    if (to === 'play') {
      NS.hud.hideEject();
      NS.meeting.hide();
      NS.input.setEnabled(true);
      W.placeAtSpawn(Array.from(W.players.keys()));
      NS.render.centreOn(W.me.x, W.me.y, true);
      if (from === 'eject') NS.hud.setCooldown('kill', 10);
      return;
    }
    if (to === 'end') {
      NS.hud.hideEject();
      NS.meeting.hide();
      NS.input.setEnabled(true);
      session.inGame = false;
      const players = [];
      for (const p of W.players.values()) {
        if (!p.connected) continue;
        players.push({
          name: p.name, colorIdx: p.colorIdx, hatIdx: p.hatIdx,
          alive: p.alive, role: (W.state.roles || {})[p.id] || 'crewmate',
        });
      }
      NS.screens.showEnd(W.state.winner || { team: 'crew', reason: '' }, players, session.isHost);
      return;
    }
    if (to === 'lobby') {
      session.inGame = false;
      NS.input.setEnabled(true);
      W.myRole = null;
      W.myTasks = [];
      W.state.roles = {};
      W.bodies = [];
      session.ready = session.isHost;
      showLobby();
    }
  }

  /* ---- events ------------------------------------------------------------ */

  function seen(x, y) {
    if (!W.me) return false;
    if (W.me.ghost) return true;
    return U.dist(W.me.x, W.me.y, x, y) < NS.render.visionRadius() * 1.1
      && NS.los.clear(W.me.x, W.me.y, x, y);
  }

  function onEvent(e) {
    const me = session.myId;
    switch (e.e) {
      case 'kill': {
        const victim = W.players.get(e.target);
        if (e.by === me) NS.hud.forceCooldown('kill', W.state.settings.killCooldown);
        if (e.target === me) {
          NS.audio.play('died');
          NS.render.flash('#7a0f20', 0.8);
          NS.render.shake(14);
          NS.bits.toast('You are dead. Finish your tasks and watch.', 'bad', 6);
        } else if (seen(e.x, e.y)) {
          NS.audio.play('kill');
          NS.render.shake(7);
        }
        NS.fx.kill(e.x, e.y);
        if (victim) { victim.alive = false; victim.ghost = true; }
        break;
      }
      case 'shielded':
        NS.fx.shield(e.x, e.y);
        if (e.target === me) {
          NS.audio.play('shield');
          NS.bits.toast('Something hit your shield. It is gone now.', 'warn', 6);
        } else if (seen(e.x, e.y)) NS.audio.play('shield');
        if (e.by === me) NS.bits.toast('They were shielded.', 'warn', 5);
        break;
      case 'shield':
        if (e.by === me) { NS.hud.setAbilitySpent(true); NS.bits.toast('Shield placed.', 'good'); }
        if (e.target === me) NS.bits.toast('A medic is protecting you.', 'good', 6);
        break;
      case 'shot':
        NS.fx.shot(e.x, e.y);
        if (seen(e.x, e.y)) { NS.audio.play('shoot'); NS.render.shake(6); }
        if (e.by === me) NS.hud.forceCooldown('ability', W.state.settings.killCooldown + 10);
        break;
      case 'vanish': {
        const who = W.players.get(e.by);
        if (who && seen(who.x, who.y)) NS.fx.vanish(who.x, who.y);
        if (e.by === me) {
          if (e.on) { NS.audio.play('vanish'); NS.hud.forceCooldown('ability', 35); }
        }
        break;
      }
      case 'shift':
        if (e.by === me && e.as) { NS.audio.play('shift'); NS.hud.forceCooldown('ability', 30); }
        break;
      case 'vent': {
        const group = M.VENT_GROUPS[e.g];
        const spot = group && group[e.i];
        if (spot) {
          const w = M.toWorld(spot);
          if (seen(w.x, w.y)) { NS.fx.vent(w.x, w.y); NS.audio.play('vent'); }
        }
        break;
      }
      case 'meeting':
        NS.audio.play(e.reason === 'body' ? 'report' : 'alarm');
        NS.render.flash('#3a2a05', 0.5);
        break;
      case 'sabotage': {
        const def = NS.sabotage.SABOTAGES[e.k];
        NS.audio.play(e.k === 'lights' ? 'lightsOut' : 'sabotage');
        NS.render.shake(def && def.critical ? 10 : 5);
        /* No toast: the banner across the top says this already and stays
           until it is fixed. Two copies of the same sentence is noise. */
        if (e.by === me) NS.hud.forceCooldown('sabotage', 25);
        break;
      }
      case 'doors':
        NS.audio.play('door');
        if (e.by === me) NS.hud.forceCooldown('sabotage', 10);
        break;
      case 'fixed':
        NS.audio.play('fixed');
        NS.bits.toast('Fixed.', 'good');
        break;
      case 'visual': {
        const who = W.players.get(e.by);
        if (who && seen(who.x, who.y)) {
          const station = NS.rules.stationById[e.sid];
          NS.fx.task(who.x, who.y);
          NS.fx.say(who.x, who.y - 52, station ? station.name : 'Task', '#34e0b8');
        }
        break;
      }
      case 'voted':
        if (e.by !== me) NS.audio.play('vote');
        break;
      default: break;
    }
  }

  function onChat(from, data) {
    if (!data || typeof data !== 'object' || data.t !== 'msg') return;
    const text = U.cleanName(data.text, C.CHAT_MAX);
    if (!text) return;
    const who = W.players.get(from);
    if (!who) return;
    const senderDead = !who.alive || who.ghost;
    const iAmDead = W.me && (!W.me.alive || W.me.ghost);
    /* The dead talk among themselves. Filtering here rather than at the
       sender is deliberate: the sender cannot be trusted to leave you out. */
    if (senderDead && !iAmDead) return;
    if (!senderDead && W.state.phase !== 'meeting' && !iAmDead) return;
    NS.meeting.onChat({
      name: who.name, colorIdx: who.colorIdx, ghost: senderDead, text,
    });
  }

  /* ---- two loops, and why ------------------------------------------------ */

  /* Drawing runs on requestAnimationFrame, which is right: it matches the
     screen and stops when nothing is on screen to match.

     The game does NOT run there, and this was found the hard way. A browser
     stops animation frames in a tab that is not visible, so with the whole
     game on that clock the host glancing at another tab froze the round for
     everybody -- and, worse, stopped their presence going out, so after five
     seconds thirteen other devices decided the host had left. In a classroom
     that is not an edge case; it is what happens the first time somebody gets
     a message.

     So anything that has to keep happening -- the authoritative tick, presence,
     hearing other people -- runs on an interval instead. A hidden tab throttles
     that to about once a second rather than stopping it, which is slow but
     alive, and it catches up the moment the tab is looked at again. */

  let lastBeat = U.now();
  let lastFrame = U.now();

  function beat() {
    const now = U.now();
    const dt = Math.min(1.5, (now - lastBeat) / 1000);
    lastBeat = now;

    syncPeers();
    tryPendingRole();

    clashCheck -= dt;
    if (clashCheck <= 0) { clashCheck = 1.2; avoidColourClash(); }

    /* The lobby is redrawn on a timer rather than only when somebody joins.
       Whether the round can start depends on colours that resolve themselves a
       second after everybody has arrived, and a start button left disabled by
       a state that has since cleared is the worst kind of bug: the game looks
       broken and there is nothing to click to find out why. */
    lobbyTick -= dt;
    if (lobbyTick <= 0) { lobbyTick = 0.25; refreshLobby(); }

    publishPresence();
    if (session.isHost) NS.host.tick(dt);

    /* Countdowns run locally between snapshots. The host still owns them --
       the next snapshot corrects any drift -- but a timer that only moved
       twice a second would look broken. */
    const st = W.state;
    if (st.meeting && st.meeting.time > 0) st.meeting.time = Math.max(0, st.meeting.time - dt);
    if (st.sabotage && st.sabotage.remaining > 0) {
      const def = NS.sabotage.SABOTAGES[st.sabotage.kind];
      if (def && def.critical) st.sabotage.remaining = Math.max(0, st.sabotage.remaining - dt);
    }
  }

  function frame() {
    const now = U.now();
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    const input = NS.input.read();
    W.step(dt, input);
    NS.fx.step(dt);

    if (session.inGame && W.me) {
      NS.render.follow(W.me, dt);
      NS.render.drawScene(now, dt);
    }
    NS.hud.update(dt);
    NS.meeting.update();

    requestAnimationFrame(frame);
  }

  function syncPeers() {
    if (!session.link) return;
    const peers = session.link.peers();
    for (const peer of peers) {
      const presence = peer.presence || {};
      if (peer.isMe) {
        if (peer.id && peer.id !== session.myId) rekeyMe(peer.id);
        if (session.isHost) {
          NS.host.addPlayer(peer.id, {
            n: NS.screens.profile.name, c: NS.screens.profile.colorIdx,
            h: NS.screens.profile.hatIdx, k: NS.secrets.publicKey,
          });
        }
        continue;
      }
      if (presence.H) {
        session.hostId = peer.id;
        W.hostKey = presence.k || W.hostKey;
        if (presence.B) W.adoptBots(presence.B);
      }
      W.adopt(peer.id, presence, false);
      const p = W.players.get(peer.id);
      if (p) p.ready = !!presence.R;
      if (session.isHost) {
        NS.host.addPlayer(peer.id, { n: presence.n, c: presence.c, h: presence.h, k: presence.k });
      }
    }
    if (session.isHost) {
      const here = Object.create(null);
      for (const peer of peers) here[peer.id] = true;
      for (const id of NS.host.list()) {
        if (here[id] || NS.host.H.players[id].bot) continue;
        NS.host.dropPlayer(id);
      }
    }
    if (session.myId && session.hostId === session.myId) W.hostKey = NS.secrets.publicKey;
  }

  /* Snapshots key every player by the id the transport gave them, so if this
     device's id ever changes the local entity has to move with it -- otherwise
     the next snapshot creates a second copy of you and the one you are walking
     around in belongs to nobody. */
  function rekeyMe(id) {
    const old = session.myId;
    session.myId = id;
    if (!W.me) return;
    if (old) W.players.delete(old);
    W.me.id = id;
    W.players.set(id, W.me);
    if (session.isHost) {
      session.hostId = id;
      if (old && NS.host.H.players[old]) delete NS.host.H.players[old];
    }
  }

  function publishPresence() {
    if (!session.link || !W.me) return;
    const patch = W.encode(W.me);
    if (NS.secrets.publicKey) patch.k = NS.secrets.publicKey;
    patch.R = session.ready ? 1 : 0;
    if (session.isHost) {
      patch.H = 1;
      const bots = NS.bots.entities();
      if (bots.length) patch.B = W.encodeBots(bots);
    }
    session.link.presence(patch);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  NS.session = session;
})(window.NS);
