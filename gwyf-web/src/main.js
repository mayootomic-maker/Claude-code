/* The shell: everything that is not a game of chance.

   It owns the stage, the store, the day clock and the rail, and it is the only
   thing that moves money. A game is handed a stake and gives back a multiplier;
   the shell stakes, settles and records. That split is what keeps twelve games
   honest without twelve separate audits. */

(function () {
  'use strict';

  const C = GWConfig;
  const $ = (id) => document.getElementById(id);

  const el = {};
  const shell = {
    stage: null, lib: null, store: null, audio: null, friends: null,
    game: null, handle: null, ctx: null, busy: false, stake: 25,
    pending: null, endAfterHand: false,
    // Bumped whenever the table changes. A hand that is still in the air when
    // that happens must not settle against the table that replaced it.
    generation: 0,
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
      'shoutCount', 'rail', 'hud']) {
      el[id] = $(id);
    }
    el.stage = document.querySelector('.stage');

    if (!hasWebGL()) {
      return fail('This one needs WebGL, and this browser will not give it to us. '
        + 'Everything in here is real 3D — there is no 2D version to fall back to.');
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
      onTilt: showShout,
      onTiltResolved: hideShout,
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
    if (shell.store.s.phase === 'briefing') GWScreens.show('briefing');
    else enterFloor(shell.store.s.floor, shell.store.s.game);
    renderHud();
    renderCrew();
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

    el.btnTower.addEventListener('click', () => GWScreens.show('tower'));
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
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'F1') { e.preventDefault(); GWModMenu.toggle(); return; }
      if (e.key === 'Escape') { if (!GWScreens.close()) GWScreens.show('tower'); return; }
      if (e.key === 'b' || e.key === 'B') { GWScreens.show('shop'); return; }
      if (e.key === ' ' && !shell.busy && !GWScreens.isOpen()) { e.preventDefault(); playHand(); return; }
      if (e.key === 'q' || e.key === 'Q') { el.btnShout.click(); }
    });

    /* Reduced motion, from the operating system unless the mod menu overrides
       it. The CSS media query handles the interface; this is what carries it
       into the 3D. */
    const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const applyMotion = () => {
      const wanted = shell.store.s.mods.reducedMotion || (motion ? motion.matches : false);
      shell.stage.setReducedMotion(wanted);
    };
    if (motion && motion.addEventListener) motion.addEventListener('change', applyMotion);
    shell.applyMotion = applyMotion;
    applyMotion();

    window.addEventListener('beforeunload', () => shell.store.save());
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
      if (s.phase !== 'floor') return;
      if (s.mods.freezeClock) { shell.friends.tick(dt); return; }

      s.timeLeft -= dt;
      shell.friends.tick(dt);

      carry += dt;
      if (carry >= 0.25) { carry = 0; renderClock(); renderCrew(); }

      // Warnings on the way down. The clock itself is deliberately not a live
      // region: announcing it four times a second makes the page unusable with
      // a screen reader, which is the exact failure mode a countdown invites.
      for (const mark of WARNINGS) {
        if (s.timeLeft <= mark.at && !warned.has(mark.at)) {
          warned.add(mark.at);
          shell.store.say(mark.text, mark.tone);
          shell.audio.play(mark.at <= 10 ? 'alarm' : 'tick');
        }
      }

      if (s.timeLeft <= 0) {
        s.timeLeft = 0;
        // A hand that is already in the air finishes. Snatching the table away
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
    hideShout();
    shell.audio.play('alarm');
    unloadGame();
    // Settle first, render second. The two used to be the same call, so the
    // report charged the quota again every time it was re-shown.
    GWScreens.settle();
    GWScreens.show('report');
    renderHud();
    shell.store.save();
  }

  /* --- floors and tables --------------------------------------------------- */

  function enterFloor(index, gameId) {
    const s = shell.store.s;
    const open = shell.store.unlockedFloors();
    if (!open[index] || !open[index].open) index = 0;
    s.floor = index;
    s.phase = 'floor';
    const floor = C.FLOORS[index];
    document.documentElement.setAttribute('data-floor', floor.id);
    shell.stage.setEnvironment(floor.env);
    const id = gameId && floor.games.indexOf(gameId) >= 0 ? gameId : floor.games[0];
    loadGame(id);
  }

  function loadGame(id) {
    const def = GWGames.get(id);
    if (!def) return;
    unloadGame();

    shell.game = def;
    shell.store.s.game = id;
    shell.ctx = GWGames.makeContext(shell);
    shell.handle = def.build(shell.ctx);
    shell.stage.snap();

    el.gameIcon.textContent = def.icon;
    el.gameName.textContent = def.name;
    el.gameBlurb.textContent = def.blurb;
    el.gameStatus.textContent = '';

    const opts = gameOpts(id);
    if (opts.bet === undefined || !def.bets.some((b) => b.id === opts.bet)) opts.bet = def.bets[0].id;
    clampStake();
    renderBets();
    renderOdds();
    shell.audio.play('door');
    shell.store.save();
  }

  function unloadGame() {
    shell.generation++;
    cancelPrompt();
    setLive(null);
    if (shell.handle && shell.handle.dispose) shell.handle.dispose();
    shell.stage.clear();
    shell.handle = null;
    shell.game = null;
  }

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
    const rows = def.oddsRows ? def.oddsRows() : def.bets.map((b) => ({
      label: b.label, pays: b.pays, prob: b.prob,
    }));
    let html = '<table><thead><tr><th>Bet</th><th>Pays</th><th>Chance</th><th>House</th></tr></thead><tbody>';
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
    html += '</tbody></table><p class="odds__foot">';
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
      const at = mate.at && GWGames.get(mate.at) ? GWGames.get(mate.at).name : 'wandering';
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
    el.statBank.setAttribute('aria-label', money(s.bank) + ' in the shared account');
    el.statQuota.setAttribute('aria-label', 'tonight\u2019s quota is ' + money(s.quota));
    el.statDay.textContent = s.day;
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
    el.playText.textContent = shell.busy ? 'In play…' : (shell.game.playLabel || 'Place ' + money(shell.stake));
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
    // paid out `undefined * multiplier` -- which is NaN, and NaN spreads
    // silently through the bank until every button in the building is disabled.
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
      // The table was left before the hand finished. Hand the stake back rather
      // than paying it out somewhere it does not belong.
      shell.store.credit(ctx.totalStake, 'You walked away mid-hand. The '
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
    else checkBust();
  }

  function checkBust() {
    const s = shell.store.s;
    if (s.bank <= 0 && s.phase === 'floor') {
      shell.store.say('The account is empty. Everyone looks at everyone.', 'bad');
    }
  }

  function showResult(result, settled) {
    el.resultCard.hidden = false;
    el.resultCard.dataset.tone = result.tone || 'push';
    el.resultHeadline.textContent = result.headline || '';
    const net = settled.net;
    el.resultAmount.textContent = net > 0 ? '+' + money(net) : net < 0 ? '−' + money(-net) : 'Push';
    clearTimeout(showResult.timer);
    showResult.timer = setTimeout(hideResult, 2600);
  }

  function hideResult() { el.resultCard.hidden = true; }

  /* --- prompts ------------------------------------------------------------- */

  /* Ask the player mid-hand. Buttons in the rail, clickable meshes on the
     table, or both at once -- whichever answers first wins and the other is
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

  /* --- exposed to screens and games ---------------------------------------- */

  Object.assign(shell, {
    prompt,
    setLive,
    announce(text, tone) { shell.store.say(text, tone || 'flat'); },
    setStatus(text) { el.gameStatus.textContent = text || ''; },
    highlight() {},
    enterFloor,
    loadGame,
    unloadGame,
    endDay,
    renderHud,
    renderCrew,
    renderBets,
    renderOdds,
    clampStake,
    money, short, trim, chance,
    el,
  });
  window.GWShell = shell;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
