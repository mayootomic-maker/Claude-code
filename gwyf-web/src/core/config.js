/* Every tunable number in the game, in one file.

   Prices, odds, quotas and payouts live here rather than next to the code that
   uses them so that the whole economy can be read at once and checked. The
   Monte Carlo test in tools/odds.mjs reads the same tables, so a payout that
   drifts from its stated house edge fails the build rather than the player. */

(function (global) {
  'use strict';

  const DAY_SECONDS = 300;          // the loan shark's five minutes
  const TOTAL_DAYS = 12;            // the length of the arrangement
  const START_DEBT = 4000;
  const START_BANK = 2400;
  const INTEREST = 0.04;            // compounded at the end of every day
  const MAX_STRIKES = 3;

  /* The quota climbs, but it has to stay inside what a good night can pay.

     It used to be 700 at 1.62 a day, which reaches $141,175 by day twelve --
     from a $500 bank, on machines that all take a cut. Simulated four thousand
     times (tools/economy.mjs), that run was lost 100% of the time and lost by
     day three in the median, so nine days of the arrangement were ceremony.
     A quota can only be a threat if it is nearly payable. */
  function quotaFor(day) {
    return Math.round(350 * Math.pow(1.12, day - 1) / 25) * 25;
  }

  /* What a floor can put out, and how many of them it does.

     A floor used to name four machines and stand exactly those four every time
     you rode to it, which made the tower four rooms you had already seen. It
     names a pool now and deals a hand from it -- drawn from the run seed and
     the floor number, so it is the same floor for everyone at the table and
     the same floor if you reload, but a different one next run.

     Pools overlap on purpose. The same wheel stands on the ground floor and in
     Velvet Hall at ten times the limits, which is what a real casino does with
     a game people like; and it means a floor whose pool is thin still has
     somewhere to send you when the pit shuts a table.

     `gamesOn` is the one place this is resolved. Nothing reads `.pool`
     directly, so a floor's hand cannot disagree with itself between the lift
     panel, the level builder and the odds. */
  const FLOORS = [
    {
      /* Not "The Lobby". That is the room you start the day in, and having two
         different rooms with the same name printed in the same corner of the
         screen is how you get a player who cannot tell whether they have gone
         anywhere. */
      id: 'lobby', name: 'The Ground Floor', env: 'velvet', unlockBank: 0, unlockDay: 1,
      tag: 'Ground floor', accent: '#e0913f',
      blurb: 'Sticky carpet, free peanuts, and the only games in the building that '
           + 'will not take your whole night in one go.',
      pool: ['coinflip', 'dice', 'slots', 'duckrace', 'wheel', 'cups', 'scratcher', 'war'],
      deal: 5,
      minBet: 25, maxBet: 500,
    },
    {
      id: 'velvet', name: 'Velvet Hall', env: 'crimson', unlockBank: 2500, unlockDay: 4,
      tag: 'Second floor', accent: '#ff3fd0',
      blurb: 'Where the carpet stops being sticky and the drinks stop being free. '
           + 'The tables here have a croupier and a memory.',
      pool: ['roulette', 'blackjack', 'highlow', 'plinko', 'wheel', 'war', 'cups', 'slots'],
      deal: 5,
      minBet: 100, maxBet: 2500,
    },
    {
      id: 'vault', name: 'The Vault', env: 'emerald', unlockBank: 12000, unlockDay: 7,
      tag: 'Third floor', accent: '#8fe6ff',
      blurb: 'No windows, no clocks, no exit signs. The house keeps the odds in '
           + 'a safe down here and it does not open it for you.',
      pool: ['crash', 'mines', 'ladder', 'plinko', 'roulette', 'blackjack', 'highlow'],
      deal: 4,
      minBet: 250, maxBet: 10000,
    },
    {
      id: 'penthouse', name: 'The Penthouse', env: 'void', unlockBank: 45000, unlockDay: 10,
      tag: 'Top floor', accent: '#e8c46a',
      blurb: 'One game. It does not have a house edge because it does not need one.',
      pool: ['chamber', 'crash', 'mines', 'ladder', 'roulette'],
      deal: 3,
      minBet: 1000, maxBet: 100000,
    },
  ];

  /* Sketchy items. Every one of them does something mechanical -- there are no
     items here whose only effect is a line of flavour text. */
  /* The kit, and why it is the whole game.

     Every machine in the building takes a cut, so a player with nothing in
     their pockets loses in expectation on every hand and no amount of clever
     play fixes that -- it is arithmetic, and it is what made an earlier
     version of this unwinnable in 100% of simulated runs. What turns the
     corner is equipment. An item names a machine and a percentage it adds to
     that machine's payouts, the shop prints it, the odds panel prints the
     boosted number, and `edgeFor` below is the single place it is applied.

     So the decision the game is actually about: spend the bank on kit and be
     poorer tonight but ahead of the house tomorrow, or keep it and stay level
     with a machine that is quietly beating you. */
  const ITEMS = [
    { id: 'rabbitsfoot', name: "Rabbit's Foot", price: 220, icon: '🐇',
      edge: { all: 0.02 },
      desc: 'Every payout in the building pays 2% more. Small, permanent, boring, good.' },
    { id: 'luckycoin', name: 'Two-Headed Coin', price: 260, icon: '🪙',
      edge: { coinflip: 0.06 },
      desc: 'The coin toss comes up your way 55% of the time, and pays 6% more when it does.' },
    { id: 'loadeddice', name: 'Loaded Dice', price: 280, icon: '🎲',
      edge: { dice: 0.07 },
      desc: 'One losing dice roll per day is quietly rolled again — worth about 7% on the dice.' },
    { id: 'markeddeck', name: 'Marked Deck', price: 380, icon: '🃏',
      edge: { highlow: 0.08, blackjack: 0.05 },
      desc: "Card games show you the next card's colour: 8% on High-Low, 5% on blackjack." },
    { id: 'magnet', name: 'Pocket Magnet', price: 320, icon: '🧲',
      edge: { plinko: 0.07 },
      desc: 'Plinko balls drift one peg outward, where the money is. Worth 7% on the board.' },
    { id: 'stopwatch', name: 'Fixed Stopwatch', price: 550, icon: '⏱️',
      desc: 'Adds 45 seconds to every day. The shark has not noticed yet.' },
    { id: 'staticcling', name: 'Static Cling', price: 420, icon: '⚡',
      edge: { roulette: 0.07 },
      desc: 'A roulette bet that misses by one pocket is paid as if it hit. Worth 7% at the wheel.' },
    { id: 'insurance', name: 'Insurance Policy', price: 700, icon: '📄',
      desc: 'Refunds half of your single largest loss each day. Read the small print.' },
    { id: 'coldread', name: 'Cold Read', price: 750, icon: '👁️',
      desc: 'You see what a friend is about to bet before they bet it.' },
    { id: 'skimmer', name: 'Chip Skimmer', price: 800, icon: '🪝',
      desc: 'Skims $25 into the bank every time a friend plays anything.' },
    { id: 'secondwind', name: 'Second Wind', price: 560, icon: '🔁',
      edge: { slots: 0.09, crash: 0.05 },
      desc: 'A losing spin gets spun again, free: 9% on the drums, 5% on the climb.' },
    { id: 'crowbar', name: 'Crowbar', price: 1200, icon: '🔧',
      desc: 'Opens the next floor up for the rest of today, whatever the bank says.' },
    { id: 'repellent', name: 'Shark Repellent', price: 1500, icon: '🦈',
      desc: 'Daily interest on the debt drops from 8% to 5%. Permanently.' },
    { id: 'earplugs', name: 'Wax Earplugs', price: 300, icon: '🕯️',
      desc: 'Your friends can no longer talk you into a bet you did not choose.' },
    { id: 'ducttape', name: 'Duct Tape', price: 250, icon: '🩹',
      desc: 'The next time the shark takes something, it takes this instead.' },
    { id: 'cursedchip', name: 'Cursed Chip', price: 100, icon: '💀',
      desc: 'Every win doubles. Every loss doubles. There is no way to put it down.' },
  ];

  /* Tickets are the slow currency: they persist across a wipe, so a run that
     ends badly still moves the next one forward. */
  const TICKET_SHOP = [
    { id: 'seedmoney', name: 'Seed Money', cost: 3, repeat: true,
      desc: 'Start every run with another $500 in the account.' },
    { id: 'extrashout', name: 'Louder Voice', cost: 2, repeat: true, max: 3,
      desc: 'One more shout per day to talk a friend off a cliff.' },
    { id: 'prosthetic', name: 'Prosthetic', cost: 4, repeat: true,
      desc: 'Grows back one thing the shark took. It is not the same, but it works.' },
    { id: 'fourthfriend', name: 'A Fourth Friend', cost: 5, repeat: false,
      desc: 'Den joins the crew. More hands on the money, for better and for worse.' },
    { id: 'forgiveness', name: 'Paperwork Error', cost: 6, repeat: true,
      desc: 'Two thousand dollars falls off the debt. Nobody asks about it.' },
  ];

  /* Selling a piece of yourself is the game's fastest money and its only
     irreversible decision, so every one of these has a real mechanical cost. */
  const BODY_PARTS = [
    { id: 'eye', name: 'Your left eye', cash: 1200, tickets: 3,
      cost: 'Slot reels and plinko no longer show you what is coming.' },
    { id: 'kidney', name: 'A kidney', cash: 2000, tickets: 4,
      cost: 'Thirty seconds off every day, forever.' },
    { id: 'teeth', name: 'Most of your teeth', cash: 700, tickets: 2,
      cost: 'Your friends stop listening as fast. They tilt sooner.' },
    { id: 'finger', name: 'A little finger', cash: 900, tickets: 2,
      cost: 'One fewer shout per day.' },
  ];

  const FRIENDS = [
    { id: 'mo', name: 'Mo', colour: '#e9b44c', greed: 0.72, discipline: 0.30,
      voice: 'all-in merchant', blurb: 'Believes in streaks. Has never seen one end.' },
    { id: 'petra', name: 'Petra', colour: '#5cd98c', greed: 0.34, discipline: 0.78,
      voice: 'the careful one', blurb: 'Counts. Quietly disapproves. Usually right.' },
    { id: 'kez', name: 'Kez', colour: '#6fa8dc', greed: 0.55, discipline: 0.48,
      voice: 'agent of chaos', blurb: 'Plays whatever is nearest and loudest.' },
    { id: 'den', name: 'Den', colour: '#f0616d', greed: 0.88, discipline: 0.16,
      voice: 'a problem', blurb: 'Should not be here. Was not invited. Has the account number.' },
  ];

  const SHOUTS_PER_DAY = 3;

  /* What the kit adds to one game's payouts, as a fraction. Read by the store
     when a hand settles and by the odds panel when it prints a payout, so the
     number on screen is the number you are paid. */
  function edgeFor(gameId, has) {
    let bonus = 0;
    for (const item of ITEMS) {
      if (!item.edge || !has(item.id)) continue;
      if (item.edge.all) bonus += item.edge.all;
      if (item.edge[gameId]) bonus += item.edge[gameId];
    }
    return bonus;
  }

  /* Comps.

     The house pays a little of every stake back whatever happens, the way
     every real casino does, and it is stated on the odds panel rather than
     hidden. It exists because without it the floor is a slope in one
     direction: with the kit it is the difference between grinding downhill
     slowly and being able to hold your ground while you save for the next
     item. */
  const COMPS = 0.02;

  /* What the shark fronts you when you are cleaned out.

     Nobody is ever unable to place a bet. Below this the table minimum is out
     of reach, and a player who cannot bet cannot make a quota, cannot clear a
     strike and cannot come back -- an absorbing state that ended 99% of
     simulated runs early with most of the arrangement unplayed. He tops you up
     to here at the start of a day and adds it to the book at a quarter over,
     which is both the mechanically necessary escape hatch and precisely what a
     loan shark is for. */
  const STAKE_FLOOR = 400;
  const STAKE_FLOOR_QUOTA = 1.8;   // ...or this much of tonight's quota, whichever is more
  const FRONT_MARKUP = 1.25;

  /* The loan shark's daily challenge.

     Offered at his terminal in the lobby and only worth tickets if it is
     accepted before you get in the limo -- which is the point of it: it asks
     you to plan the day around a machine you might not have chosen, and the
     tickets are the only currency that survives a wipe.

     Each one is checked against the day's own tally, kept in
     state.challengeState, so a challenge cannot be verified by anything except
     what actually happened. */
  const CHALLENGES = [
    { id: 'streak', tickets: 2, text: 'Win three hands in a row',
      check: (t) => t.bestStreak >= 3 },
    { id: 'bigwin', tickets: 2, text: 'Take $2,000 or more off a single hand',
      check: (t) => t.biggestWin >= 2000 },
    { id: 'tour', tickets: 2, text: 'Play every machine on the floor',
      check: (t, floor, met, s) => gamesOn(s ? s.floor : 0, s ? s.seed : 0)
        .every((g) => t.played[g]) },
    { id: 'careful', tickets: 3, text: 'Hit the quota without losing more than $500 on any hand',
      check: (t, floor, met) => met && t.biggestLoss <= 500 },
    { id: 'volume', tickets: 2, text: 'Play twelve hands',
      check: (t) => t.hands >= 12 },
    { id: 'double', tickets: 3, text: 'Turn one hand into four times its stake',
      check: (t) => t.bestMultiple >= 4 },
  ];

  /* Which floors the lift will stop at. In the game this port follows, the
     tower opens on a schedule -- roughly a floor every three days -- rather
     than on how rich you are, so a bad run still sees the whole building. */
  /* The hand a floor is showing, for a given run.

     Deterministic in (seed, floor): two players in the same run build the same
     room without exchanging a byte about it, which is the same guarantee the
     level layout relies on. A tiny xorshift rather than the run's own RNG
     stream, because consuming numbers from that stream here would shift every
     spin that follows -- which is the bug that made a floor's layout change
     the outcome of the next hand. */
  function gamesOn(floorIndex, seed) {
    const def = FLOORS[floorIndex];
    if (!def) return [];
    if (!def.pool) return def.games || [];
    let x = ((seed >>> 0) ^ Math.imul(floorIndex + 11, 0x9e3779b1)) >>> 0 || 1;
    const rand = () => {
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5; x >>>= 0;
      return x / 4294967296;
    };
    /* Let the state mix before anything reads it.

       Xorshift seeded from small, near-consecutive integers produces
       near-identical first outputs, and the first output is the one that
       decides the first swap of the shuffle. The visible symptom was that the
       last game in a pool was never dealt: across eleven consecutive seeds,
       War did not appear on the ground floor once. Eight discarded values is
       enough to decorrelate it. */
    for (let i = 0; i < 8; i++) rand();
    const pool = def.pool.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, Math.min(def.deal || pool.length, pool.length));
  }

  function floorsOpenOn(day) {
    return FLOORS.map((f, i) => i).filter((i) => day >= FLOORS[i].unlockDay);
  }

  global.GWConfig = {
    DAY_SECONDS, START_DEBT, START_BANK, INTEREST, MAX_STRIKES, SHOUTS_PER_DAY,
    quotaFor, FLOORS, ITEMS, TICKET_SHOP, BODY_PARTS, FRIENDS, edgeFor, COMPS, STAKE_FLOOR, STAKE_FLOOR_QUOTA, FRONT_MARKUP, gamesOn,
    TOTAL_DAYS, CHALLENGES, floorsOpenOn,
  };
})(window);
