/* Things that happen to you, on a clock you do not control.

   Before this, minute four of a day played exactly like minute one: the same
   twelve machines paying the same twelve numbers until the bell. The tension
   was entirely in the countdown, and a countdown on its own is a deadline, not
   a game.

   So the floor does things. Every forty to seventy seconds one of five things
   happens, each of which asks you to change what you were about to do:

   - a table starts paying over the odds, but only for a moment, and it is
     probably across the room;
   - the pit does a round and every table gets warmer at once;
   - somebody sends drinks over and the next few hands go unnoticed;
   - a friend is up and will split it with you if you can reach them;
   - the shark's man arrives early and takes his cut whatever you are doing.

   Two rules, the same two the rest of this is built on. Every one of them is
   announced before it does anything, with the number it is going to use. And
   none of them can be waited out for a better one: the good ones need you to
   move, the bad ones happen regardless, so there is never a reason to stand
   still and see what the floor offers next. */

(function (global) {
  'use strict';

  const FIRST = 26;             // seconds into a day before anything happens
  const WARNING = 6;            // how long before one the burner phone rings
  const GAP = [40, 70];         // and between one and the next

  function create(store, hooks) {
    const rng = store.rng;
    const state = {
      next: FIRST,
      active: null,             // { id, label, note, left, tone }
      hotTable: null,           // gameId paying over the odds
      hotBonus: 1,
      comped: 0,                // hands still going unnoticed
      waiting: null,            // { mateId, left } -- a friend with an offer
    };

    /* Only the things that can actually happen here. A hot table needs a table
       on this floor; a friend with an offer needs a friend still solvent. */
    function candidates() {
      const s = store.s;
      const floor = s.floor;
      const games = global.GWConfig.gamesOn(floor, s.seed);
      const out = ['sweep', 'comps'];
      if (games.length) out.push('hot', 'hot');       // twice as likely: it is the good one
      if (s.friends.some((f) => f.won > 0)) out.push('friend');
      if (s.debt > 0 && s.bank > 400) out.push('collection');
      return out;
    }

    function fire() {
      const s = store.s;
      const pick = candidates()[Math.floor(rng.next() * candidates().length)];
      const games = global.GWConfig.gamesOn(s.floor, s.seed);

      if (pick === 'hot') {
        const id = games[Math.floor(rng.next() * games.length)];
        const def = global.GWGames.get(id);
        const bonus = 1.3;
        state.hotTable = id;
        state.hotBonus = bonus;
        set('hot', 'The ' + (def ? def.name : id) + ' is paying '
          + Math.round((bonus - 1) * 100) + '% over', 26, 'good');
        store.say('Word goes round: the ' + (def ? def.name : id) + ' is paying '
          + Math.round((bonus - 1) * 100) + '% over the board. Twenty-six seconds.', 'good');
        return;
      }

      if (pick === 'sweep') {
        const by = 0.18;
        if (hooks.onSweep) hooks.onSweep(by);
        set('sweep', 'The pit did a round — every table is warmer', 8, 'bad');
        store.say('The pit walks the floor. Every table on it is warmer by '
          + Math.round(by * 100) + '%.', 'bad');
        return;
      }

      if (pick === 'comps') {
        state.comped = 3;
        set('comps', 'Comped: the next 3 hands go unnoticed', 20, 'good');
        store.say('Drinks arrive nobody ordered. The next three hands go unnoticed.', 'good');
        return;
      }

      if (pick === 'friend') {
        const up = s.friends.filter((f) => f.won > 0);
        const mate = up[Math.floor(rng.next() * up.length)];
        const share = Math.round(mate.won * 0.5);
        state.waiting = { mateId: mate.id, left: 28, share };
        set('friend', mate.name + ' will split ' + money(share) + ' — go and find them', 28, 'good');
        store.say(mate.name + ' is up and waving you over. Half of ' + money(mate.won)
          + ' if you get there in time.', 'good');
        if (hooks.onFriendOffer) hooks.onFriendOffer(mate.id);
        return;
      }

      // collection
      const cut = Math.round(store.s.bank * 0.08);
      store.s.bank = Math.max(0, store.s.bank - cut);
      store.s.debt = Math.max(0, store.s.debt - cut);
      set('collection', 'The shark took ' + money(cut) + ' off the debt', 8, 'bad');
      store.say('A man you have not met takes ' + money(cut) + ' out of the account. '
        + 'It comes off the debt, which is the only good thing about it.', 'bad');
      if (hooks.onBank) hooks.onBank();
    }

    function set(id, label, seconds, tone) {
      state.active = { id, label, left: seconds, tone };
      if (hooks.onBanner) hooks.onBanner(state.active);
    }

    function tick(dt) {
      const s = store.s;
      if (s.phase !== 'floor') return;

      if (state.active) {
        state.active.left -= dt;
        if (state.active.left <= 0) {
          const done = state.active.id;
          state.active = null;
          if (done === 'hot') {
            state.hotTable = null;
            state.hotBonus = 1;
            store.say('The table goes back to paying what it says on it.', 'flat');
          }
          if (done === 'friend' && state.waiting) {
            const mate = s.friends.find((f) => f.id === state.waiting.mateId);
            store.say((mate ? mate.name : 'They') + ' gets bored of waving and puts it back on.', 'bad');
            state.waiting = null;
            if (hooks.onFriendOffer) hooks.onFriendOffer(null);
          }
          if (hooks.onBanner) hooks.onBanner(null);
        }
      }

      state.next -= dt;

      /* The Burner Phone. A few seconds' warning of what the floor is about to
         do, which is worth having because most of these want you somewhere
         else when they land: a sweep to be away from, a hot table to be at.
         Announced once per event rather than every frame. */
      if (state.next <= WARNING && !state.active && !state.warned
          && store.has('burnerphone') && s.timeLeft > 20) {
        state.warned = true;
        store.say('Your phone buzzes. Something is about to happen on this floor.', 'warn');
        if (hooks.onWarning) hooks.onWarning();
      }

      // Nothing new lands on top of something still running, and nothing lands
      // in the last few seconds of a day where it could not be acted on.
      if (state.next <= 0 && !state.active && s.timeLeft > 20) {
        state.next = GAP[0] + rng.next() * (GAP[1] - GAP[0]);
        state.warned = false;
        fire();
      }
    }

    function newDay() {
      state.next = FIRST;
      state.warned = false;
      state.active = null;
      state.hotTable = null;
      state.hotBonus = 1;
      state.comped = 0;
      state.waiting = null;
      if (hooks.onBanner) hooks.onBanner(null);
    }

    const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

    return {
      state, tick, newDay,
      /* What a table is paying over the odds right now, and whether this hand
         is going unnoticed. Both are read at the one place money moves. */
      bonusFor: (id) => (state.hotTable === id ? state.hotBonus : 1),
      comped: () => state.comped > 0,
      spendComp() { if (state.comped > 0) state.comped--; },
      /* The friend with an offer, if there is one and it is still open. */
      offerFrom: () => (state.waiting ? state.waiting.mateId : null),
      collectOffer() {
        if (!state.waiting) return 0;
        const share = state.waiting.share;
        state.waiting = null;
        state.active = null;
        if (hooks.onBanner) hooks.onBanner(null);
        if (hooks.onFriendOffer) hooks.onFriendOffer(null);
        return share;
      },
    };
  }

  global.GWEvents = { create };
})(window);
