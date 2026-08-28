/* The friends.

   This is the game. Everything else is a casino; what makes it Gamble With
   Your Friends is that the account is shared and three other people can reach
   it. They wander the tower on their own clock, pick tables, and stake real
   money out of the same balance you are trying to build.

   Their bets are settled through the same store.resolve as yours and use the
   game's own published probability, so a friend playing roulette is playing the
   roulette in this building and not a simplified version of it. What they do
   not do is play it in physics: three simultaneous simulations for tables
   nobody is looking at would cost more than the whole rest of the frame.

   They do walk. Deciding on a table and settling it in the same frame is what
   this used to do, and it made the bodies in world/crew.js liars -- the ticker
   said Mo had taken four thousand off the roulette while Mo was still stood by
   the lift. A turn is now: pick a table, say so, spend `TRAVEL` seconds getting
   to it, then bet. The money moves when the body arrives.

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

  /* How long a friend spends getting from wherever they were to the table they
     just announced, when nobody is watching them do it -- the table is upstairs,
     or there is no room drawn. When a body really is walking there, the walk
     itself is the timer and this is only the floor under it.

     `STRANDED` is the backstop for that case. A body that never arrives -- a
     table that went away under it, a route that cannot be walked -- must not
     hold a stake in limbo for the rest of the day. */
  const TRAVEL = 2.6;
  const STRANDED = 26;

  function create(store, hooks) {
    const rng = store.rng;
    const state = { pending: null, walking: [], elapsed: 0 };
    const say = (mate, quote) => { if (hooks.onSay) hooks.onSay(mate, quote); };

    function pick(kind, id) {
      const set = (LINES[kind] && LINES[kind][id]) || LINES[kind].kez;
      return set[Math.floor(rng.next() * set.length)];
    }

    /* Which tables they can reach: everything on floors the bank has opened,
       not just the floor the player is standing on. They roam.

       `weight` leans them towards wherever you are. They can play anywhere, and
       a friend upstairs still spends the account -- but the game is called
       Gamble With Your Friends, and a crew that scatters across four floors is
       one you only ever meet in the ticker. Two thirds of their turns happen in
       the room you are standing in. */
    function availableGames() {
      const open = store.unlockedFloors().filter((f) => f.open);
      const out = [];
      for (const entry of open) {
        for (const id of entry.floor.games) {
          const def = GWGames.get(id);
          if (def) out.push({ def, floor: entry.floor, index: entry.index, weight: entry.index === store.s.floor ? 6 : 1 });
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

      if (hooks.onSettled) hooks.onSettled(mate, result.net);
      const money = fmt(Math.abs(result.net));
      const quote = pick(result.net > 0 ? 'win' : 'lose', mate.id);
      say(mate, quote);
      if (result.net > 0) {
        store.say(mate.name + ' takes ' + money + ' off the ' + entry.def.name + '. ' + quote,
                  'good', mate.id);
      } else {
        store.say(mate.name + ' drops ' + money + ' on the ' + entry.def.name + '. ' + quote,
                  'bad', mate.id);
      }
      return result;
    }

    /* Put a walked-to bet through. Split out because it happens from two
       places now -- the body arriving, and the clock running out on a body that
       never will. */
    function land(job) {
      const amount = Math.min(job.amount, store.s.bank);
      if (amount <= 0) {
        store.say(job.mate.name + ' gets to the ' + job.entry.def.name
          + ' and finds the account empty.', 'bad', job.mate.id);
        return;
      }
      settle(job.mate, job.entry, job.bet, amount);
      // Set here rather than when they set off: the walk can take twenty
      // seconds across a floor, and a cooldown started at the far wall has
      // already expired by the time they reach the table.
      job.mate.cooldown = 4 + rng.next() * 6 + job.mate.discipline * 6;
    }

    function beginTurn(mate) {
      const games = availableGames();
      if (!games.length) return;
      const entry = games[rng.weighted(games.map((g) => g.weight))];
      const bet = chooseBet(entry.def, mate);
      let amount = stakeFor(mate, entry.floor);
      if (amount <= 0) return;

      // Teeth sold means they stop listening sooner, so the tilt threshold
      // moves against you. The body part has a real cost and this is it.
      const threshold = store.sold('teeth') ? 0.42 : 0.28;
      const goingBig = !store.s.mods.calmFriends
        && mate.patience < threshold && store.s.bank > entry.floor.minBet * 2;

      mate.at = entry.def.id;
      const wait = !!(hooks.onGo && hooks.onGo(mate, entry.def.id, entry.index));

      if (goingBig) {
        amount = Math.max(amount, Math.floor(store.s.bank * 0.85 / 25) * 25);
        amount = Math.min(amount, store.s.bank);
        state.pending = { mate, entry, bet, amount, left: 5.5 };
        const tilted = pick('tilt', mate.id);
        say(mate, tilted);
        store.say(mate.name + ': ' + tilted, 'warn', mate.id);
        store.say(mate.name + ' is about to put ' + fmt(amount) + ' on ' + entry.def.name
                  + ' — ' + bet.label + '.', 'warn', mate.id);
        if (hooks.onTilt) hooks.onTilt(state.pending);
        return;
      }

      const said = pick('arrive', mate.id).replace('{game}', entry.def.name);
      say(mate, said);
      if (store.has('coldread')) {
        store.say(mate.name + ': ' + said + ' (' + fmt(amount) + ' on ' + bet.label + ')', 'flat', mate.id);
      } else {
        store.say(mate.name + ': ' + said, 'flat', mate.id);
      }
      /* The bet lands when they get there, not when they decide.

         The cooldown covers the walk as well as the rest, so nobody starts a
         second turn while the first one is still crossing the floor. */
      const travel = TRAVEL * (0.8 + rng.next() * 0.6);
      state.walking.push({ mate, entry, bet, amount, left: travel, cap: STRANDED, wait });
      // The walk itself is what holds them; this is only so an abandoned job
      // cannot leave somebody standing about for the rest of the day.
      mate.cooldown = STRANDED + 4;
    }

    return {
      state,

      /* Stop the pending all-in. Costs a shout. */
      /* The body got to the table. Settle the bet it walked over to make. */
      arrive(mateId) {
        const i = state.walking.findIndex((job) => job.mate.id === mateId);
        if (i < 0) return;
        const job = state.walking[i];
        state.walking.splice(i, 1);
        land(job);
      },

      /* Wipe whatever was in flight. Called when the day ends: a tilt left
         counting down across the bell settles the next day against a bank and a
         quota that have both moved, and a friend halfway to a table on a floor
         that no longer exists never arrives at all. */
      reset() {
        if (state.pending && hooks.onTiltResolved) hooks.onTiltResolved();
        state.pending = null;
        state.walking.length = 0;
        for (const mate of store.s.friends) mate.at = null;
      },

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
        const relented = pick('stopped', p.mate.id);
        say(p.mate, relented);
        store.say(p.mate.name + ': ' + relented, 'good', p.mate.id);
        state.pending = null;
        if (hooks.onTiltResolved) hooks.onTiltResolved();
        return true;
      },

      tick(dt) {
        const s = store.s;
        if (s.phase !== 'floor') return;

        // Arrivals first, and outside the one-crisis-at-a-time gate below: a
        // friend already walking has committed, and freezing them mid-stride
        // for the length of somebody else's tilt strands them in the carpet.
        for (let i = state.walking.length - 1; i >= 0; i--) {
          const job = state.walking[i];
          job.left -= dt;
          job.cap -= dt;
          if (job.wait ? job.cap > 0 : job.left > 0) continue;
          state.walking.splice(i, 1);
          land(job);
        }

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
          // Somebody still crossing the floor does not start a second turn.
          if (state.walking.some((job) => job.mate === mate)) { mate.cooldown = 1.5; continue; }
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
