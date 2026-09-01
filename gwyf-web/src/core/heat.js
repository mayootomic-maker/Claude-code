/* The house watching you.

   The problem this fixes is the one underneath everything else: before it, a
   floor was a menu you walked through. Every table paid the same whether you
   had been sat at it for four minutes or four seconds, so there was no reason
   to prefer one machine over another beyond the edge printed on it, no reason
   to move, and minute four of a day played exactly like minute one.

   Heat gives the room a memory. Playing a machine warms it and winning warms
   it faster; walking away cools it. Warm enough and the house starts pushing
   back -- first by watching, then by shortening the odds on that machine, then
   by closing it. Let the whole floor get hot and you are walked out of it for
   the night with everything you have won.

   Three rules it is built on, and they are the same three the rest of the game
   is built on:

   - **Everything is published.** A shortened payout is shown on the table, in
     the odds panel and on the use prompt before you bet, never after. The
     published table is the zero-heat table; `tools/odds.mjs` audits that, and
     the panel says so.
   - **It is always escapable.** Heat only ever falls when you are away, and it
     falls faster than it rises. There is no state you can be pushed into that
     you cannot walk out of.
   - **It costs the house nothing to be honest.** The pressure comes from
     having to leave a table that is going well, not from being lied to. */

(function (global) {
  'use strict';

  /* Per hand, before winnings. Twelve or so hands at one machine is enough to
     get it watched, which is roughly a minute of play -- long enough to be a
     decision, short enough to matter inside five minutes. */
  const PER_HAND = 0.055;
  /* And again for winning, in proportion to the floor's own ceiling. Taking the
     table's maximum off it warms it about as much as four ordinary hands, so
     three big wins gets you watched and six gets you closed -- which is the
     whole design: a table that is going well is a table you have to leave. */
  const PER_WIN = 0.22;
  const MAX_PER_HAND = 0.17;   // no one result crosses more than a band
  /* A second away. Twenty-two seconds sheds a full bar and nine sheds enough to
     stop being watched, which is what the odds panel promises. */
  const COOL = 0.045;
  const COOL_CLOSED = 0.10;
  /* And what you have taken off the floor as a whole, capped: winning three
     times the quota should not be three times as damning as winning it once. */
  const FLOOR_FROM_WIN = 0.45;

  const WATCHED = 0.40;
  const SHORT = 0.65;
  const CLOSED = 0.90;
  const SHORT_PAYS = 0.90;      // what a watched machine pays, as a fraction
  const SHUT_FOR = 25;          // seconds a machine stays shut

  const HOT_FLOOR = 0.75;       // the pit boss stops being polite
  const BOSS_FROM = 0.30;       // when he comes out at all

  function create(store) {
    const state = {
      machines: {},        // gameId -> { heat, shutFor }
      floor: 0,            // 0..1
      wonHere: 0,          // net taken off this floor today
      walkedOut: {},       // floorIndex -> true
      bossNear: null,      // gameId the boss is stood at, if any
    };

    const at = (id) => state.machines[id] || (state.machines[id] = { heat: 0, shutFor: 0 });

    /* Reset for a new floor. Heat is per floor and per day: it does not follow
       you up the tower, because being thrown off the second floor for what you
       did on the first is a punishment you cannot see coming. */
    function enterFloor() {
      state.machines = {};
      state.floor = 0;
      state.wonHere = 0;
      state.bossNear = null;
    }

    function newDay() {
      enterFloor();
      state.walkedOut = {};
    }

    /* --- what the house does about it -------------------------------------- */

    function level(id) {
      const m = at(id);
      if (m.shutFor > 0) return 'shut';
      if (m.heat >= SHORT) return 'short';
      if (m.heat >= WATCHED) return 'watched';
      return 'cold';
    }

    /* The factor a machine's payouts are multiplied by right now. Always 1 or
       SHORT_PAYS, never anything in between: a payout that drifts continuously
       with a hidden number is one nobody can plan around. */
    function payFactor(id) {
      return level(id) === 'short' ? SHORT_PAYS : 1;
    }

    function canPlay(id) {
      return at(id).shutFor <= 0;
    }

    /* What to tell the player before they bet. */
    function notice(id) {
      const m = at(id);
      if (m.shutFor > 0) {
        return { tone: 'bad', text: 'Closed for ' + Math.ceil(m.shutFor) + 's — you have had too much off it' };
      }
      if (m.heat >= SHORT) {
        return { tone: 'warn', text: 'Odds shortened: pays ' + Math.round(SHORT_PAYS * 100) + '% while they watch it' };
      }
      if (m.heat >= WATCHED) return { tone: 'warn', text: 'The pit boss has noticed this table' };
      return null;
    }

    /* --- the numbers moving ------------------------------------------------- */

    /* A hand settled. `net` is what it made, which is what the house actually
       objects to. */
    function played(id, stake, net) {
      const m = at(id);
      const limits = store.floorLimits();
      const ceiling = Math.max(1, limits.maxBet);
      /* Capped per hand, so no single result can vault a whole band.

         Without it a big win took a table from cold straight to closed and the
         shortened-odds band -- the one place there is an actual decision, keep
         playing at ninety percent or walk -- was never seen at all. */
      let gain = Math.min(MAX_PER_HAND, PER_HAND + Math.max(0, net) / ceiling * PER_WIN);
      // Being stood over doubles it, which is the whole reason to walk away
      // from the man in the black suit.
      if (state.bossNear === id) gain *= 2;
      if (state.floor >= HOT_FLOOR) gain *= 1.6;
      m.heat = Math.min(1, m.heat + gain);
      if (m.heat >= CLOSED && m.shutFor <= 0) {
        m.shutFor = SHUT_FOR;
        store.say('The ' + nameOf(id) + ' closes. "Maintenance." It is not maintenance.', 'bad');
      }
      if (net > 0) state.wonHere += net;
      recompute();
    }

    function recompute() {
      const ids = Object.keys(state.machines);
      let sum = 0;
      for (const id of ids) sum += state.machines[id].heat;
      const perMachine = ids.length ? sum / ids.length : 0;
      const quota = Math.max(1, store.s.quota);
      const fromWin = Math.min(1, Math.max(0, state.wonHere) / quota) * FLOOR_FROM_WIN;
      state.floor = Math.min(1, perMachine + fromWin);
    }

    /* `atMachine` is the machine the player is stood at, which is the only one
       that does not cool. */
    function tick(dt, atMachine) {
      for (const id of Object.keys(state.machines)) {
        const m = state.machines[id];
        if (m.shutFor > 0) {
          m.shutFor = Math.max(0, m.shutFor - dt);
          m.heat = Math.max(0, m.heat - COOL_CLOSED * dt);
          if (m.shutFor === 0) store.say('The ' + nameOf(id) + ' opens again.', 'flat');
          continue;
        }
        if (id === atMachine) continue;
        m.heat = Math.max(0, m.heat - COOL * dt);
      }
      // What you took off the floor is forgiven slowly, so a big win keeps the
      // floor warm for a while even once you have left the table that paid it.
      state.wonHere = Math.max(0, state.wonHere - store.s.quota * 0.03 * dt);
      recompute();
    }

    const nameOf = (id) => {
      const def = global.GWGames && GWGames.get(id);
      return def ? def.name : id;
    };

    return {
      state,
      enterFloor, newDay, tick, played,
      level, payFactor, canPlay, notice,
      heatOf: (id) => at(id).heat,
      get floorHeat() { return state.floor; },
      /* The boss stands at a machine and doubles what it gains. Set by the
         world, which is the only thing that knows where he is. */
      setBossAt(id) { state.bossNear = id; },
      /* Somebody talked him down. */
      cool(amount) {
        for (const id of Object.keys(state.machines)) {
          state.machines[id].heat = Math.max(0, state.machines[id].heat - amount);
        }
        state.wonHere = Math.max(0, state.wonHere - store.s.quota * amount);
        recompute();
      },
      /* Warm one table by hand -- the pit doing a round. */
      warm(id, by) { at(id).heat = Math.min(1, at(id).heat + by); recompute(); },
      walkedOut(index) { state.walkedOut[index] = true; },
      isWalkedOut: (index) => !!state.walkedOut[index],
      SHORT_PAYS, WATCHED, SHORT, CLOSED, BOSS_FROM, HOT_FLOOR,
    };
  }

  global.GWHeat = { create };
})(window);
