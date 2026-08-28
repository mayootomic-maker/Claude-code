/* The friends.

   This is the game. Everything else is a casino; what makes it Gamble With
   Your Friends is that the account is shared and three other people can reach
   it. They wander the tower on their own clock, pick tables, and stake real
   money out of the same balance you are trying to build.

   Their bets are settled through the same store.resolve as yours and use the
   game's own published probability, so a friend playing roulette is playing the
   roulette in this building and not a simplified version of it. What they do
   not do is animate: three simultaneous physics simulations for tables nobody
   is looking at would cost more than the whole rest of the frame.

   Patience is the pressure. It falls when they lose and when the quota is close
   and unmet. Low patience means a bigger fraction of the bank on each bet, and
   under a threshold they go for the whole thing -- which is when the shout
   button appears and you have a few seconds to stop them. */

(function (global) {
  'use strict';

  const C = global.GWConfig;

  const LINES = {
    arrive: {
      mo: ['I have a feeling about {game}.', 'Right. {game}. This is the one.',
           "Don't look at me like that, {game} owes me."],
      petra: ['Taking a small one on {game}.', '{game}. Small. Sensible.',
              'I have done the arithmetic on {game}. It is bad. Playing anyway.'],
      kez: ['{game}!! {game} {game} {game}', 'oh what does this one do', 'ooh, {game}'],
      den: ['{game}. Big.', "I'm on {game}. Nobody talk to me.",
            'Found the {game}. Found the account too.'],
    },
    win: {
      mo: ['SEE. I SAID.', "That's the system working.", 'Told you. Told all of you.'],
      petra: ['Good. Stopping there.', 'That will do.', 'Banked.'],
      kez: ['WHAT', 'i have no idea what just happened', 'lmao'],
      den: ['More.', "That's a start.", 'Again.'],
    },
    lose: {
      mo: ["That's variance.", 'One more and it comes back.', 'Rigged. Obviously rigged.'],
      petra: ['As expected. Walking away.', 'Mm. Yes. That was the likely outcome.',
              'I would like it noted that I predicted this.'],
      kez: ['oops', 'was that ours', 'i think i broke it'],
      den: ["Doesn't matter.", 'Double it.', 'Nobody panic.'],
    },
    tilt: {
      mo: ['Right. Everything on this one.', "I'm going to fix this in one go.",
           'Hear me out. All of it.'],
      petra: ['I am going to do something stupid and I want that recorded.',
              'The maths says no. I am doing it anyway.'],
      kez: ['ALL OF IT', 'what happens if i press this with all the money',
            'im pressing it'],
      den: ['Taking the lot.', 'This is the one. All in.', "It's fine. I've done this before."],
    },
    stopped: {
      mo: ['...fine. FINE.', 'You are lucky I like you.', 'I had it. I had it.'],
      petra: ['Thank you. I mean it.', 'Good shout. Genuinely.'],
      kez: ['ok ok ok putting it down', 'fine!! rude'],
      den: ['You get one of those.', 'Hm.'],
    },
  };

  function create(store, hooks) {
    const rng = store.rng;
    const state = { pending: null, elapsed: 0 };

    function pick(kind, id) {
      const set = (LINES[kind] && LINES[kind][id]) || LINES[kind].kez;
      return set[Math.floor(rng.next() * set.length)];
    }

    /* Which tables they can reach: everything on floors the bank has opened,
       not just the floor the player is standing on. They roam. */
    function availableGames() {
      const open = store.unlockedFloors().filter((f) => f.open);
      const out = [];
      for (const entry of open) {
        for (const id of entry.floor.games) {
          const def = GWGames.get(id);
          if (def) out.push({ def, floor: entry.floor });
        }
      }
      return out;
    }

    function stakeFor(mate, floor) {
      const bank = store.s.bank;
      // Greed sets the appetite, patience scales it up as it drains.
      const base = 0.04 + mate.greed * 0.09;
      const desperation = 1 + (1 - mate.patience) * 2.4;
      let amount = bank * base * desperation;
      amount = Math.max(floor.minBet, Math.min(amount, floor.maxBet, bank));
      return Math.round(amount / 25) * 25;
    }

    function chooseBet(def, mate) {
      const bets = def.bets;
      if (bets.length === 1) return bets[0];
      // The disciplined take the short prices; the greedy chase the long ones.
      const weights = bets.map((b) => {
        const longshot = 1 / Math.max(b.prob, 0.01);
        return Math.pow(longshot, mate.greed * 1.4) * (mate.discipline > 0.6 ? b.prob * 2 : 1);
      });
      return bets[rng.weighted(weights)];
    }

    /* Settle a friend's bet without animating it. Uses the game's own declared
       probability and payout, so their luck is the same luck as yours. */
    function settle(mate, entry, bet, amount) {
      if (!store.stake(amount)) {
        store.say(mate.name + ' finds the account empty and stares at it.', 'bad', mate.id);
        return null;
      }
      mate.spent += amount;
      if (store.has('skimmer')) store.credit(25, null);

      let multiplier;
      if (bet.prob >= 1) {
        // A game whose single "bet" is its whole return -- slots, crash, mines.
        // Give them a spread around it rather than the mean every time, or the
        // ticker reads like a spreadsheet.
        const luck = rng.next();
        multiplier = luck < 0.42 ? 0 : (bet.pays / 0.58) * (0.4 + rng.next() * 1.6);
      } else {
        multiplier = rng.chance(bet.prob) ? bet.pays : 0;
      }
      const result = store.resolve(entry.def.id, amount, multiplier, { by: mate.id });
      mate.won += result.net;
      mate.patience = Math.max(0, Math.min(1, mate.patience + (result.net > 0 ? 0.28 : -0.20)));
      mate.mood = result.net > 0 ? 1 : -1;

      const money = fmt(Math.abs(result.net));
      if (result.net > 0) {
        store.say(mate.name + ' takes ' + money + ' off the ' + entry.def.name + '. ' + pick('win', mate.id),
                  'good', mate.id);
      } else {
        store.say(mate.name + ' drops ' + money + ' on the ' + entry.def.name + '. ' + pick('lose', mate.id),
                  'bad', mate.id);
      }
      return result;
    }

    function beginTurn(mate) {
      const games = availableGames();
      if (!games.length) return;
      const entry = games[Math.floor(rng.next() * games.length)];
      const bet = chooseBet(entry.def, mate);
      let amount = stakeFor(mate, entry.floor);
      if (amount <= 0) return;

      // Teeth sold means they stop listening sooner, so the tilt threshold
      // moves against you. The body part has a real cost and this is it.
      const threshold = store.sold('teeth') ? 0.42 : 0.28;
      const goingBig = !store.s.mods.calmFriends
        && mate.patience < threshold && store.s.bank > entry.floor.minBet * 2;

      if (goingBig) {
        amount = Math.max(amount, Math.floor(store.s.bank * 0.85 / 25) * 25);
        amount = Math.min(amount, store.s.bank);
        state.pending = { mate, entry, bet, amount, left: 5.5 };
        store.say(mate.name + ': ' + pick('tilt', mate.id), 'warn', mate.id);
        store.say(mate.name + ' is about to put ' + fmt(amount) + ' on ' + entry.def.name
                  + ' — ' + bet.label + '.', 'warn', mate.id);
        if (hooks.onTilt) hooks.onTilt(state.pending);
        return;
      }

      const said = pick('arrive', mate.id).replace('{game}', entry.def.name);
      if (store.has('coldread')) {
        store.say(mate.name + ': ' + said + ' (' + fmt(amount) + ' on ' + bet.label + ')', 'flat', mate.id);
      } else {
        store.say(mate.name + ': ' + said, 'flat', mate.id);
      }
      mate.at = entry.def.id;
      settle(mate, entry, bet, amount);
      mate.cooldown = 7 + rng.next() * 9 + mate.discipline * 8;
    }

    return {
      state,

      /* Stop the pending all-in. Costs a shout. */
      shout() {
        const p = state.pending;
        if (!p) return false;
        if (store.s.shouts <= 0) {
          store.say('You shout. Nothing comes out. You are out of shouts.', 'bad');
          return false;
        }
        store.s.shouts--;
        p.mate.patience = Math.min(1, p.mate.patience + 0.55);
        p.mate.cooldown = 12 + rng.next() * 8;
        store.say(p.mate.name + ': ' + pick('stopped', p.mate.id), 'good', p.mate.id);
        state.pending = null;
        if (hooks.onTiltResolved) hooks.onTiltResolved();
        return true;
      },

      tick(dt) {
        const s = store.s;
        if (s.phase !== 'floor') return;

        if (state.pending) {
          state.pending.left -= dt;
          if (state.pending.left <= 0) {
            const p = state.pending;
            state.pending = null;
            if (hooks.onTiltResolved) hooks.onTiltResolved();
            store.say('Nobody stops ' + p.mate.name + '.', 'warn', p.mate.id);
            settle(p.mate, p.entry, p.bet, Math.min(p.amount, s.bank));
            p.mate.cooldown = 14 + rng.next() * 8;
          }
          return;   // one crisis at a time
        }

        if (s.mods.quietFriends) return;

        // Everyone gets impatient as the quota deadline closes in on a shortfall.
        const shortfall = Math.max(0, s.quota - s.bank);
        const pressure = shortfall > 0 && s.timeLeft < 90 ? dt * 0.035 : 0;

        for (const mate of s.friends) {
          mate.patience = Math.max(0, mate.patience - pressure);
          mate.cooldown -= dt;
          if (mate.cooldown <= 0) {
            mate.cooldown = 6 + rng.next() * 8;
            if (s.bank <= 0) {
              store.say(mate.name + ' checks the balance and goes quiet.', 'bad', mate.id);
              continue;
            }
            beginTurn(mate);
            break;    // at most one friend acts per frame
          }
        }
      },
    };
  }

  const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');

  global.GWFriends = { create, LINES };
})(window);
