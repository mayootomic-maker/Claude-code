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
    player: null, level: null, anchors: [], crew: null, touch: null,
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
      'btnTower', 'btnShop', 'btnSound', 'btnMenu', 'shoutBar', 'btnShout',
      'shoutCount', 'rail', 'hud', 'reticle', 'floorTag', 'usePrompt', 'useLabel',
      'useNote', 'resumeBtn', 'leaveBtn', 'touchLayer', 'touchStick', 'touchKnob',
      'touchUse']) {
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
    shell.friends = GWFriends.create(shell.store, {
      onTilt(pending) {
        showShout();
        if (shell.crew) shell.crew.tilt(pending.mate.id, true);
      },
      onTiltResolved() {
        hideShout();
        if (shell.crew) for (const mate of shell.store.s.friends) shell.crew.tilt(mate.id, false);
      },
      // The three hooks the bodies in the room run on: where somebody is going,
      // what they said on the way, and what the table did to them.
      // Returning true is what tells friends.js to hold the bet until the body
      // gets there. Dropping the return -- as the first version did -- settles
      // every bet on a two-second timer while the walk is still going on, and
      // the friend is then reassigned mid-stride.
      onGo(mate, gameId, floorIndex) {
        return !!(shell.crew && shell.crew.go(mate.id, gameId, floorIndex));
      },
      onSay(mate, quote) {
        if (shell.crew) shell.crew.speak(mate.id, quote);
      },
      onSettled(mate, net) {
        if (shell.crew) shell.crew.settled(mate.id, net);
      },
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

    wire();
    shell.store.on('say', renderTicker);
    shell.store.on('bank', () => { renderHud(); refreshPlayButton(); });

    GWScreens.init(shell);
    GWModMenu.init(shell);

    progress(1, 'Ready.');
    el.boot.hidden = true;
    el.app.hidden = false;
    shell.stage.resize();

    startDayLoop();
    renderHud();
    renderCrew();
    const phase = shell.store.s.phase;
    if (phase === 'floor') await enterFloor(shell.store.s.floor);
    else if (phase === 'lobby') await enterLobby();
    else GWScreens.show('briefing');
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
      if (shell.mode === 'world' && !GWScreens.isOpen() && !shell.player.locked) {
        shell.player.lock();
      }
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

    el.btnShout.addEventListener('click', () => {
      if (shell.friends.shout()) { shell.audio.play('shout'); hideShout(); renderHud(); }
      else shell.audio.play('deny');
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'F1') { e.preventDefault(); GWModMenu.toggle(); return; }
      if (e.key === 'Escape') {
        if (GWScreens.close()) return;
        if (shell.mode === 'table' && !shell.busy) leaveMachine();
        return;
      }
      if (e.key === 'b' || e.key === 'B') { GWScreens.show('shop'); return; }
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
      }

      // The crew keeps moving whatever you are doing. Freezing them while you
      // are sat at a table is how you look up from the roulette and find three
      // people standing exactly where you left them.
      if (shell.crew && !GWLoading.isOpen()) {
        shell.crew.update(Math.min(dt, 0.1), shell.player.state.pos);
      }

      if (s.phase !== 'floor' || GWLoading.isOpen()) return;
      if (s.mods.freezeClock) { shell.friends.tick(dt); return; }

      s.timeLeft -= dt;
      shell.friends.tick(dt);

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

  function endDay() {
    const s = shell.store.s;
    if (s.phase !== 'floor') return;
    s.phase = 'report';
    warned.clear();
    shell.friends.reset();
    hideShout();
    shell.audio.play('alarm');
    setMode('idle');
    unloadFloor();
    // Settle first, render second. The two used to be the same call, so the
    // report charged the quota again every time it was re-shown.
    GWScreens.settle();
    GWScreens.show('report');
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
    s.phase = 'lobby';

    GWScreens.close(true);
    setMode('idle');
    GWLoading.show({
      eyebrow: 'Before the doors open',
      floor: '', title: 'The Lobby',
      blurb: 'The loan shark is at his terminal, the shop is open, and the limo '
           + 'leaves when you get in it.',
      accent: '#d9a441', steps: 3,
    });
    await frame();

    unloadFloor();
    document.documentElement.setAttribute('data-floor', 'lobby');
    shell.stage.setEnvironment('velvet');
    GWLoading.step('Unlocking the doors');
    await frame();

    shell.level = GWLevel.buildLobby({ rng: shell.store.rng });
    shell.stage.group.add(shell.level.group);
    shell.crew = makeCrew();
    GWLoading.step('Opening the shop');
    await frame();

    shell.player.enter(shell.level);
    setMode('world');
    el.floorTag.textContent = 'The Lobby';
    GWLoading.step('Ready');
    await GWLoading.hide();
    el.resumeBtn.hidden = !!shell.touch || shell.player.locked;
    renderHud();
    shell.store.save();
    shell.floorBusy = false;
  }

  /* Getting in the limo starts the five minutes. */
  function boardLimo() {
    const s = shell.store.s;
    if (s.pendingItems && s.pendingItems.length) {
      const names = s.pendingItems
        .map((id) => (C.ITEMS.find((i) => i.id === id) || {}).name)
        .filter(Boolean).join(', ');
      shell.store.say('You get in without picking up the ' + names
        + '. It stays on the shelf.', 'bad');
      s.pendingItems = [];
    }
    warned.clear();
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

    shell.level = GWLevel.build({ floor: index, rng: shell.store.rng });
    shell.stage.group.add(shell.level.group);
    GWLoading.step('Building the floor');
    await frame();

    shell.anchors = [];
    for (const anchor of shell.level.anchors) {
      const built = buildMachine(anchor);
      if (built) shell.anchors.push(built);
    }
    shell.crew = makeCrew();
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
        onArrive: (mateId) => shell.friends.arrive(mateId),
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
      console.error('[gwyf] could not build ' + def.id, err);
      shell.level.group.remove(holder);
      shell.building = null;
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
    if (shell.crew) {
      shell.crew.dispose();
      shell.crew = null;
    }
    if (shell.level) {
      shell.level.dispose();
      shell.level = null;
    }
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
      el.useNote.textContent = def ? 'house takes ' + houseEdge(def) : '';
    } else {
      el.useLabel.textContent = 'Take the lift';
      el.useNote.textContent = 'Choose a floor';
    }
  }

  function interact() {
    if (shell.mode !== 'world' || GWScreens.isOpen()) return;
    const near = shell.player.nearest;
    if (near && near.anchor.kind === 'fixture') { useFixture(near.anchor.action); return; }
    if (near && near.anchor.kind === 'friend') { shoutAt(near.anchor.mateId); return; }
    if (near && near.anchor.record) { useMachine(near.anchor.record); return; }
    if (shell.player.inLift()) callLift();
  }

  /* The shout, aimed. The Q key spends the same shout from anywhere on the
     floor; this is what happens when you walk over and use it on the person. */
  function shoutAt(mateId) {
    const pending = shell.friends.state.pending;
    if (!pending || pending.mate.id !== mateId) {
      shell.audio.play('deny');
      return;
    }
    if (shell.friends.shout()) {
      shell.audio.play('shout');
      hideShout();
      renderHud();
    } else {
      shell.audio.play('deny');
    }
  }

  function useFixture(action) {
    shell.audio.play('click');
    if (action === 'shark') { GWScreens.show('shark'); return; }
    if (action === 'shop') { GWScreens.show('shop'); return; }
    if (action === 'collect') { collectItems(); return; }
    if (action === 'limo') { boardLimo(); }
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

  function useMachine(record) {
    if (!record.view) return;
    shell.game = record.def;
    shell.handle = record.handle;
    shell.ctx = record.ctx;
    shell.anchor = record;
    shell.store.s.game = record.def.id;

    setMode('table');
    record.holder.updateMatrixWorld();
    const pos = record.view.pos.clone().applyMatrix4(record.holder.matrixWorld);
    const look = record.view.look.clone().applyMatrix4(record.holder.matrixWorld);
    shell.stage.frame(pos.toArray(), look.toArray(), 2.6);

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

  function callLift() {
    if (shell.mode === 'world' && !shell.player.inLift()) {
      shell.store.say('The lift is at the north end of the floor.', 'flat');
      shell.audio.play('deny');
      return;
    }
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
    let html = '<div class="odds__scroll"><table><thead><tr><th>Bet</th><th>Pays</th>'
             + '<th>Chance</th><th>House</th></tr></thead><tbody>';
    for (const row of rows) {
      if (row.text !== undefined) {
        html += '<tr><td>' + esc(row.label) + '</td><td colspan="3">' + esc(row.text) + '</td></tr>';
        continue;
      }
      const edge = 1 - row.prob * row.pays;
      html += '<tr><td>' + esc(row.label) + '</td><td>×' + trim(row.pays) + '</td><td>'
            + chance(row.prob) + '</td><td class="odds__edge'
            + (edge <= 0.0001 ? ' odds__edge--good' : '') + '">'
            + (edge * 100).toFixed(1) + '%</td></tr>';
    }
    html += '</tbody></table></div><p class="odds__foot">';
    html += def.skillBased
      ? 'This one depends on how you play it. The figures assume you play it well.'
      : 'Every figure here is the one the game actually uses. Nothing is rounded in the house’s favour.';
    html += '</p>';
    el.oddsPanel.innerHTML = html;
  }

  function renderCrew() {
    const s = shell.store.s;
    const pending = shell.friends.state.pending;
    el.crewList.innerHTML = '';
    for (const mate of s.friends) {
      const li = document.createElement('li');
      li.className = 'mate' + (pending && pending.mate.id === mate.id ? ' is-hot' : '');
      const game = mate.at ? GWGames.get(mate.at) : null;
      const doing = shell.crew ? shell.crew.stateOf(mate.id) : null;
      let at = game ? game.name : 'wandering';
      if (doing === 'walk') at = 'heading for the ' + (game ? game.name : 'floor');
      else if (doing === 'leaving') at = 'taking the lift';
      else if (doing === 'away') at = 'on another floor';
      else if (doing === 'idle') at = 'wandering';
      li.innerHTML = '<span class="mate__dot"></span>'
        + '<span><span class="mate__name"></span><span class="mate__where"></span></span>'
        + '<span class="mate__net"></span>';
      const dot = li.querySelector('.mate__dot');
      dot.style.background = mate.colour;
      dot.style.color = mate.colour;
      li.querySelector('.mate__name').textContent = mate.name;
      li.querySelector('.mate__where').textContent =
        pending && pending.mate.id === mate.id ? 'about to do something' : at;
      const net = li.querySelector('.mate__net');
      net.textContent = (mate.won >= 0 ? '+' : '−') + short(Math.abs(mate.won));
      net.style.color = mate.won >= 0 ? 'var(--success)' : 'var(--danger)';
      el.crewList.appendChild(li);
    }
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
    el.statQuota.setAttribute('aria-label', 'tonight’s quota is ' + money(s.quota));
    const pctDone = s.quota > 0 ? Math.min(1, s.bank / s.quota) : 1;
    el.quotaFill.style.width = (pctDone * 100).toFixed(1) + '%';
    el.quotaFill.parentElement.classList.toggle('is-met', pctDone >= 1);
    el.shoutCount.textContent = s.shouts;
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
    shell.store.stake(shell.stake);
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

    const settled = shell.store.resolve(game.id, ctx.totalStake, result.multiplier, result.detail);
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
    announce(text, tone) { shell.store.say(text, tone || 'flat'); },
    setStatus(text) { el.gameStatus.textContent = text || ''; },
    highlight() {},
    mountMachine,
    setMachineView,
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
