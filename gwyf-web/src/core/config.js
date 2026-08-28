/* Every tunable number in the game, in one file.

   Prices, odds, quotas and payouts live here rather than next to the code that
   uses them so that the whole economy can be read at once and checked. The
   Monte Carlo test in tools/odds.mjs reads the same tables, so a payout that
   drifts from its stated house edge fails the build rather than the player. */

(function (global) {
  'use strict';

  const DAY_SECONDS = 300;          // the loan shark's five minutes
  const TOTAL_DAYS = 12;            // the length of the arrangement
  const START_DEBT = 10000;
  const START_BANK = 500;
  const INTEREST = 0.08;            // compounded at the end of every day
  const MAX_STRIKES = 3;

  /* Quota climbs faster than any honest edge could pay, which is the point:
     you cannot grind it out, you have to take a swing at some stage. */
  function quotaFor(day) {
    return Math.round(700 * Math.pow(1.62, day - 1) / 25) * 25;
  }

  const FLOORS = [
    {
      id: 'lobby', name: 'The Lobby', env: 'velvet', unlockBank: 0, unlockDay: 1,
      tag: 'Ground floor', accent: '#d9a441',
      blurb: 'Sticky carpet, free peanuts, and the only games in the building that '
           + 'will not take your whole night in one go.',
      games: ['coinflip', 'dice', 'slots', 'duckrace'],
      minBet: 25, maxBet: 500,
    },
    {
      id: 'velvet', name: 'Velvet Hall', env: 'crimson', unlockBank: 2500, unlockDay: 4,
      tag: 'Second floor', accent: '#e8505f',
      blurb: 'Where the carpet stops being sticky and the drinks stop being free. '
           + 'The tables here have a croupier and a memory.',
      games: ['roulette', 'blackjack', 'highlow', 'plinko'],
      minBet: 100, maxBet: 2500,
    },
    {
      id: 'vault', name: 'The Vault', env: 'emerald', unlockBank: 12000, unlockDay: 7,
      tag: 'Third floor', accent: '#4fbf7b',
      blurb: 'No windows, no clocks, no exit signs. The house keeps the odds in '
           + 'a safe down here and it does not open it for you.',
      games: ['crash', 'mines', 'ladder'],
      minBet: 250, maxBet: 10000,
    },
    {
      id: 'penthouse', name: 'The Penthouse', env: 'void', unlockBank: 45000, unlockDay: 10,
      tag: 'Top floor', accent: '#b48ce8',
      blurb: 'One game. It does not have a house edge because it does not need one.',
      games: ['chamber'],
      minBet: 1000, maxBet: 100000,
    },
  ];

  /* Sketchy items. Every one of them does something mechanical -- there are no
     items here whose only effect is a line of flavour text. */
  const ITEMS = [
    { id: 'rabbitsfoot', name: "Rabbit's Foot", price: 350, icon: '🐇',
      desc: 'Every payout in the building pays 1.5% more. Small, permanent, boring, good.' },
    { id: 'luckycoin', name: 'Two-Headed Coin', price: 400, icon: '🪙',
      desc: 'The coin toss comes up your way 55% of the time instead of 50%.' },
    { id: 'loadeddice', name: 'Loaded Dice', price: 450, icon: '🎲',
      desc: 'One losing dice roll per day is quietly rolled again.' },
    { id: 'markeddeck', name: 'Marked Deck', price: 600, icon: '🃏',
      desc: "Card games show you the next card's colour before you commit." },
    { id: 'magnet', name: 'Pocket Magnet', price: 500, icon: '🧲',
      desc: 'Plinko balls drift one peg outward, where the money is.' },
    { id: 'stopwatch', name: 'Fixed Stopwatch', price: 550, icon: '⏱️',
      desc: 'Adds 45 seconds to every day. The shark has not noticed yet.' },
    { id: 'staticcling', name: 'Static Cling', price: 650, icon: '⚡',
      desc: 'A roulette bet that misses by one pocket is paid as if it hit. Once a day.' },
    { id: 'insurance', name: 'Insurance Policy', price: 700, icon: '📄',
      desc: 'Refunds half of your single largest loss each day. Read the small print.' },
    { id: 'coldread', name: 'Cold Read', price: 750, icon: '👁️',
      desc: 'You see what a friend is about to bet before they bet it.' },
    { id: 'skimmer', name: 'Chip Skimmer', price: 800, icon: '🪝',
      desc: 'Skims $25 into the bank every time a friend plays anything.' },
    { id: 'secondwind', name: 'Second Wind', price: 900, icon: '🔁',
      desc: 'One losing slot spin per day gets spun again, free.' },
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
      check: (t, floor) => floor.games.every((g) => t.played[g]) },
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
  function floorsOpenOn(day) {
    return FLOORS.map((f, i) => i).filter((i) => day >= FLOORS[i].unlockDay);
  }

  global.GWConfig = {
    DAY_SECONDS, START_DEBT, START_BANK, INTEREST, MAX_STRIKES, SHOUTS_PER_DAY,
    quotaFor, FLOORS, ITEMS, TICKET_SHOP, BODY_PARTS, FRIENDS,
    TOTAL_DAYS, CHALLENGES, floorsOpenOn,
  };
})(window);
