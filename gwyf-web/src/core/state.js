/* The run: one shared bank account, one shared debt, and everything that
   happens to them.

   Every game settles through `resolve`. That is deliberate -- items, the cursed
   chip, insurance, statistics, the ticker and the save all hang off that one
   funnel, and a game that moved money directly would quietly skip all of them. */

(function (global) {
  'use strict';

  const C = global.GWConfig;
  const RUN_KEY = 'gwyf.run.v2';
  const META_KEY = 'gwyf.meta.v2';

  function emitter() {
    const map = new Map();
    return {
      on(name, fn) {
        if (!map.has(name)) map.set(name, new Set());
        map.get(name).add(fn);
        return () => map.get(name).delete(fn);
      },
      emit(name, payload) {
        const set = map.get(name);
        if (set) for (const fn of Array.from(set)) fn(payload);
        const all = map.get('*');
        if (all) for (const fn of Array.from(all)) fn({ type: name, payload });
      },
    };
  }

  /* Progress that outlives a run. Tickets are meant to survive a wipe -- that is
     the whole reason to chase them on a day you already know is lost. */
  function loadMeta() {
    let meta = null;
    try { meta = JSON.parse(global.localStorage.getItem(META_KEY) || 'null'); } catch (e) { meta = null; }
    return Object.assign({
      tickets: 0, perks: {}, runs: 0, best: 0, endings: {}, theme: 'velvet',
      muted: false, reducedMotion: null, seenIntro: false,
      // Controls, not mods. These live with the tickets because they are a
      // property of the person playing rather than of the run, and switching
      // one must never mark a run as modded.
      look: 1.0, invertY: false, smoothing: 0, headBob: true, fov: 72,
    }, meta || {});
  }

  function saveMeta(meta) {
    try { global.localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* private mode */ }
  }

  function newRun(meta, seed) {
    const perks = meta.perks || {};
    const friends = C.FRIENDS.slice(0, perks.fourthfriend ? 4 : 3).map((f) => ({
      id: f.id, name: f.name, colour: f.colour, greed: f.greed, discipline: f.discipline,
      // Patience drains as they lose. At zero they stop asking and just bet.
      patience: 1, mood: 0, spent: 0, won: 0, at: null, cooldown: 4 + Math.random() * 4,
      pending: null, blurb: f.blurb, voice: f.voice,
    }));
    return {
      version: 2,
      seed: seed >>> 0,
      rngCalls: 0,
      day: 1,
      phase: 'briefing',
      bank: C.START_BANK + (perks.seedmoney || 0) * 500,
      debt: Math.max(0, C.START_DEBT - (perks.forgiveness || 0) * 2000),
      quota: C.quotaFor(1),
      paidToday: 0,
      strikes: 0,
      timeLeft: C.DAY_SECONDS,
      floor: 0,
      highestFloor: 0,
      crowbarFloor: -1,
      game: null,
      items: {},
      sold: {},
      shouts: C.SHOUTS_PER_DAY + (perks.extrashout || 0),
      dailyUsed: {},
      biggestLossToday: 0,
      friends,
      // Bought but not yet collected from the shop's shelf. Getting in the limo
      // without picking them up leaves them behind, which is the shop's rule in
      // the game this follows.
      pendingItems: [],
      challenge: null,
      challengeState: newTally(),
      stats: { wagered: 0, hands: 0, biggestWin: 0, biggestLoss: 0, net: 0, byGame: {} },
      modded: false,
      mods: {},
      ending: null,
      ticker: [],
    };
  }

  /* The day's own tally, which is the only thing a challenge is checked
     against. */
  function newTally() {
    return { streak: 0, bestStreak: 0, biggestWin: 0, biggestLoss: 0,
             bestMultiple: 0, hands: 0, played: {} };
  }

  function Store(state, meta) {
    this.s = state;
    this.meta = meta;
    this.bus = emitter();
    this.rng = new global.GWRng.Rng(state.seed, state.rngCalls);
    this.on = this.bus.on;
    this.emit = this.bus.emit;
  }

  Store.prototype.has = function (item) { return (this.s.items[item] || 0) > 0; };
  Store.prototype.sold = function (part) { return !!this.s.sold[part]; };

  /* A once-a-day item charge. Returns true the first time it is asked each day. */
  Store.prototype.useDaily = function (key) {
    if (this.s.dailyUsed[key]) return false;
    this.s.dailyUsed[key] = true;
    return true;
  };

  Store.prototype.floorLimits = function () {
    return C.FLOORS[this.s.floor];
  };

  /* The lift's stop list.

     Opened by the day, the way the tower does it -- a floor roughly every three
     days -- with the crowbar and the mod menu as the two ways round it. Gating
     on the bank instead meant a run that went badly never saw the building. */
  /* Which floors the lift will stop at.

     A floor you have already been to stays on the panel for the rest of the
     run. The schedule decides when the building first lets you up; it does not
     get to take a floor away again because the calendar moved on, which is
     what happened before and made the lift feel arbitrary -- you could ride to
     the Vault on day seven and find it missing from the list on day eight. */
  Store.prototype.unlockedFloors = function () {
    const s = this.s;
    const reached = s.highestFloor === undefined ? 0 : s.highestFloor;
    return C.FLOORS.map((f, i) => ({
      floor: f, index: i,
      open: s.mods.allFloors || s.day >= f.unlockDay || s.crowbarFloor >= i || i <= reached,
      opensOn: f.unlockDay,
      visited: i <= reached,
    }));
  };

  /* --- money -------------------------------------------------------------- */

  Store.prototype.canBet = function (amount) {
    return this.s.mods.infiniteMoney || amount <= this.s.bank;
  };

  Store.prototype.stake = function (amount) {
    if (!this.canBet(amount)) return false;
    if (!this.s.mods.infiniteMoney) this.s.bank -= amount;
    this.s.stats.wagered += amount;
    this.emit('bank', this.s.bank);
    return true;
  };

  /* The single settlement point. `multiplier` is the total return on the stake:
     0 loses it, 1 is a push, 2 doubles. */
  Store.prototype.resolve = function (game, stake, multiplier, detail) {
    const s = this.s;
    if (!Number.isFinite(stake) || !Number.isFinite(multiplier)) {
      // One NaN reaching the bank disables every button in the building and
      // gives no clue where it came from, so it stops here and says so.
      console.error('[gwyf] refusing a non-finite settlement', { game, stake, multiplier });
      this.say('Something went wrong settling that hand. Nothing was taken.', 'bad');
      return { game, stake: 0, multiplier: 1, net: 0, gross: 0, detail: detail || null };
    }
    let gross = stake * multiplier;

    /* The kit. Every item that names this game adds its stated percentage to
       what a win pays, in this one place, and the odds panel prints the same
       number by calling the same function. Before this the items were mostly
       flavour text and the building beat you on every machine no matter what
       you had bought, which is why a run could not be won. */
    if (gross > stake) gross *= 1 + C.edgeFor(game, (id) => this.has(id));
    if (s.mods.neverLose && gross < stake) gross = stake * 2;

    /* Comps, win or lose. Stated on every odds panel; see GWConfig.COMPS. */
    const comps = stake * C.COMPS;

    let net = gross - stake;
    // The cursed chip is not a bonus. It doubles the result in whichever
    // direction the result went, which is exactly as bad an idea as it sounds.
    if (this.has('cursedchip')) net *= 2;

    if (!s.mods.infiniteMoney) s.bank += stake + net + comps;
    if (s.bank < 0) s.bank = 0;

    s.stats.hands++;
    s.stats.net += net;
    const per = s.stats.byGame[game] || (s.stats.byGame[game] = { hands: 0, net: 0, wagered: 0 });
    per.hands++; per.net += net; per.wagered += stake;

    if (net > s.stats.biggestWin) s.stats.biggestWin = net;
    if (-net > s.stats.biggestLoss) s.stats.biggestLoss = -net;
    if (-net > s.biggestLossToday) s.biggestLossToday = -net;

    // Keep the day's tally for the loan shark's challenge. Done here, in the
    // one settlement funnel, so no game can win a challenge without the money
    // having actually moved.
    if (!s.challengeState) s.challengeState = newTally();
    const tally = s.challengeState;
    if (!detail || !detail.by) {
      tally.hands++;
      tally.played[game] = true;
      if (net > 0) { tally.streak++; tally.bestStreak = Math.max(tally.bestStreak, tally.streak); }
      else if (net < 0) tally.streak = 0;
      tally.biggestWin = Math.max(tally.biggestWin, net);
      tally.biggestLoss = Math.max(tally.biggestLoss, -net);
      if (stake > 0) tally.bestMultiple = Math.max(tally.bestMultiple, (stake + net) / stake);
    }

    const result = { game, stake, multiplier, net, gross: stake + net, detail: detail || null };
    this.emit('resolve', result);
    this.emit('bank', s.bank);
    return result;
  };

  /* Money that did not come from a bet: skimmer, refunds, the shark's mercy. */
  Store.prototype.credit = function (amount, reason) {
    this.s.bank = Math.max(0, this.s.bank + amount);
    this.emit('bank', this.s.bank);
    if (reason) this.say(reason, amount >= 0 ? 'good' : 'bad');
    return amount;
  };

  Store.prototype.say = function (text, tone, who) {
    const line = { text, tone: tone || 'flat', who: who || null, day: this.s.day, t: Date.now() };
    this.s.ticker.push(line);
    if (this.s.ticker.length > 120) this.s.ticker.shift();
    this.emit('say', line);
    return line;
  };

  /* --- persistence -------------------------------------------------------- */

  Store.prototype.save = function () {
    this.s.rngCalls = this.rng.calls;
    try { global.localStorage.setItem(RUN_KEY, JSON.stringify(this.s)); } catch (e) { /* private mode */ }
    saveMeta(this.meta);
  };

  Store.prototype.saveMeta = function () { saveMeta(this.meta); };

  Store.prototype.discard = function () {
    try { global.localStorage.removeItem(RUN_KEY); } catch (e) { /* private mode */ }
  };

  function create() {
    const meta = loadMeta();
    let saved = null;
    try { saved = JSON.parse(global.localStorage.getItem(RUN_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && saved.version === 2 && !saved.ending) {
      return new Store(saved, meta);
    }
    return new Store(newRun(meta, global.GWRng.newSeed()), meta);
  }

  function restart(store) {
    store.s = newRun(store.meta, global.GWRng.newSeed());
    store.rng = new global.GWRng.Rng(store.s.seed, 0);
    store.discard();
    store.emit('restart', store.s);
    return store;
  }

  global.GWState = { create, restart, newRun, newTally, loadMeta, saveMeta, RUN_KEY, META_KEY };
})(window);
