/* The shell: everything that is not a game of chance.

   It runs in two modes. In `world` you are a person walking around a floor of
   the tower in first person; the machines are objects standing in the room and
   the camera belongs to the player. In `table` you have walked up to one and
   pressed E: the camera eases into that machine's own view, the betting rail
   slides in, and the game takes over until you step away.

   It is also the only thing that moves money. A game is handed a stake and
   gives back a multiplier; the shell stakes, settles and records. That split is
   what keeps twelve games honest without twelve separate audits. */

(function () {
  'use strict';

  const C = GWConfig;
  const $ = (id) => document.getElementById(id);

  const el = {};
  const shell = {
    stage: null, lib: null, store: null, audio: null, friends: null,
    player: null, level: null, anchors: [], crew: null, touch: null, hands: null,
    net: null, heat: null, boss: null, events: null,
    mode: 'boot',
    game: null, handle: null, ctx: null, anchor: null,
    busy: false, stake: 25, pending: null, endAfterHand: false,
    // Bumped whenever the table changes. A hand still in the air when that
    // happens must not settle against the table that replaced it.
    generation: 0,
    floorBusy: false,
  };

  /* --- boot ---------------------------------------------------------------- */

  async function boot() {
    for (const id of ['app', 'boot', 'bootText', 'bootFill', 'statBank', 'statDebt',
      'statQuota', 'quotaFill', 'statTickets', 'statDay', 'statClock', 'scene',
      'gameIcon', 'gameName', 'gameBlurb', 'betList', 'betExtra', 'stakeInput',
      'stakeDown', 'stakeUp', 'chipRow', 'btnPlay', 'playText', 'playSub',
      'oddsToggle', 'oddsPanel', 'crewList', 'ticker', 'screens', 'resultCard',
      'resultHeadline', 'resultAmount', 'liveReadout', 'gameStatus', 'promptBox',
      'btnTower', 'btnShop', 'btnSound', 'btnMenu', 'btnTable', 'shoutBar', 'btnShout',
      'shoutCount', 'rail', 'hud', 'reticle', 'floorTag', 'usePrompt', 'useLabel',
      'useNote', 'resumeBtn', 'leaveBtn', 'touchLayer', 'touchStick', 'touchKnob',
      'touchUse', 'guide', 'guideArrow', 'guideText',
      'title', 'titleMenu', 'titleTickets', 'btnTitle',
      'challengeCard', 'challengeName', 'challengeReward', 'challengeNote',
      'heatWrap', 'heatFill', 'heatLabel', 'banner', 'bannerText', 'bannerClock']) {
      el[id] = $(id);
    }
    el.stage = document.querySelector('.stage');

    if (!hasWebGL()) {
      return fail('This one needs WebGL, and this browser will not give it to us. '
        + 'The whole game is real 3D — there is no 2D version to fall back to.');
    }

    progress(0.1, 'Counting the cards…');
    let doc;
    try {
      doc = window.__GW_MODELS__ || await (await fetch('../assets/models.json')).json();
    } catch (err) {
      return fail('The models did not load. ' + err.message);
    }

    progress(0.45, 'Polishing the wheel…');
    shell.lib = GWModels.decode(doc);
    shell.audio = GWAudio.create();
    shell.store = GWState.create();
    shell.stage = GWStage.create({ canvas: el.scene });
    shell.stage.start();

    progress(0.75, 'Opening the doors…');
    shell.heat = GWHeat.create(shell.store);
    shell.events = GWEvents.create(shell.store, {
      onSweep: (by) => { for (const r of shell.anchors) shell.heat.warm(r.def.id, by); },
      onBank: () => { renderHud(); refreshPlayButton(); },
      onBanner: renderBanner,
      onFriendOffer: (id) => { if (shell.crew) shell.crew.offer(id); },
    });
    shell.player = GWPlayer.create({
      stage: shell.stage,
      audio: shell.audio,
      canvas: el.scene,
      onInteract: interact,
      onLockChange: (locked) => {
        el.app.classList.toggle('is-unlocked', !locked);
        // A phone never takes the pointer, so the "click to look around" prompt
        // would sit there permanently telling you to do something you cannot.
        el.resumeBtn.hidden = shell.touch
          || !(shell.mode === 'world' && !locked && !GWScreens.isOpen());
      },
    });
    shell.touch = GWTouch.init({
      player: shell.player, canvas: el.scene, el, onInteract: interact,
    });

    /* Your own hands, parented to the camera.

       The camera has to be in the scene for its children to be drawn -- a
       camera three.js is rendering from is not necessarily one it is walking,
       and hands hung off a camera outside the graph simply never appear. */
    shell.hands = GWCrew.buildHands(shell.lib, shell.store.meta.paint, shell.stage.camera);
    shell.stage.scene.add(shell.stage.camera);
    shell.stage.camera.add(shell.hands.group);

    wire();
    shell.store.on('say', renderTicker);
    shell.store.on('bank', () => { renderHud(); refreshPlayButton(); });
    /* The room watches you play.

       Every settlement in the building comes through `resolve`, the friends'
       own bets included, so a hand that was not yours is skipped -- they
       already react to their own through `settled`. What counts as worth
       reacting to is the size of the swing against the stake, not against the
       bank: doubling a hundred is a moment whichever night it happens on. */
    shell.store.on('resolve', (r) => {
      if (!shell.crew || !r || (r.detail && r.detail.by)) return;
      if (!r.stake) return;
      const swing = r.net / r.stake;
      if (swing >= 1) shell.crew.react('win', shell.player.state.pos);
      else if (swing <= -0.999) shell.crew.react('loss', shell.player.state.pos);
    });

    GWScreens.init(shell);
    GWModMenu.init(shell);
    GWTitle.init(shell);

    progress(1, 'Ready.');
    el.boot.hidden = true;
    el.app.hidden = false;
    shell.stage.resize();

    startDayLoop();
    renderHud();
    renderCrew();
    /* Straight to the title, over a room that is really there.

       Building the lobby first costs the same as building it later and buys
       the title screen a live backdrop -- and by the time anyone presses Play
       the models, the environment map and the first frames are all paid for,
       so the game starts instead of stalling. */
    await showcase();
    GWTitle.show();
  }

  /* The lobby as scenery. Deliberately does not touch the run: no phase
     change, no player, no crew. Pressing Play builds it again properly. */
  async function showcase() {
    unloadFloor();
    document.documentElement.setAttribute('data-floor', 'lobby');
    shell.stage.setEnvironment('velvet');
    shell.level = GWLevel.buildLobby({ rng: layoutRng(-1) });
    shell.stage.group.add(shell.level.group);
    shell.stage.setLightSites(shell.level.sites);
    fogForRoom();
    shell.hands.group.visible = false;
    setMode('idle');
    await frame();
  }

  /* Pick the run up wherever it was left. */
  async function resume() {
    const s = shell.store.s;
    if (s.ending) { GWScreens.show('ending', { kind: s.ending }); return; }
    if (s.phase === 'floor') await enterFloor(s.floor);
    else if (s.phase === 'lobby' || s.phase === 'closing') await enterLobby();
    else if (s.phase === 'report') GWScreens.show('report');
    else GWScreens.show('briefing');
  }

  /* Throw the run away and start again. A reload rather than a reset in place:
     there is one code path that builds a new run correctly -- the one that runs
     when there is no save -- and using it is worth a second of black. */
  function newRun() {
    shell.store.discard();
    window.location.reload();
  }

  function hasWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) { return false; }
  }

  function progress(v, text) {
    el.bootFill.style.width = Math.round(v * 100) + '%';
    el.bootText.textContent = text;
  }

  function fail(message) {
    el.boot.classList.add('is-error');
    el.bootText.textContent = message;
    el.bootFill.parentElement.hidden = true;
  }

  /* --- wiring -------------------------------------------------------------- */

  function wire() {
    const unlock = () => shell.audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    el.scene.addEventListener('click', () => {
      // Pointer lock is the mouse path only; on a touchscreen a tap on the
      // canvas is a look-drag that ended, and asking for the pointer there
      // pops a permission bar over the game for nothing.
      if (shell.touch) return;
      if (shell.mode !== 'world' || GWScreens.isOpen()) return;
      // Click to take the pointer; once you have it, click is the other half of
      // E. Every first-person game in existence lets you use the thing you are
      // looking at by clicking on it, and a prompt that only answers to a key
      // reads as a machine that is broken.
      if (shell.player.locked) interact();
      else shell.player.lock();
    });
    el.resumeBtn.addEventListener('click', () => shell.player.lock());
    el.leaveBtn.addEventListener('click', leaveMachine);

    el.btnPlay.addEventListener('click', playHand);
    el.stakeUp.addEventListener('click', () => nudgeStake(1));
    el.stakeDown.addEventListener('click', () => nudgeStake(-1));
    el.stakeInput.addEventListener('change', () => setStake(parseInt(el.stakeInput.value, 10) || 0));

    el.oddsToggle.addEventListener('click', () => {
      const open = el.oddsToggle.getAttribute('aria-expanded') === 'true';
      el.oddsToggle.setAttribute('aria-expanded', String(!open));
      el.oddsPanel.hidden = open;
      shell.audio.play('click');
    });

    el.btnTower.addEventListener('click', callLift);
    el.btnShop.addEventListener('click', () => GWScreens.show('shop'));
    el.btnMenu.addEventListener('click', () => GWModMenu.toggle());
    el.btnTable.addEventListener('click', () => GWScreens.show('table'));
    el.btnTitle.addEventListener('click', () => {
      // Saved on the way out, because the menu is where people close the tab.
      shell.store.save();
      GWScreens.close(true);
      shell.title();
    });
    el.btnSound.addEventListener('click', () => {
      const muted = !shell.audio.muted;
      shell.audio.setMuted(muted);
      shell.store.meta.muted = muted;
      shell.store.saveMeta();
      el.btnSound.textContent = muted ? '🔇' : '🔊';
      el.btnSound.setAttribute('aria-pressed', String(!muted));
    });
    if (shell.store.meta.muted) {
      shell.audio.setMuted(true);
      el.btnSound.textContent = '🔇';
      el.btnSound.setAttribute('aria-pressed', 'false');
    }

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'F1') { e.preventDefault(); GWModMenu.toggle(); return; }
      if (e.key === 'Escape') {
        if (GWScreens.close()) return;
        if (shell.mode === 'table' && !shell.busy) leaveMachine();
        return;
      }
      if (e.key === 'b' || e.key === 'B') { GWScreens.show('shop'); return; }
      if (e.key === 'm' || e.key === 'M') { GWScreens.show('table'); return; }
      if (e.key === ' ' && shell.mode === 'table' && !shell.busy && !GWScreens.isOpen()) {
        e.preventDefault(); playHand(); return;
      }
      if (e.key === 'q' || e.key === 'Q') { if (!el.shoutBar.hidden) el.btnShout.click(); }
    });

    window.addEventListener('beforeunload', () => shell.store.save());

    /* Reduced motion, from the operating system unless the mod menu overrides
       it. The CSS media query handles the interface; this carries it into 3D. */
    const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const applyMotion = () => {
      const wanted = shell.store.s.mods.reducedMotion || (motion ? motion.matches : false);
      shell.stage.setReducedMotion(wanted);
    };
    if (motion && motion.addEventListener) motion.addEventListener('change', applyMotion);
    shell.applyMotion = applyMotion;
    applyMotion();

    /* Look settings, from the player's own preferences rather than the run.
       0.0022 rad per pixel is the middle of the range every first-person game
       lands in; the slider multiplies it. */
    const applyLook = () => {
      const meta = shell.store.meta;
      shell.player.setLook({
        sensitivity: 0.0022 * (Number(meta.look) || 1),
        invert: !!meta.invertY,
        smoothing: typeof meta.smoothing === 'number' ? meta.smoothing : 0,
        headBob: meta.headBob !== false,
      });
      shell.stage.setWalkFov(Number(meta.fov) || 72);
    };
    shell.applyLook = applyLook;
    applyLook();
  }

  /* --- the day ------------------------------------------------------------- */

  const WARNINGS = [
    { at: 60, text: 'One minute before the doors close.', tone: 'warn' },
    { at: 30, text: 'Thirty seconds.', tone: 'warn' },
    { at: 10, text: 'Ten seconds. Finish the hand.', tone: 'bad' },
  ];
  const warned = new Set();

  function startDayLoop() {
    let carry = 0;
    shell.stage.onTick((dt) => {
      const s = shell.store.s;

      if (shell.mode === 'world' && shell.player.active) {
        shell.player.update(dt);
        updateReticle();
        const ps = shell.player.state;
        shell.hands.update(ps.bob, Math.hypot(ps.vel.x, ps.vel.z), ps.vy,
                           (GWPlayer.EYE - ps.height) / 0.57);
      }

      if (shell.mode === 'world') { cullDistantMachines(); updateGuide(); }
      if (s.phase === 'floor' && !GWLoading.isOpen() && !s.mods.freezeClock) {
        shell.heat.tick(dt, shell.mode === 'table' && shell.game ? shell.game.id : null);
        shell.events.tick(dt);
        renderBannerClock();
        updateBoss(dt);
        checkWalkOut();
      }
      if (shell.net) shell.net.tick(dt, performance.now());

      // The crew keeps moving whatever you are doing. Freezing them while you
      // are sat at a table is how you look up from the roulette and find three
      // people standing exactly where you left them.
      if (shell.crew && !GWLoading.isOpen()) {
        shell.crew.update(Math.min(dt, 0.1), shell.player.state.pos);
      }

      if (s.phase !== 'floor' || GWLoading.isOpen()) return;
      if (s.mods.freezeClock) return;

      s.timeLeft -= dt;

      carry += dt;
      if (carry >= 0.25) { carry = 0; renderClock(); renderCrew(); }

      // The clock is deliberately not a live region: announcing it four times a
      // second makes the page unusable with a screen reader, which is the exact
      // failure mode a countdown invites.
      for (const mark of WARNINGS) {
        if (s.timeLeft <= mark.at && !warned.has(mark.at)) {
          warned.add(mark.at);
          shell.store.say(mark.text, mark.tone);
          shell.audio.play(mark.at <= 10 ? 'alarm' : 'tick');
          // The crew look at the time too. A line in the ticker is something
          // you have to be reading; three people checking their watches is
          // something you see out of the corner of an eye.
          if (shell.crew) shell.crew.react('late', shell.player.state.pos);
        }
      }

      if (s.timeLeft <= 0) {
        s.timeLeft = 0;
        // A hand already in the air finishes. Snatching the table away
        // mid-animation is how a stake disappears with nothing to show for it.
        if (shell.busy) shell.endAfterHand = true;
        else endDay();
      }
    });
  }

  /* The doors close, and you are walked out to the car.

     The night used to stop dead where you stood and put a spreadsheet over the
     top of it. It ends where it started now: the floor closes, you come back
     out to the yard, and the reckoning happens when you get in the limo --
     which is both what the game this follows does and the only version where
     the last thing you do with a night is walk away from it. Nothing is
     settled here; `boardLimo` does that, so the number in the report is the
     number you had when you got in. */
  async function endDay() {
    const s = shell.store.s;
    if (s.phase !== 'floor') return;
    s.phase = 'closing';
    warned.clear();
    hideShout();
    shell.audio.play('alarm');
    shell.store.say('The doors close. Everyone out to the car.', 'warn');
    await enterLobby();
    renderHud();
    shell.store.save();
  }

  /* --- floors -------------------------------------------------------------- */

  function setMode(mode) {
    shell.mode = mode;
    el.app.classList.toggle('is-world', mode === 'world');
    el.app.classList.toggle('is-table', mode === 'table');
    shell.player.active = mode === 'world';
    shell.stage.setManualCamera(mode === 'world');
    el.leaveBtn.hidden = mode !== 'table';
    el.usePrompt.hidden = true;
    if (mode !== 'world') el.guide.hidden = true;
    // Your hands belong to walking around, not to sitting at a table -- at a
    // table the camera is across the felt and they would hang in mid-air.
    shell.hands.group.visible = mode === 'world';
    if (shell.touch) shell.touch.setVisible(mode === 'world');
    if (mode !== 'world') {
      shell.player.unlock();
      el.resumeBtn.hidden = true;
      el.app.classList.remove('is-aiming');
    }
  }

  /* The lobby between days. The loan shark, the shop, the shelf your purchases
     sit on, and the doors to the limo -- all of them things in a room. */
  async function enterLobby() {
    if (shell.floorBusy) return;
    shell.floorBusy = true;
    const s = shell.store.s;
    // Coming back off a floor with the night behind you is still the yard, but
    // it is not the same moment: `closing` means the shark has not been paid
    // yet and the limo is the thing that does it. Overwriting it here sent you
    // back to the yard with the day already banked and no way to end it.
    const closing = s.phase === 'closing';
    if (!closing) s.phase = 'lobby';

    GWScreens.close(true);
    setMode('idle');
    GWLoading.show({
      eyebrow: closing ? 'Doors closed' : 'Before the doors open',
      floor: '', title: closing ? 'The Yard' : 'The Yard',
      blurb: closing
        ? 'The car is running and everyone is already in it. Get in and the '
          + 'shark will want counting up.'
        : 'The loan shark is at his terminal, the shop is open, and the limo '
          + 'leaves when you get in it.',
      accent: '#d9a441', steps: 3,
    });
    await frame();

    unloadFloor();
    document.documentElement.setAttribute('data-floor', 'lobby');
    shell.stage.setEnvironment('velvet');
    GWLoading.step('Unlocking the doors');
    await frame();

    shell.level = GWLevel.buildLobby({ rng: layoutRng(-1) });
    shell.stage.group.add(shell.level.group);
    shell.stage.setLightSites(shell.level.sites);
    shell.stage.setAccent(shell.level.theme.neon);
    fogForRoom();
    shell.crew = makeCrew();
    GWLoading.step('Opening the shop');
    await frame();

    shell.player.enter(shell.level);
    setMode('world');
    el.floorTag.textContent = 'The Yard';
    GWLoading.step('Ready');
    await GWLoading.hide();
    el.resumeBtn.hidden = !!shell.touch || shell.player.locked;
    renderHud();
    shell.store.save();
    shell.floorBusy = false;
  }

  /* Getting in the limo starts the five minutes. */
  /* Getting in the car.

     Two different things depending on where the night is: at the start of a
     day it takes you to the tower, and at the end of one it settles up. The
     same door, because it is the same car. */
  function boardLimo() {
    const s = shell.store.s;
    if (s.phase === 'closing') {
      s.phase = 'report';
      shell.audio.play('door');
      setMode('idle');
      unloadFloor();
      // Settle first, render second. The two used to be the same call, so the
      // report charged the quota again every time it was re-shown.
      GWScreens.settle();
      GWScreens.show('report');
      renderHud();
      shell.store.save();
      return;
    }
    if (s.pendingItems && s.pendingItems.length) {
      const names = s.pendingItems
        .map((id) => (C.ITEMS.find((i) => i.id === id) || {}).name)
        .filter(Boolean).join(', ');
      shell.store.say('You get in without picking up the ' + names
        + '. It stays on the shelf.', 'bad');
      s.pendingItems = [];
    }
    /* The shark stakes you if you are cleaned out.

       Nobody starts a night unable to place a bet. Below the table minimum you
       cannot make a quota, cannot clear a strike and cannot come back, so one
       bad night used to end the run with most of the arrangement unplayed --
       measured at 99% of simulated runs. He tops you up to something you can
       actually play with and puts it on the book at a quarter over, which is
       both the escape hatch the game needs and exactly what a loan shark is
       for. */
    const floorTo = Math.max(C.STAKE_FLOOR, Math.round(s.quota * C.STAKE_FLOOR_QUOTA));
    if (s.bank < floorTo) {
      const front = floorTo - s.bank;
      const owed = Math.round(front * C.FRONT_MARKUP);
      s.bank += front;
      s.debt += owed;
      shell.store.say('The shark counts out ' + money(front) + ' and writes down '
        + money(owed) + '. "Go on then."', 'warn');
    }

    warned.clear();
    shell.heat.newDay();
    shell.events.newDay();
    s.timeLeft = C.DAY_SECONDS
      + (shell.store.has('stopwatch') ? 45 : 0)
      - (shell.store.sold('kidney') ? 30 : 0);
    s.challengeState = GWState.newTally();
    shell.audio.play('door');
    shell.store.say('Day ' + s.day + '. Quota is ' + money(s.quota) + '.', 'house');
    const open = C.floorsOpenOn(s.day);
    enterFloor(open[0] === undefined ? 0 : open[open.length - 1]);
  }

  async function enterFloor(index) {
    if (shell.floorBusy) return;
    shell.floorBusy = true;
    const open = shell.store.unlockedFloors();
    if (!open[index] || !open[index].open) index = 0;
    const def = C.FLOORS[index];
    const s = shell.store.s;
    s.floor = index;
    // Remember the highest floor this run has reached, so the lift keeps
    // stopping there for the rest of it.
    s.highestFloor = Math.max(s.highestFloor || 0, index);
    s.phase = 'floor';

    GWScreens.close(true);
    setMode('idle');
    GWLoading.show({
      eyebrow: index === 0 ? 'Entering the tower' : 'Now arriving',
      floor: index, title: def.name, blurb: def.blurb, accent: def.accent, steps: 4,
    });
    shell.audio.play('door');
    await frame();

    unloadFloor();
    document.documentElement.setAttribute('data-floor', def.id);
    shell.stage.setEnvironment(def.env);
    GWLoading.step('Laying the carpet');
    await frame();

    shell.level = GWLevel.build({
      floor: index, rng: layoutRng(index),
      games: C.gamesOn(index, shell.store.s.seed),
    });
    shell.stage.group.add(shell.level.group);
    shell.stage.setLightSites(shell.level.sites);
    shell.stage.setAccent(shell.level.theme.neon);
    fogForRoom();
    GWLoading.step('Building the floor');
    await frame();

    shell.heat.enterFloor();
    shell.anchors = [];
    for (const anchor of shell.level.anchors) {
      const built = buildMachine(anchor);
      if (built) shell.anchors.push(built);
    }
    shell.crew = makeCrew();
    shell.boss = GWCrew.createBoss({ level: shell.level, lib: shell.lib });
    GWLoading.step('Wheeling in the machines');
    await frame();

    shell.player.enter(shell.level);
    setMode('world');
    el.floorTag.textContent = index + ' · ' + def.name;
    GWLoading.step('Ready');
    await GWLoading.hide();

    el.resumeBtn.hidden = !!shell.touch || shell.player.locked;
    shell.store.say('Floor ' + index + '. ' + def.name + '.', 'house');
    shell.store.save();
    shell.floorBusy = false;
  }

  /* --- other people --------------------------------------------------------- */

  /* Open a table. `how` is 'local' for other windows on this computer, or
     'peer' for the hand-signalled connection to another machine; the peer link
     is handed back so the screen can drive the offer-and-answer dance. */
  function connect(how, opts) {
    disconnect();
    const name = (opts && opts.name) || 'Player';
    // What you look like travels with you: the colour out of the bath and the
    // wardrobe, not a per-session default nobody chose.
    const colour = (opts && opts.colour) !== undefined
      ? opts.colour : shell.store.meta.paint;
    let link;
    if (how === 'peer') {
      if (!GWLink.webrtcAvailable()) return null;
      link = GWLink.openPeer({ host: !!(opts && opts.host) });
    } else if (how === 'open') {
      if (!GWLink.openAvailable()) return null;
      /* The two callbacks are read by the host every few seconds to keep its
         entry on the public list honest -- a lobby that says one player when
         four are in it is worse than no list at all. */
      link = GWLink.openOpen({
        host: !!(opts && opts.host),
        lobbyId: opts && opts.lobbyId,
        name,
        onStatus: opts && opts.onStatus,
        onError: opts && opts.onError,
        // Peers, not the roster: the roster is everyone else at the table and
        // the listing counts the host as well, so `1 + roster` was right only
        // by accident and stopped being right when roster changed shape.
        countPeers: () => (shell.net ? shell.net.peers.size : 0),
        day: () => shell.store.s.day || 1,
      });
    } else {
      if (!GWLink.broadcastAvailable()) return null;
      link = GWLink.openBroadcast({});
    }
    shell.net = GWSession.create(shell, link, {
      host: !!(opts && opts.host), name, colour, worn: shell.store.meta.worn,
      onRoster: () => { syncRoster(); renderCrew(); GWScreens.refresh('table'); },
      /* Turned away because the table is full. Said, then let go of: a session
         that stays half-open looks to the player exactly like one that is
         broken, and the ticker line explaining it scrolls away. */
      onFull: () => { setTimeout(() => disconnect(), 50); },
      /* The host's seed arrived, so every room this run generates has to be
         rebuilt from it -- otherwise the two of you are stood in floors that
         only look like each other. */
      onSeed: () => {
        if (shell.mode === 'world' && shell.level) {
          if (shell.level.isLobby) enterLobby();
          else enterFloor(shell.store.s.floor);
        }
      },
    });
    shell.store.say(shell.net.isHost
      ? 'You are hosting. Anyone who joins shares your account.'
      : 'Joined. The account you are spending is theirs.', 'house');
    renderCrew();
    return link;
  }

  /* Put on what the wardrobe says.

     Three places show what you look like and all three have to agree: your own
     two hands in the corners of the screen, the body standing in the mirror at
     Nibor's, and -- over the wire -- the body everyone else is looking at.
     Called whenever the wardrobe or the bath changes anything. */
  function redress() {
    const meta = shell.store.meta;
    if (shell.hands) shell.hands.setColour(meta.paint);
    if (shell.mirror) {
      GWCrew.dressBody(shell.lib, shell.mirror, meta.worn);
      shell.mirror.setColour(meta.paint);
    }
    // Other players see the colour you climbed out of the bath in, not the
    // colour of your seat: the seat is what the rail is for.
    if (shell.net) shell.net.setLook(meta.paint, meta.worn);
    shell.store.saveMeta();
  }

  /* Copy the table into the run.

     `s.friends` is the one list the briefing, the crew rail, the report and
     the floor events all read, and it holds real players now. The session owns
     who is connected; this keeps the run's copy in step with it, so nothing
     downstream has to know whether there is a wire at all. */
  function syncRoster() {
    const s = shell.store.s;
    s.friends = shell.net ? shell.net.roster().map((p) => ({
      id: p.id, name: p.name, colour: p.colour, won: p.won || 0, at: null,
    })) : [];
  }

  function disconnect() {
    if (!shell.net) return;
    shell.net.dispose();
    shell.net = null;
    syncRoster();
    renderCrew();
    shell.store.say('You are on your own again.', 'flat');
  }

  /* A room's own stream, not the run's.

     Two reasons, and the second one only turned up with other people in the
     building. Drawing layout from the run's stream means generating a floor
     consumes numbers that the games' outcomes come out of, so how many pillars
     a room has shifts every spin after it. And a second player has to walk the
     same room as the first: derived from the run seed and the floor index, both
     machines build the same hall without exchanging a single byte about it. */
  function layoutRng(index) {
    const seed = (shell.store.s.seed ^ Math.imul(index + 7, 0x9e3779b1)) >>> 0;
    return new GWRng.Rng(seed, 0);
  }

  /* Fog sized to the room it is in.

     Pinned to one distance it is wrong in both directions: a twenty-metre far
     plane turned the lobby black three metres past the rug, and the same
     setting fogs nothing at all in a thirty-four metre hall. Scaled to the
     room, the far wall is always dim and always there. */
  /* How far you can see, which is also how much gets drawn.

     Scaled to the room, but capped. A fifty-six metre hall with the fog set to
     its own diagonal has nothing fading anywhere, so every machine on the floor
     is drawn at full detail from the far end -- 659 draw calls and 239,000
     triangles, measured, against about fifty before the floors were enlarged.
     Capped, the far end of a big room falls away into the dark, which is both
     what a casino actually looks like and the thing that makes the room feel
     big rather than merely wide. `cullDistantMachines` reads the same number,
     so a machine is only ever dropped once it has already faded out. */
  const FOG_CAP = 34;
  function fogForRoom() {
    const size = shell.level.size;
    const far = Math.min(FOG_CAP, Math.max(size.w, size.d) * 1.08);
    /* Haze the colour of the room's own signs, not the colour of its ceiling.

       Fogging to the ceiling -- a near-black maroon on the ground floor --
       meant everything past ten metres converged on the same brown, so a
       building with four deliberately different palettes came out as one
       muddy room four times. A casino at distance is the colour of what is lit
       in it, which is the neon. A quarter of the way there is enough to carry
       the floor's colour down the hall without washing the near field out. */
    const haze = new THREE.Color(shell.level.theme.ceiling)
      .lerp(new THREE.Color(shell.level.theme.neon), 0.26)
      .multiplyScalar(0.85);
    shell.stage.setFog(haze.getHex(), far * 0.34, far);

    /* And the fill takes the room's own colours.

       What bounces off a ceiling is the colour of the room, not a fixed amber:
       with one warm hemisphere over all four floors, the black-light room and
       the marble vault both drifted back towards the brown the Ground Floor is
       painted. Sky from the neon, ground from the carpet. */
    const theme = shell.level.theme;
    shell.stage.setRoomLight(
      new THREE.Color(theme.neon).lerp(new THREE.Color(0xffffff), 0.35).getHex(),
      new THREE.Color(theme.carpet).multiplyScalar(0.55).getHex(),
      1.05);
  }

  /* The man in the black suit.

     He comes out once the floor has noticed you and walks to whatever you are
     playing. Standing over a table doubles what it gains, so the answer to him
     is always to go and play somewhere else -- which is the behaviour the whole
     heat layer is trying to produce, expressed as a person rather than as a
     number. He is slower than you are, on purpose. */
  const bossTarget = new THREE.Vector3();
  function updateBoss(dt) {
    if (!shell.boss || !shell.level) return;
    const hot = shell.heat.floorHeat >= shell.heat.BOSS_FROM;
    if (hot && !shell.boss.here) {
      shell.boss.appear();
      shell.store.say('A man in a black suit steps onto the floor.', 'warn');
    }
    if (!shell.boss.here) return;

    // He heads for the machine you are at, or for you.
    let target = null;
    if (shell.mode === 'table' && shell.anchor) target = shell.anchor.anchor.stand;
    else { bossTarget.copy(shell.player.state.pos); target = hot ? bossTarget : null; }
    shell.boss.update(dt, target);

    // Which table he is stood over, if any.
    let over = null;
    for (const record of shell.anchors) {
      const p = record.anchor.position;
      const half = record.anchor.half;
      const near = Math.abs(shell.boss.position.x - p.x) < half.hw + 1.6
        && Math.abs(shell.boss.position.z - p.z) < half.hd + 1.6;
      if (near) { over = record.def.id; break; }
    }
    shell.heat.setBossAt(over);

    if (!hot && shell.boss.here) {
      // Nothing to see: he wanders back to the lift and goes.
      const d = Math.hypot(shell.boss.position.x - shell.level.lift.x,
                           shell.boss.position.z - shell.level.lift.z);
      if (d < 2) { shell.boss.leave(); shell.store.say('The suit loses interest and leaves.', 'flat'); }
    }
  }

  /* Walked off the floor.

     The one thing a hot floor can do that a hot table cannot: end your night on
     it. You keep every penny -- this is not a money punishment, it is a time
     one, which is the currency a five-minute day is actually denominated in.
     The lift still works, so a hot floor costs you the walk to another. */
  function checkWalkOut() {
    if (shell.heat.floorHeat < 1) return;
    const s = shell.store.s;
    if (shell.heat.isWalkedOut(s.floor)) return;
    shell.heat.walkedOut(s.floor);
    shell.store.say('Two of them take an elbow each. You are done on this floor tonight.', 'bad');
    shell.audio.play('alarm');
    if (shell.mode === 'table') leaveMachine();
    const open = shell.store.unlockedFloors()
      .filter((f) => f.open && !shell.heat.isWalkedOut(f.index));
    if (!open.length) {
      shell.store.say('And there is nowhere else open. That is the night.', 'bad');
      endDay();
      return;
    }
    GWScreens.show('tower');
  }

  /* Drop the machines you cannot see anyway.

     A slot cabinet is forty-odd symbol meshes and a duck race is a row of
     ducks; drawn from the far end of a hall they cost as much as they do from
     the stool in front of them and contribute a handful of fogged-out pixels.
     Anything past the fog's own far plane is switched off, so nothing ever pops
     -- by the time a machine is dropped it has already faded into the wall
     colour. three.js frustum-culls what is behind you on its own; this is for
     what is in front of you and too far away to read. */
  /* How far away a machine is still drawn.

     Not the fog's distance. A slot cabinet is forty-odd symbol meshes and a
     floor deals up to fifteen machines now; with the fog at thirty-four metres
     you can stand at the lift on Velvet Hall and see all of them at once,
     which measured 924 draw calls and a quarter of a million triangles. The
     budget here is draw calls rather than metres, so the radius tightens as a
     floor gets busier -- and it never exceeds the fog, so a machine has always
     faded most of the way out before it is dropped. */
  const MACHINE_CULL = 26;
  /* And how many are drawn at once, whatever the distance.

     A distance is the wrong budget. A slot cabinet is forty-odd symbol meshes
     and a floor deals fifteen machines, so what a radius buys depends entirely
     on which machines happen to be inside it -- measured, the same radius gave
     143 draw calls on one seed and 438 on the next. The budget is draw calls,
     so it is spent on the nearest few and the rest are switched off. Anything
     dropped is already deep in fog at this range. */
  const MACHINE_BUDGET = 10;
  const byDistance = [];
  function cullDistantMachines() {
    const far = Math.min(shell.stage.fogFar, MACHINE_CULL);
    const eye = shell.player.state.pos;
    byDistance.length = 0;
    for (const record of shell.anchors) {
      const p = record.anchor.position;
      const dx = p.x - eye.x, dz = p.z - eye.z;
      byDistance.push({ record, d2: dx * dx + dz * dz });
    }
    byDistance.sort((a, b) => a.d2 - b.d2);
    let shown = 0;
    for (const entry of byDistance) {
      const record = entry.record;
      const inRange = entry.d2 < far * far;
      record.holder.visible = inRange && shown < MACHINE_BUDGET;
      if (record.holder.visible) shown++;
      // The lamp over a table says how hot it is: warm white when nobody
      // cares, amber once they do, red when it is shut. It is the one signal
      // you can read from across the room without reading anything.
      const site = record.anchor.lampSite;
      if (site) {
        const lvl = shell.heat.level(record.def.id);
        const hot = shell.events.bonusFor(record.def.id) > 1;
        site.colour = hot ? 0x4fe07a
          : lvl === 'shut' ? 0xff3b30
          : lvl === 'short' ? 0xff9f2e
          : lvl === 'watched' ? 0xffd27a : 0xffe6c2;
        site.intensity = hot ? 62 : lvl === 'shut' ? 22 : 46;
        // The halo carries the same signal, so the colour reads from further
        // away than the pool of light on the table does.
        if (record.anchor.halo) {
          record.anchor.halo.material.color.setHex(site.colour);
          record.anchor.halo.visible = record.holder.visible;
        }
      }
    }
  }

  /* Put the friends in the room.

     After the machines, because a friend walking to the blackjack needs the
     blackjack to have an anchor to walk to; before the loading screen lifts,
     because three people fading into existence in front of you is worse than
     three people already stood there. */
  function makeCrew() {
    try {
      return GWCrew.create({
        store: shell.store, level: shell.level, lib: shell.lib,
        // The bet lands when the body gets there, however long the walk was.
      });
    } catch (err) {
      // The floor is still playable with nobody on it, and saying so beats a
      // blank screen. The friends keep betting either way.
      console.error('[gwyf] the crew did not turn up', err);
      shell.store.say('You cannot see the others from here.', 'flat');
      return null;
    }
  }

  /* Build one machine into the level at its anchor. */
  function buildMachine(anchor) {
    const def = GWGames.get(anchor.gameId);
    if (!def) return null;

    const holder = new THREE.Group();
    holder.position.copy(anchor.position);
    /* Lift the machine so its own floor meets the carpet.

       Every machine is modelled with its playing surface at y = 0 and its base
       reaching down to GWStage.FLOOR_Y -- that is the convention the twelve
       games were built to. The level's carpet is at y = 0, so dropping a
       machine in unmodified buries its base a metre underground and leaves the
       felt lying flat on the floor. */
    holder.position.y = -GWStage.FLOOR_Y;
    holder.rotation.y = anchor.rotationY;
    shell.level.group.add(holder);

    const record = { anchor, def, holder, view: null, handle: null, ctx: null };
    shell.building = record;
    const ctx = GWGames.makeContext(shell);
    record.ctx = ctx;
    try {
      record.handle = def.build(ctx);
    } catch (err) {
      /* A table that could not be built is taken off the floor.

         Leaving its anchor in place leaves a spot on the carpet that lights up
         the use prompt and then does nothing when you press it -- which is a
         worse failure than an empty patch of floor, because it looks like the
         key is broken rather than like something went wrong. */
      console.error('[gwyf] could not build ' + def.id, err);
      shell.level.group.remove(holder);
      shell.building = null;
      const i = shell.level.anchors.indexOf(anchor);
      if (i >= 0) shell.level.anchors.splice(i, 1);
      shell.store.say('The ' + def.name + ' is out of order tonight.', 'bad');
      return null;
    }
    shell.building = null;
    anchor.record = record;
    // Where to look when standing at it, in world space.
    holder.updateMatrixWorld();
    anchor.focus = record.view
      ? record.view.look.clone().applyMatrix4(holder.matrixWorld)
      : anchor.position.clone().setY(1.1);
    return record;
  }

  function mountMachine(group) {
    // During a floor build the machine goes to its holder in the level; outside
    // one (nothing does this today, but a preview would) it goes to the scene.
    const target = shell.building ? shell.building.holder : shell.stage.group;
    target.add(group);
    return group;
  }

  function setMachineView(position, look) {
    if (!shell.building) return;
    shell.building.view = {
      pos: new THREE.Vector3(position[0], position[1], position[2]),
      look: new THREE.Vector3(look[0], look[1], look[2]),
    };
  }

  function unloadFloor() {
    shell.generation++;
    cancelPrompt();
    setLive(null);
    for (const record of shell.anchors) {
      if (record.handle && record.handle.dispose) record.handle.dispose();
    }
    shell.anchors = [];
    if (shell.boss) { shell.boss.dispose(); shell.boss = null; }
    if (shell.net) shell.net.levelChanged();
    if (shell.crew) {
      shell.crew.dispose();
      shell.crew = null;
    }
    if (shell.level) {
      shell.level.dispose();
      shell.level = null;
    }
    shell.stage.setLightSites(null);
    shell.stage.clear();
    shell.game = null;
    shell.handle = null;
    shell.ctx = null;
    shell.anchor = null;
  }

  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

  /* --- walking up to a machine -------------------------------------------- */

  function updateReticle() {
    const near = shell.player.nearest;
    const inLift = shell.player.inLift();
    const aiming = !!near || inLift;
    el.app.classList.toggle('is-aiming', aiming);
    if (!aiming) { el.usePrompt.hidden = true; return; }
    el.usePrompt.hidden = false;
    if (near && near.anchor.kind === 'fixture') {
      const s = shell.store.s;
      const notes = {
        shark: 'Quota ' + money(s.quota) + ' · the day\u2019s challenge',
        shop: 'Sketchy items',
        collect: s.pendingItems && s.pendingItems.length
          ? s.pendingItems.length + ' waiting for you'
          : 'Nothing on the shelf',
        limo: 'Start the day',
      };
      el.useLabel.textContent = near.anchor.label;
      el.useNote.textContent = notes[near.anchor.action] || '';
    } else if (near && near.anchor.kind === 'friend') {
      el.useLabel.textContent = near.anchor.label;
      el.useNote.textContent = shell.store.s.shouts + ' shout'
        + (shell.store.s.shouts === 1 ? '' : 's') + ' left';
    } else if (near) {
      const def = near.anchor.record ? near.anchor.record.def : GWGames.get(near.anchor.gameId);
      el.useLabel.textContent = def ? def.name : 'Play';
      // What the table is doing right now beats what it does on average.
      const heat = def ? shell.heat.notice(def.id) : null;
      el.useNote.textContent = heat ? heat.text
        : (def ? 'house takes ' + houseEdge(def) : '');
      el.usePrompt.dataset.tone = heat ? heat.tone : '';
    } else {
      el.useLabel.textContent = 'Take the lift';
      el.useNote.textContent = 'Choose a floor';
    }
  }

  /* What to do next, and which way it is.

     Four counters in a room and no idea which one you want is a room you
     wander -- reported, not guessed. This names the next step and points at it:
     the arrow turns to the target relative to where you are facing, so it reads
     as a direction rather than as a caption. It goes away once you are close
     enough that the use prompt has taken over, because two labels for the same
     object is worse than one. */
  function nextStep() {
    const s = shell.store.s;
    if (!shell.level) return null;
    if (shell.level.isLobby) {
      // The night is over and the car is waiting: nothing else in the yard
      // matters until the shark has been counted up.
      if (s.phase === 'closing') {
        return { action: 'limo', text: 'Get in the limo — the shark wants counting up' };
      }
      if (!s.challenge) return { action: 'shark', text: 'Loan shark — take tonight\u2019s quota' };
      if (s.pendingItems && s.pendingItems.length) {
        return { action: 'collect', text: 'Pick your shopping up off the shelf' };
      }
      if (s.prizeTakenOn !== s.day) {
        return { action: 'prize', text: 'There is a ticket on top of the crates' };
      }
      return { action: 'limo', text: 'Get in the limo to start the day' };
    }
    // On a floor: play until the quota is met, then the lift is the way on.
    if (s.bank < s.quota) return { text: 'Make ' + money(s.quota - s.bank) + ' before the doors close' };
    // The lift answers from anywhere now, so this points at the button rather
    // than sending you on a walk that no longer buys anything.
    return { lift: true, text: 'Quota met — take the lift up whenever you like' };
  }

  const guideTo = new THREE.Vector3();
  function updateGuide() {
    const step = nextStep();
    if (!step || GWScreens.isOpen()) { el.guide.hidden = true; return; }

    let target = null;
    if (step.action) {
      const anchor = shell.level.anchors.find((a) => a.action === step.action);
      if (anchor) target = anchor.stand;
    } else if (step.lift) {
      guideTo.set(shell.level.lift.x, 0, shell.level.lift.z);
      target = guideTo;
    }

    // Standing at it already: the use prompt says the rest.
    const here = shell.player.state.pos;
    if (target && Math.hypot(target.x - here.x, target.z - here.z) < 2.0) {
      el.guide.hidden = true;
      return;
    }

    el.guide.hidden = false;
    if (el.guideText.textContent !== step.text) el.guideText.textContent = step.text;
    if (!target) {
      el.guideArrow.style.transform = '';
      el.guideArrow.textContent = '\u2666';
      return;
    }
    el.guideArrow.textContent = '\u2191';
    // Bearing to the target, less where the player is looking, so up is ahead.
    const bearing = Math.atan2(-(target.x - here.x), -(target.z - here.z));
    el.guideArrow.style.transform = 'rotate(' + (shell.player.state.viewYaw - bearing) + 'rad)';
  }

  function interact() {
    if (shell.mode !== 'world' || GWScreens.isOpen()) return;
    const near = shell.player.nearest;
    if (near && near.anchor.kind === 'fixture') { useFixture(near.anchor.action); return; }
    if (near && near.anchor.kind === 'friend') { shoutAt(near.anchor.mateId); return; }
    if (near && near.anchor.record) { useMachine(near.anchor.record); return; }
    if (shell.player.inLift()) { callLift(); return; }
    // Pressing use with nothing in front of you has to answer. Doing nothing at
    // all is indistinguishable from the key not working, which is what it gets
    // reported as.
    shell.audio.play('deny');
  }

  /* The shout, aimed. The Q key spends the same shout from anywhere on the
     floor; this is what happens when you walk over and use it on the person. */
  function shoutAt(mateId) {
    /* Two reasons to walk up to somebody, and the offer wins: it expires and
       the shout does not. */
    if (shell.events && shell.events.offerFrom() === mateId) {
      const share = shell.events.collectOffer();
      if (share > 0) {
        const mate = shell.store.s.friends.find((f) => f.id === mateId);
        shell.store.credit(share, (mate ? mate.name : 'They') + ' hands over '
          + money(share) + '. "Say nothing."');
        shell.audio.play('cash');
        renderHud();
        return;
      }
    }
    shell.audio.play('deny');
  }

  function useFixture(action) {
    shell.audio.play('click');
    if (action === 'shark') { GWScreens.show('shark'); return; }
    if (action === 'shop') { GWScreens.show('shop'); return; }
    if (action === 'collect') { collectItems(); return; }
    if (action === 'limo') { boardLimo(); return; }
    if (action === 'prize') { takePrize(); }
  }

  /* The ticket on top of the crates.

     The one thing in the building you get for moving well rather than for
     betting. Once a day, because a climb you can do six times is a slot
     machine with extra steps. */
  function takePrize() {
    const s = shell.store.s;
    const anchor = (shell.level.anchors || []).find((a) => a.action === 'prize');
    if (anchor && anchor.needsY !== undefined && shell.player.state.y < anchor.needsY) {
      shell.store.say('It is on top of the crates. You will have to get up there.', 'flat');
      shell.audio.play('deny');
      return;
    }
    if (s.prizeTakenOn === s.day) {
      shell.store.say('You already had that one.', 'flat');
      shell.audio.play('deny');
      return;
    }
    s.prizeTakenOn = s.day;
    shell.store.meta.tickets += 1;
    shell.store.saveMeta();
    shell.audio.play('cash');
    shell.store.say('A ticket, on top of the crates. Nobody saw you take it.', 'good');
    renderHud();
    shell.store.save();
  }

  /* Pick your purchases up off the shelf. An item you bought and left there
     does not get in the limo with you. */
  function collectItems() {
    const s = shell.store.s;
    if (!s.pendingItems || !s.pendingItems.length) {
      shell.store.say('The shelf is empty.', 'flat');
      shell.audio.play('deny');
      return;
    }
    const names = [];
    for (const id of s.pendingItems) {
      s.items[id] = 1;
      const item = C.ITEMS.find((i) => i.id === id);
      if (item) names.push(item.name);
      if (id === 'stopwatch') s.timeLeft += 45;
      if (id === 'crowbar') s.crowbarFloor = Math.min(C.FLOORS.length - 1, s.floor + 1);
    }
    s.pendingItems = [];
    shell.audio.play('cash');
    shell.store.say('You pick up the ' + names.join(', ') + '.', 'good');
    shell.store.save();
    renderHud();
  }

  /* Pull the camera back inside the walls.

     Each game declares where to watch it from, in its own space, from when a
     machine stood alone at the origin. Placed against the wall of a real room,
     a view four metres out in front of a machine standing a metre from the wall
     puts the camera three metres into the brickwork -- and what you get when
     you sit down is a close-up of the back of a wall with the machine hidden
     behind it. Slid along its own line towards the table, the shot the game
     asked for is kept and only its distance gives. */
  function keepInsideRoom(pos, look, record) {
    const size = shell.level && shell.level.size;
    if (!size) return;
    const limX = size.w / 2 - 0.75;
    const limZ = size.d / 2 - 0.75;
    let t = 1;
    for (const [p, l, lim] of [[pos.x, look.x, limX], [pos.z, look.z, limZ]]) {
      // How far along look -> pos we can travel before crossing the wall.
      if (p > lim && p !== l) t = Math.min(t, (lim - l) / (p - l));
      if (p < -lim && p !== l) t = Math.min(t, (-lim - l) / (p - l));
    }
    t = Math.max(0.15, Math.min(1, t));
    if (t < 1) {
      pos.set(look.x + (pos.x - look.x) * t,
              look.y + (pos.y - look.y) * t,
              look.z + (pos.z - look.z) * t);
    }

    /* The wall is not the only thing you can end up inside.

       Pulled back to the wall, a machine that is wide or tall swallows the
       camera: The Climb stands eight rungs high and the shot ended up among
       the rungs, and the duck race is nearly six metres of lane with only two
       and a half metres of room behind it. Backing further is not available --
       that is what the wall just said -- so the distance is made up in height
       instead. Looking down at a long lane from above it is a shot; standing
       in the middle of one is not.

       An earlier attempt simply refused to come closer than the machine's own
       size, which quietly cancelled the wall clamp and put the camera back in
       the brickwork with the machine behind it. Every table has to satisfy
       both, and height is the axis with room to give. */
    const half = (record && record.anchor && record.anchor.half) || { hw: 0.8, hd: 0.8 };
    const clear = Math.hypot(half.hw, half.hd) * 0.8 + 0.7;
    const d = Math.hypot(pos.x - look.x, pos.y - look.y, pos.z - look.z);
    if (d < clear) {
      // A little height, capped, so the camera is not standing in the machine.
      // Not all of it: at the ceiling, looking almost straight down at a five
      // metre lane is as unreadable as being inside it.
      const ceiling = (size.height || 5) - 0.8;
      pos.y = Math.min(ceiling, pos.y + Math.min(1.2, Math.sqrt(clear * clear - d * d)));
    }
  }

  /* Find a shot of the machine that something is not standing in front of.

     The room clamp keeps the camera inside the walls and says nothing about
     the pillar, or the next table in the bank, that happens to sit on the line
     between the camera and the machine. Framed, lit, and completely hidden --
     and each of those measures separately reports success, which is how
     "sometimes you click on a machine and see nothing" survived two rounds of
     fixes. Across six run seeds it was about one machine in fifty.

     Sliding the camera along its own line is not enough on its own: what is in
     the way is often in the way for the whole length of it. So the authored
     shot is tried first and, failing that, the camera is pulled in, lifted,
     and swung around the table until five test rays reach it. Same five rays
     the harness judges by, so the fix and the test cannot disagree about what
     counts as visible. Once per open, not per frame. */
  const camRay = new THREE.Raycaster();
  const camDir = new THREE.Vector3();
  const camTmp = new THREE.Vector3();
  const camInside = new THREE.Vector3();

  function clearRays(from, targets, blockers) {
    let clear = 0;
    for (const t of targets) {
      camDir.copy(t).sub(from);
      const dist = camDir.length();
      if (dist < 0.05) { clear++; continue; }
      camRay.set(from, camDir.normalize());
      camRay.far = dist - 0.05;
      if (!camRay.intersectObjects(blockers, false).length) clear++;
    }
    return clear;
  }

  function findClearShot(pos, look, record) {
    if (!shell.level) return;
    const mine = new Set();
    record.holder.traverse((o) => { if (o.isMesh) mine.add(o); });
    const blockers = [];
    shell.level.group.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.geometry || mine.has(o)) return;
      if (o.userData.person) return;      // people move; the building does not
      blockers.push(o);
    });
    if (!blockers.length) return;

    const box = machineBox(record);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const targets = [centre,
      centre.clone().add(new THREE.Vector3(size.x * 0.3, 0, size.z * 0.3)),
      centre.clone().add(new THREE.Vector3(-size.x * 0.3, 0, -size.z * 0.3)),
      centre.clone().add(new THREE.Vector3(size.x * 0.3, 0, -size.z * 0.3)),
      centre.clone().add(new THREE.Vector3(-size.x * 0.3, 0, size.z * 0.3))];

    const GOOD = 4;                       // of five rays
    const solid = (p) => {
      camInside.set(p.x, 0, p.z);
      shell.level.solids.resolve(camInside, 0.25);
      return Math.hypot(camInside.x - p.x, camInside.z - p.z) > 0.02;
    };
    if (!solid(pos) && clearRays(pos, targets, blockers) >= GOOD) return;

    // Every candidate keeps the same height-above-table relationship and the
    // same distance band; only where it stands around the table changes.
    const flat = new THREE.Vector3(pos.x - look.x, 0, pos.z - look.z);
    const reach = flat.length() || 1;
    const rise = pos.y - look.y;
    const base = Math.atan2(flat.x, flat.z);
    let best = null;
    /* Ordered by how far each candidate strays from the shot the game asked
       for: small swings before large ones, the authored distance before a
       closer or wider one, the authored height before looking down over the
       obstruction. The first clear one wins, so a table is only ever framed
       unusually when the usual way is genuinely blocked. */
    for (const swing of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.25, -1.25,
                         1.6, -1.6, 2.0, -2.0, 2.5, -2.5, Math.PI]) {
      for (const near of [1, 0.78, 1.25, 0.55]) {
        for (const lift of [1, 1.45, 2.0, 0.7]) {
          const a = base + swing;
          camTmp.set(look.x + Math.sin(a) * reach * near,
                     look.y + rise * lift,
                     look.z + Math.cos(a) * reach * near);
          keepInsideRoom(camTmp, look, record);
          /* Reject anywhere the camera would be standing inside something.

             A position inside a neighbouring cabinet blocks all five rays and
             fills the screen with the inside of a lit box -- ninety-four
             percent mean luminance, measured, which is as unreadable as the
             black rectangles were. The level's own collision world already
             knows where the solid things are; if resolving the point moves it,
             the point was inside one. */
          if (solid(camTmp)) continue;
          // And never below the felt, where the rays to the table clip the
          // carpet on the way and the shot is of a table leg.
          if (camTmp.y < look.y + 0.35) continue;
          const score = clearRays(camTmp, targets, blockers);
          if (!best || score > best.score) best = { score, at: camTmp.clone() };
          if (score >= GOOD) { pos.copy(camTmp); return; }
        }
      }
    }
    /* Last resort: over the top of it.

       A table in a room has a ceiling above it and nothing else, so a shot
       looking down from above the machine is clear whenever any shot is. It is
       not the framing the game asked for and it is only ever reached when
       every ordinary angle is genuinely obstructed -- but an unusual view of a
       machine is worth having, and a blank screen is not. */
    camTmp.set(look.x, look.y + reach * 1.05, look.z + reach * 0.32);
    keepInsideRoom(camTmp, look, record);
    const above = clearRays(camTmp, targets, blockers);
    if (!best || above > best.score) best = { score: above, at: camTmp.clone() };
    if (best) pos.copy(best.at);
  }

  /* Widen the lens until the machine fits from wherever the camera ended up.

     The room decides how far back you can stand, and against a wall that is
     often less than the shot each game was framed for. Rather than crop the
     machine or shove the camera through the plaster, the field of view opens
     until the machine's bounding sphere fits, which is what a camera operator
     does about exactly this. */
  /* The machine's own extent, without the furniture bolted to it.

     Both the framing and the clear-shot search measure a machine by its
     bounding box, and both got worse the moment a table grew a placard on its
     rail: a sign thirty centimetres above the felt and two metres out from the
     middle pushed the box out far enough to widen the lens, and at Three Cups
     it pushed a cup off the bottom of the screen -- which, since the game is
     played by clicking a cup, made the machine unplayable. Anything marked as
     trim is skipped here. It is still drawn; it is just not what the camera is
     being asked to frame. */
  const decorBox = new THREE.Box3();
  const decorTmp = new THREE.Box3();
  function machineBox(record) {
    decorBox.makeEmpty();
    record.holder.updateMatrixWorld(true);
    record.holder.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      for (let n = o; n; n = n.parent) {
        if (n.userData.trim) return;
        if (n === record.holder) break;
      }
      decorTmp.setFromObject(o);
      decorBox.union(decorTmp);
    });
    if (decorBox.isEmpty()) decorBox.setFromObject(record.holder);
    return decorBox;
  }

  function fitTableFov(record, pos) {
    const box = machineBox(record);
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const dist = pos.distanceTo(centre);
    if (!(dist > 0.01) || !(radius > 0.01)) { shell.stage.setTableFov(0); return; }
    // A tenth of slack around the edges, and the vertical angle is the one the
    // camera takes, so a wide machine in a wide window is already covered.
    const need = 2 * Math.atan((radius * 0.8) / dist) * 180 / Math.PI;
    shell.stage.setTableFov(need);
  }

  function useMachine(record) {
    if (!record.view) {
      // Every game declares one during build; if one ever does not, say so
      // rather than swallowing the keypress.
      console.error('[gwyf] ' + record.def.id + ' never declared a camera view');
      shell.store.say('Cannot get a seat at the ' + record.def.name + '.', 'bad');
      shell.audio.play('deny');
      return;
    }
    shell.game = record.def;
    shell.handle = record.handle;
    shell.ctx = record.ctx;
    shell.anchor = record;
    shell.store.s.game = record.def.id;

    setMode('table');
    record.holder.visible = true;
    record.holder.updateMatrixWorld();
    const pos = record.view.pos.clone().applyMatrix4(record.holder.matrixWorld);
    const look = record.view.look.clone().applyMatrix4(record.holder.matrixWorld);
    keepInsideRoom(pos, look, record);
    findClearShot(pos, look, record);
    fitTableFov(record, pos);
    shell.stage.frame(pos.toArray(), look.toArray(), 2.6);
    // Hang the table lamp over this table, not over the middle of the floor.
    shell.stage.setLampOver(look, pos);

    el.gameIcon.textContent = record.def.icon;
    el.gameName.textContent = record.def.name;
    el.gameBlurb.textContent = record.def.blurb;
    el.gameStatus.textContent = '';

    const opts = gameOpts(record.def.id);
    if (opts.bet === undefined || !record.def.bets.some((b) => b.id === opts.bet)) {
      opts.bet = record.def.bets[0].id;
    }
    clampStake();
    renderBets();
    renderOdds();
    shell.audio.play('chip');
    shell.store.save();
  }

  async function leaveMachine() {
    if (shell.mode !== 'table' || shell.busy) return;
    cancelPrompt();
    setLive(null);
    hideResult();
    const eye = shell.player.eye();
    const fwd = shell.player.forward();
    shell.stage.frame(eye.toArray(), [eye.x + fwd.x, eye.y + fwd.y, eye.z + fwd.z], 3.4);
    shell.game = null;
    shell.handle = null;
    shell.anchor = null;
    // Let the camera travel back before the player takes it over, or the view
    // snaps and the walk out of the machine is lost. The token guards against
    // the floor changing during the wait -- testing the mode instead is what
    // the first version did, and since nothing else had changed it, it matched
    // every time and the player was left stuck in the table view.
    const gen = shell.generation;
    await new Promise((r) => setTimeout(r, 420));
    if (gen !== shell.generation) return;
    setMode('world');
  }

  /* The lift, from anywhere.

     It used to refuse unless you were standing in the alcove, which in a
     five-minute day is a tax on the one action the tower is built around --
     you spent a fifth of the night walking north to press a button. The
     arrival screen already covers the journey, so the fiction holds: you
     press for the lift, and the next thing you see is the doors opening
     somewhere else. Standing in the alcove and pressing use does the same
     thing, for anyone who would rather walk. */
  function callLift() {
    if (shell.mode === 'table') leaveMachine();
    shell.audio.play('click');
    GWScreens.show('tower');
  }

  const houseEdge = (def) => (def.paysAsRtp
    ? (100 - def.bets[0].pays * 100).toFixed(1)
    : (Math.min.apply(null, def.bets.map((b) => GWGames.edge(b))) * 100).toFixed(1)) + '%';

  const gameOpts = (id) => {
    const s = shell.store.s;
    if (!s.gameOpts) s.gameOpts = {};
    if (!s.gameOpts[id]) s.gameOpts[id] = {};
    return s.gameOpts[id];
  };

  const currentBet = () => {
    const opts = gameOpts(shell.game.id);
    return shell.game.bets.find((b) => b.id === opts.bet) || shell.game.bets[0];
  };

  /* --- the rail ------------------------------------------------------------ */

  function renderBets() {
    const def = shell.game;
    if (!def) return;
    const opts = gameOpts(def.id);
    el.betList.innerHTML = '';
    const single = def.bets.length === 1;
    el.betList.hidden = single;

    if (!single) {
      for (const bet of def.bets) {
        const b = document.createElement('button');
        b.className = 'bet';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(bet.id === opts.bet));
        b.innerHTML = '<span><span class="bet__name"></span><span class="bet__note"></span></span>'
                    + '<span class="bet__pays"></span>';
        b.querySelector('.bet__name').textContent = bet.label;
        b.querySelector('.bet__note').textContent = bet.note || '';
        b.querySelector('.bet__pays').textContent = '×' + trim(bet.pays);
        b.addEventListener('click', () => {
          opts.bet = bet.id;
          shell.audio.play('click');
          renderBets();
        });
        el.betList.appendChild(b);
      }
    }

    el.betExtra.innerHTML = '';
    if (def.renderExtra) {
      def.renderExtra(el.betExtra, {
        opts, bet: currentBet(), store: shell.store,
        setOpt(k, v) { opts[k] = v; },
        rerender: renderBets,
      });
    }
    renderChips();
    refreshPlayButton();
  }

  function renderChips() {
    const floor = shell.store.floorLimits();
    const steps = [floor.minBet, floor.minBet * 4, floor.minBet * 20, floor.maxBet];
    el.chipRow.innerHTML = '';
    const seen = new Set();
    for (const value of steps) {
      const v = Math.min(value, floor.maxBet);
      if (seen.has(v)) continue;
      seen.add(v);
      const b = document.createElement('button');
      b.className = 'chipbtn';
      b.textContent = short(v);
      b.disabled = !shell.store.canBet(v);
      b.addEventListener('click', () => { setStake(v); shell.audio.play('chip'); });
      el.chipRow.appendChild(b);
    }
    const all = document.createElement('button');
    all.className = 'chipbtn';
    all.textContent = 'Max';
    all.addEventListener('click', () => {
      setStake(Math.min(shell.store.s.bank, floor.maxBet));
      shell.audio.play('chip');
    });
    el.chipRow.appendChild(all);
  }

  function renderOdds() {
    const def = shell.game;
    if (!def) return;
    const rows = def.oddsRows ? def.oddsRows() : def.bets.map((b) => ({
      label: b.label, pays: b.pays, prob: b.prob,
    }));
    const kit = C.edgeFor(def.id, (id) => shell.store.has(id));
    const comps = C.compsFor((id) => shell.store.has(id));
    let html = '<div class="odds__scroll"><table><thead><tr><th>Bet</th><th>Pays</th>'
             + '<th>Chance</th><th>House</th></tr></thead><tbody>';
    for (const row of rows) {
      if (row.text !== undefined) {
        html += '<tr><td>' + esc(row.label) + '</td><td colspan="3">' + esc(row.text) + '</td></tr>';
        continue;
      }
      /* Print what you will actually be paid, not what the machine pays a
         stranger. The kit and the comps both move this, and a payout table
         that is true of the building but false of the person reading it is
         worse than no table at all. */
      const pays = row.pays * (1 + kit);
      const edge = 1 - (row.prob * pays + comps);
      html += '<tr><td>' + esc(row.label) + '</td><td>×' + trim(pays)
            + (kit ? ' <span class="odds__kit">kit</span>' : '') + '</td><td>'
            + chance(row.prob) + '</td><td class="odds__edge'
            + (edge <= 0.0001 ? ' odds__edge--good' : '') + '">'
            + (edge > 0 ? (edge * 100).toFixed(1) + '%' : 'yours ' + (-edge * 100).toFixed(1) + '%')
            + '</td></tr>';
    }
    html += '</tbody></table></div><p class="odds__foot">';
    html += def.skillBased
      ? 'This one depends on how you play it. The figures assume you play it well.'
      : 'Every figure here is the one the game actually uses. Nothing is rounded in the house’s favour.';
    html += ' The house pays back ' + (comps * 100).toFixed(1)
          + '% of every stake in comps whether you win or lose, and that is in the column.';
    if (kit) {
      html += ' <b>Your kit adds ' + (kit * 100).toFixed(0) + '% to what this table pays you.</b>';
    }
    /* And the one thing that changes them. Stated in the same panel as the
       odds themselves, because a payout table that is true on average and false
       right now is worse than no table at all. */
    const factor = shell.heat.payFactor(def.id);
    if (factor < 1) {
      html += ' <b>They are watching this table: it is paying '
        + Math.round(factor * 100) + '% of the figures above until it cools. '
        + 'Play elsewhere for twenty seconds and it goes back.</b>';
    } else {
      html += ' The figures are the cold-table ones; a table they are watching pays '
        + Math.round(shell.heat.SHORT_PAYS * 100) + '% of them.';
    }
    html += '</p>';
    el.oddsPanel.innerHTML = html;
  }

  /* The rail of everyone else at the table.

     Real players only. It used to list three AI characters and their running
     totals, which is the part of this that was not the game it is copying --
     one to six people share the account and nobody else can reach it. Solo,
     the rail is empty and hidden, because a scoreboard with one name on it is
     just your own bank written twice. */
  function renderCrew() {
    const s = shell.store.s;
    el.crewList.innerHTML = '';
    el.crewList.hidden = !s.friends.length;
    for (const mate of s.friends) {
      const li = document.createElement('li');
      li.className = 'ledger__row';
      li.innerHTML = '<span class="ledger__net"></span><span class="ledger__name"></span>';
      const net = li.querySelector('.ledger__net');
      net.textContent = (mate.won >= 0 ? '+' : '\u2212') + short(Math.abs(mate.won || 0));
      net.style.color = (mate.won || 0) >= 0 ? 'var(--success)' : 'var(--danger)';
      const name = li.querySelector('.ledger__name');
      name.textContent = mate.name;
      name.style.color = mate.colour;
      li.title = whatTheyAreDoing(mate);
      el.crewList.appendChild(li);
    }
  }

  /* The long version, for the row's tooltip. The ledger itself shows a name
     and a number, because that is what you glance at.

     Read off the session rather than off the bodies in the room: the people on
     this rail are real players, and the only thing this copy of the game knows
     about where they are is the floor number in their last position packet.
     It used to ask the crew rig, which knows about the strangers and has never
     heard of them. */
  function whatTheyAreDoing(mate) {
    const peer = shell.net && shell.net.peers.get(mate.id);
    if (!peer) return 'Somewhere in the building';
    if (peer.floor === null || peer.floor === undefined) return 'In the yard';
    if (peer.floor === shell.store.s.floor) return 'On this floor';
    const def = C.FLOORS[peer.floor];
    return def ? 'On ' + def.name : 'On another floor';
  }

  function renderTicker(line) {
    const p = document.createElement('p');
    p.className = 'line line--' + line.tone;
    p.textContent = line.text;
    el.ticker.prepend(p);
    while (el.ticker.children.length > 60) el.ticker.lastChild.remove();
  }

  function renderHud() {
    const s = shell.store.s;
    setStat(el.statBank, money(s.bank));
    setStat(el.statDebt, money(s.debt));
    setStat(el.statQuota, money(s.quota));
    el.statTickets.textContent = shell.store.meta.tickets;
    el.statDay.textContent = s.day;
    el.statBank.setAttribute('aria-label', money(s.bank) + ' in the shared account');
    el.statQuota.setAttribute('aria-label', 'tonight\u2019s quota is ' + money(s.quota));

    /* The challenge card. It carries the quota when there is no challenge
       going, because the quota is the thing you are always working towards and
       an empty card in the corner is a worse answer than a useful one. */
    const met = s.quota > 0 ? s.bank >= s.quota : true;
    const pct = s.quota > 0 ? Math.min(1, s.bank / s.quota) : 1;
    const ch = s.challenge;
    el.challengeName.textContent = ch ? ch.text : 'Tonight\u2019s quota';
    el.challengeReward.textContent = ch ? '+' + ch.tickets + ' \uD83C\uDF9F' : money(s.quota);
    el.challengeNote.textContent = met
      ? (ch ? 'Quota met. The challenge is still open.' : 'Met. Anything more is yours to keep.')
      : money(s.quota - s.bank) + ' to go before the doors close.';
    el.challengeCard.classList.toggle('is-met', met);
    el.quotaFill.style.width = (pct * 100).toFixed(1) + '%';
    el.quotaFill.parentElement.classList.toggle('is-met', met);

    el.shoutCount.textContent = s.shouts;
    renderHeat();
    renderClock();
  }

  function setStat(node, text) {
    if (node.textContent === text) return;
    node.textContent = text;
    const card = node.closest('.stat');
    if (!card) return;
    card.classList.remove('is-bumped');
    void card.offsetWidth;
    card.classList.add('is-bumped');
  }

  /* How much attention the floor is paying you, as a bar under the clock.

     It is the one number the whole new layer turns on, so it is next to the
     other number the day turns on rather than tucked somewhere clever. */
  function renderHeat() {
    const h = shell.heat ? shell.heat.floorHeat : 0;
    const on = shell.store.s.phase === 'floor';
    el.heatWrap.hidden = !on;
    if (!on) return;
    el.heatFill.style.width = (h * 100).toFixed(0) + '%';
    const state = h >= 0.85 ? 'out' : h >= shell.heat.HOT_FLOOR ? 'hot'
      : h >= shell.heat.WATCHED ? 'warm' : 'cold';
    el.heatWrap.dataset.state = state;
    el.heatLabel.textContent = state === 'out' ? 'They are coming over'
      : state === 'hot' ? 'The floor is watching you'
      : state === 'warm' ? 'Somebody has noticed' : 'Nobody is watching';
  }

  /* The banner, and its countdown. Split so the text is written once when the
     event lands and only the clock is touched every frame. */
  function renderBanner(active) {
    el.banner.hidden = !active;
    if (!active) return;
    el.banner.dataset.tone = active.tone || 'good';
    el.bannerText.textContent = active.label;
    renderBannerClock();
  }

  function renderBannerClock() {
    const active = shell.events.state.active;
    if (!active) { el.banner.hidden = true; return; }
    el.bannerClock.textContent = Math.max(0, Math.ceil(active.left)) + 's';
  }

  function renderClock() {
    const t = Math.max(0, shell.store.s.timeLeft);
    const m = Math.floor(t / 60);
    const sec = Math.floor(t % 60);
    el.statClock.textContent = m + ':' + String(sec).padStart(2, '0');
    el.statClock.classList.toggle('is-low', t < 30);
  }

  /* --- stakes -------------------------------------------------------------- */

  function clampStake() {
    const floor = shell.store.floorLimits();
    setStake(Math.max(floor.minBet, Math.min(shell.stake, floor.maxBet)));
  }

  function setStake(value) {
    const floor = shell.store.floorLimits();
    const v = Math.max(floor.minBet, Math.min(Math.round(value / 25) * 25 || floor.minBet, floor.maxBet));
    shell.stake = v;
    el.stakeInput.value = v;
    refreshPlayButton();
  }

  function nudgeStake(dir) {
    const floor = shell.store.floorLimits();
    const step = Math.max(25, Math.round(shell.stake * 0.5 / 25) * 25);
    setStake(shell.stake + dir * step || floor.minBet);
    shell.audio.play('click');
  }

  function refreshPlayButton() {
    if (!shell.game) return;
    const bet = currentBet();
    const affordable = shell.store.canBet(shell.stake);
    el.btnPlay.disabled = shell.busy || !affordable;
    el.playText.textContent = shell.busy ? 'In play…' : 'Place ' + money(shell.stake);
    el.playSub.textContent = shell.busy ? ''
      : affordable
        ? (shell.game.paysAsRtp ? bet.note || '' : bet.label + ' pays ×' + trim(bet.pays))
        : 'The account will not cover that';
    for (const b of el.chipRow.querySelectorAll('.chipbtn')) {
      const v = b.textContent === 'Max' ? 0 : unshort(b.textContent);
      if (v) b.disabled = !shell.store.canBet(v);
    }
  }

  /* --- a hand -------------------------------------------------------------- */

  async function playHand() {
    if (shell.busy || !shell.game) return;
    const bet = currentBet();
    if (!shell.store.canBet(shell.stake)) { shell.audio.play('deny'); return; }
    if (!shell.heat.canPlay(shell.game.id)) {
      shell.audio.play('deny');
      shell.setStatus('Closed while they cool off. Play something else.');
      return;
    }

    // Hold on to the table this hand belongs to. Reading shell.game or shell.ctx
    // again after the awaits below is a bug: the player can walk to another
    // table mid-hand, and settling the old hand against the new table's context
    // paid out `undefined * multiplier` -- NaN, which then spreads silently
    // through the bank until every button in the building is disabled.
    const game = shell.game;
    const handle = shell.handle;
    const ctx = shell.ctx;
    const gen = shell.generation;

    shell.busy = true;
    hideResult();
    refreshPlayButton();
    // With other people at the table the account is the host's, so a stake is a
    // request rather than a subtraction. Single player, this is the same call
    // it has always been.
    if (shell.net) shell.net.stake(shell.stake);
    else shell.store.stake(shell.stake);
    shell.audio.play('chip');

    ctx.stake = shell.stake;
    ctx.totalStake = shell.stake;

    let result;
    try {
      result = await game.play(ctx, handle, bet, gameOpts(game.id));
    } catch (err) {
      // Never swallow this: the stake is already gone, so the player is owed
      // either a result or their money and an explanation.
      console.error('[gwyf] the table broke mid-hand', err);
      shell.store.credit(ctx.totalStake, 'The table jammed. Your ' + money(ctx.totalStake) + ' came back.');
      shell.audio.play('deny');
      finishHand();
      return;
    }

    if (gen !== shell.generation) {
      shell.store.credit(ctx.totalStake, 'You left mid-hand. The '
        + money(ctx.totalStake) + ' came back with you.');
      finishHand();
      return;
    }

    /* Heat is applied here, at the one place money moves, and only ever to
       the win. A shortened table pays less; it never takes more than you
       staked, because a house that could do that would be one you could not
       plan against at all. */
    const factor = shell.heat.payFactor(game.id) * shell.events.bonusFor(game.id);
    const paid = result.multiplier > 1
      ? 1 + (result.multiplier - 1) * factor
      : result.multiplier;
    if (factor !== 1 && result.multiplier > 1) {
      shell.store.say(factor > 1
        ? 'Paying over: they gave you ' + Math.round(factor * 100) + '% of the board.'
        : 'Shortened odds: they paid ' + Math.round(factor * 100) + '% of the board on that one.',
        factor > 1 ? 'good' : 'warn');
    }
    const settled = shell.net
      ? shell.net.resolve(game.id, ctx.totalStake, paid, game.name)
      : shell.store.resolve(game.id, ctx.totalStake, paid, result.detail);
    // Comped hands go unnoticed, which is the whole of what a comp is worth.
    if (shell.events.comped()) shell.events.spendComp();
    else shell.heat.played(game.id, ctx.totalStake, settled.net);
    showResult(result, settled);
    shell.store.save();
    finishHand();
  }

  function finishHand() {
    shell.busy = false;
    setLive(null);
    el.gameStatus.textContent = '';
    clearPromptBox();
    refreshPlayButton();
    renderChips();
    renderHud();
    if (shell.endAfterHand) { shell.endAfterHand = false; endDay(); }
  }

  function showResult(result, settled) {
    el.resultCard.hidden = false;
    el.resultCard.dataset.tone = result.tone || 'push';
    el.resultHeadline.textContent = result.headline || '';
    const net = settled.net;
    el.resultAmount.textContent = net > 0 ? '+' + money(net) : net < 0 ? '−' + money(-net) : 'Push';
    // Announced as well as shown: the 3D is invisible to a screen reader, so
    // this line is the only way to learn what the dice actually did.
    shell.store.say((result.headline || 'Result') + '. '
      + (net > 0 ? 'Won ' + money(net) : net < 0 ? 'Lost ' + money(-net) : 'Push'),
      net > 0 ? 'good' : net < 0 ? 'bad' : 'flat');
    clearTimeout(showResult.timer);
    showResult.timer = setTimeout(hideResult, 2600);
  }

  function hideResult() { el.resultCard.hidden = true; }

  /* --- prompts ------------------------------------------------------------- */

  /* Ask the player something mid-hand. Buttons in the rail, clickable meshes on
     the table, or both at once -- whichever answers first wins and the other is
     torn down, which is why this is one call and not two racing promises. */
  function prompt(spec) {
    cancelPrompt();
    let settle;
    const promise = new Promise((resolve) => { settle = resolve; });

    const cleanup = [];
    const done = (answer) => {
      for (const fn of cleanup) fn();
      shell.pending = null;
      clearPromptBox();
      el.stage.classList.remove('is-picking');
      settle(answer);
    };

    for (const option of (spec.options || [])) {
      const b = document.createElement('button');
      b.className = 'promptbtn' + (option.tone ? ' promptbtn--' + option.tone : '');
      b.innerHTML = '<span class="promptbtn__label"></span><span class="promptbtn__hint"></span>';
      b.querySelector('.promptbtn__label').textContent = option.label;
      b.querySelector('.promptbtn__hint').textContent = option.hint || '';
      b.addEventListener('click', () => { shell.audio.play('click'); done({ type: 'option', id: option.id }); });
      el.promptBox.appendChild(b);
    }

    if (spec.meshes && spec.meshes.length) {
      el.stage.classList.add('is-picking');
      const ray = new THREE.Raycaster();
      const point = new THREE.Vector2();
      const hit = (event) => {
        const rect = el.scene.getBoundingClientRect();
        point.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        point.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        ray.setFromCamera(point, shell.stage.camera);
        return ray.intersectObjects(spec.meshes, false)[0];
      };
      const onClick = (e) => {
        const found = hit(e);
        if (found) { shell.audio.play('click'); done({ type: 'mesh', object: found.object }); }
      };
      let hovered = null;
      const onMove = (e) => {
        const found = hit(e);
        const object = found ? found.object : null;
        if (object === hovered) return;
        if (hovered) hovered.position.y -= 0.04;
        hovered = object;
        if (hovered) { hovered.position.y += 0.04; shell.audio.play('hover'); }
      };
      el.scene.addEventListener('click', onClick);
      el.scene.addEventListener('pointermove', onMove);
      cleanup.push(() => {
        el.scene.removeEventListener('click', onClick);
        el.scene.removeEventListener('pointermove', onMove);
        if (hovered) hovered.position.y -= 0.04;
      });
    }

    shell.pending = { cancel: () => done(null), spec };
    promise.cancel = () => { if (shell.pending) shell.pending.cancel(); };
    return promise;
  }

  function cancelPrompt() { if (shell.pending) shell.pending.cancel(); }
  function clearPromptBox() { el.promptBox.innerHTML = ''; }

  function setLive(text, tone) {
    if (text === null || text === undefined) { el.liveReadout.hidden = true; return; }
    el.liveReadout.hidden = false;
    el.liveReadout.textContent = text;
    el.liveReadout.dataset.tone = tone || 'win';
  }

  /* --- shout --------------------------------------------------------------- */

  function showShout() {
    el.shoutBar.hidden = false;
    shell.audio.play('alarm');
    renderCrew();
  }
  function hideShout() {
    el.shoutBar.hidden = true;
    renderCrew();
  }

  /* --- formatting ---------------------------------------------------------- */

  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const trim = (n) => (Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2));
  const chance = (p) => (p >= 0.01 ? (p * 100).toFixed(1) + '%' : '1 in ' + Math.round(1 / p).toLocaleString('en-US'));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function short(n) {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
    if (n >= 1000) return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return '$' + Math.round(n);
  }
  function unshort(s) {
    const m = /^\$([\d.]+)([km])?$/.exec(s);
    if (!m) return 0;
    return Number(m[1]) * (m[2] === 'k' ? 1000 : m[2] === 'm' ? 1000000 : 1);
  }

  /* --- exposed to screens, games and the mod menu --------------------------- */

  Object.assign(shell, {
    prompt,
    setLive,
    interact,
    connect, disconnect,
    resume, newRun, showcase,
    title() { showcase().then(() => GWTitle.show()); },
    announce(text, tone) { shell.store.say(text, tone || 'flat'); },
    setStatus(text) { el.gameStatus.textContent = text || ''; },
    highlight() {},
    mountMachine,
    setMachineView,
    redress,
    enterFloor,
    enterLobby,
    boardLimo,
    leaveMachine,
    unloadGame: unloadFloor,
    endDay,
    renderHud,
    renderCrew,
    renderBets,
    renderOdds,
    clampStake,
    setMode,
    money, short, trim, chance,
    el,
  });
  window.GWShell = shell;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
