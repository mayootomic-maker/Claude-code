/* Can this run actually be won?

   The complaint that prompted this was "you lose way too easily and never
   win", and it turned out to be arithmetic rather than feel: the quota grew
   62% a day against a bank that only shrinks in expectation, so from about day
   four the run was already lost and the remaining eight days were ceremony.

   This does not re-implement the games. It reads the real GWConfig and the
   real bet tables the twelve games register, and draws outcomes from the
   `prob` and `pays` those tables declare -- which tools/odds.mjs separately
   proves the implementations actually obey. So the numbers here are the
   numbers the player faces.

   Two policies, because one is not evidence. `careful` bets small and stops
   when the quota is met; `chaser` raises after losses and keeps going. A
   design where only one of them can win is a design with one strategy in it.

   Usage: node gwyf-web/tools/economy.mjs [runs] */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', 'src');
const RUNS = Number(process.argv[2] || 4000);

/* Load the real config and the real bet tables.

   The game files are browser IIFEs that call GWGames.register at load with an
   object literal; nothing in that literal touches THREE or the DOM, so a stub
   window is enough to read them. Anything else they reference would throw
   here rather than be quietly approximated, which is the point. */
/* The sandbox is its own `window`, so an IIFE that takes `window` and writes
   `global.GWFoo` produces a bare `GWFoo` for the next file -- which is what a
   browser does and what these files were written against. */
const sandbox = { THREE: {}, console };
sandbox.window = sandbox;
// A couple of games reach for a sibling module at load time to build a deck or
// a board. They only need it to exist; nothing read here comes from it.
sandbox.GWCards = { deck: () => [], SUITS: [], RANKS: [] };
sandbox.GWStage = {};
const registry = [];
sandbox.GWGames = { register: (def) => registry.push(def) };
runInNewContext(readFileSync(join(src, 'core/config.js'), 'utf8'), sandbox);
for (const f of readdirSync(join(src, 'games')).filter((n) => n !== 'registry.js')) {
  runInNewContext(readFileSync(join(src, 'games', f), 'utf8'), sandbox);
}
const C = sandbox.GWConfig;
const GAMES = new Map(registry.map((g) => [g.id, g]));

/* The expected return of one unit staked on a bet, as the tables declare it.
   A game that pays as RTP states its return directly. */
function edgeOf(def, bet) {
  if (def.paysAsRtp) return 1 - bet.pays;
  return 1 - bet.prob * bet.pays;
}

/* The best bet on a floor, and how bad it is. Every honest bet loses money, so
   "best" means "loses least" unless an item has moved it. */
function floorBets(floorIndex, items) {
  const out = [];
  for (const id of C.FLOORS[floorIndex].games) {
    const def = GAMES.get(id);
    if (!def) continue;
    for (const bet of def.bets) {
      let prob = bet.prob === undefined ? null : bet.prob;
      let pays = bet.pays;
      // The kit, read from the same table the shop and the odds panel read.
      if (id === 'coinflip' && items.luckycoin && prob !== null) prob = 0.55;
      pays *= 1 + C.edgeFor(id, (x) => !!items[x]);
      const ev = def.paysAsRtp ? pays : (prob === null ? 1 - edgeOf(def, bet) : prob * pays);
      out.push({ game: id, bet, prob, pays, ev, rtp: def.paysAsRtp });
    }
  }
  out.sort((a, b) => b.ev - a.ev);
  return out;
}

function play(rng, choice) {
  // An RTP game returns its multiplier from a distribution the table does not
  // enumerate; its mean is all this needs, with the variance of a coin flip
  // standing in. Enumerated bets are drawn exactly.
  if (choice.rtp || choice.prob === null) {
    return rng() < 0.5 ? 0 : choice.ev * 2;
  }
  return rng() < choice.prob ? choice.pays : 0;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* One run of the whole arrangement. Returns how it ended and when. */
function simulate(seed, policy, tune) {
  const rng = mulberry(seed);
  const quotaFor = tune ? (d) => Math.round(tune.base * Math.pow(tune.growth, d - 1) / 25) * 25
                        : C.quotaFor;
  const startBank = tune ? tune.bank : C.START_BANK;
  const comps = tune && tune.comps !== undefined ? tune.comps : (C.COMPS || 0);
  let bank = startBank;
  let debt = tune && tune.debt !== undefined ? tune.debt : C.START_DEBT;
  const interest = tune && tune.interest !== undefined ? tune.interest : C.INTEREST;
  let strikes = 0;
  let fronted = 0;
  const items = {};
  let tickets = 0;

  for (let day = 1; day <= C.TOTAL_DAYS; day++) {
    const quota = quotaFor(day);
    const open = C.floorsOpenOn(day);
    const floor = open[open.length - 1];
    const limits = C.FLOORS[floor];

    // Buy what you can afford before the doors open, cheapest edge first --
    // which is what a player who has read the shop does.
    for (const item of [...C.ITEMS].sort((a, b) => a.price - b.price)) {
      if (items[item.id]) continue;
      // Anything that pays for itself: the kit, plus the two that buy time
      // and cheaper debt. A player reads the shop and buys the edges first.
      if (!item.edge && !['skimmer', 'stopwatch', 'repellent'].includes(item.id)) continue;
      // Keep tonight's quota and something to play with. The first version
      // reserved a fraction of the quota, so it spent itself down to nothing
      // and then reported the game as unwinnable.
      if (bank - item.price < quota + 600) continue;
      bank -= item.price;
      items[item.id] = true;
    }

    /* The shark fronts you a stake when you are cleaned out.

       Without this the run has an absorbing state: one bad night takes the
       bank under the table minimum, and from there you cannot place a bet, so
       you cannot make a quota, so you take three strikes and are thrown out
       with eight days unplayed. Measured, that was ninety-nine runs in a
       hundred -- not a difficulty curve, a dead end. He is a loan shark; being
       unable to lose money is no use to him, so he stakes you and adds it to
       what you owe. You are never out, you are only ever deeper in. */
    // Enough to have a real go at tonight's number, not just enough to place
    // one bet: he wants the quota paid, so he stakes you to where it is
    // reachable.
    const floorTo = Math.max(C.STAKE_FLOOR, Math.round(quota * C.STAKE_FLOOR_QUOTA));
    if (bank < floorTo) {
      const front = floorTo - bank;
      bank += front;
      debt += Math.round(front * 1.25);
      fronted += front;
    }

    const choices = floorBets(floor, items);
    /* Heat, because it is the constraint that decides everything.

       Without it a player who owns the two-headed coin simply grinds the coin
       toss all night at a seven percent edge and the balance question is
       trivial. The pit watches: a machine you keep hitting shortens its odds
       and then shuts, so an edge has to be spread across the floor and the
       floor's other machines are all honest, which is to say all losing. The
       constants are read from the same places heat.js uses them. */
    const HEAT = { perHand: 0.055, maxPerHand: 0.17,
                   perWin: tune && tune.perWin !== undefined ? tune.perWin : 0.22,
                   cool: tune && tune.cool !== undefined ? tune.cool : 0.045,
                   watched: 0.40, short: 0.65, closed: 0.90, shortPays: 0.90 };
    const heat = {};
    for (const c of choices) heat[c.game] = heat[c.game] || 0;

    let staked = 0, returned = 0, played = 0;
    const onMachine = {};
    // Roughly how many hands fit in five minutes at the measured pace.
    // Measured pace: about seven seconds a hand once the tables stopped
    // waiting on animations nobody asked for.
    let hands = Math.floor((C.DAY_SECONDS + (items.stopwatch ? 45 : 0)) / 7);
    let stake = Math.max(limits.minBet, Math.min(limits.maxBet, Math.round(bank * 0.08 / 25) * 25));

    while (hands-- > 0 && bank >= limits.minBet) {
      /* Protect the quota, but keep playing.

         The first version of this policy stopped the moment the night was
         safe, which meant it only ever gambled while it was behind -- so it
         took every loss the floor had to offer and none of the wins, and it
         reported the game as unwinnable. A player who owns a machine the kit
         has turned positive plays it all night. What a careful player actually
         does is protect tonight's quota: never stake money the shark is owed. */
      /* Protecting the quota only makes sense while you still have it. Below
         it there is nothing to protect and standing still guarantees the
         strike, so a careful player plays on -- the first version stopped dead
         the moment it fell short and then took the strike every time. */
      if (policy === 'careful' && bank > quota && bank - stake < quota) {
        stake = Math.max(limits.minBet, Math.round((bank - quota) / 25) * 25);
        if (bank - stake < quota) break;
      }
      // The swinger stakes a small slice on a long shot and keeps doing it.
      if (policy === 'swinger') {
        stake = Math.max(limits.minBet,
          Math.min(limits.maxBet, Math.round(bank * 0.07 / 25) * 25));
      }
      // Best bet on a machine that is still open, after what the pit has
      // already shortened.
      let best = null;
      for (const c of choices) {
        if (heat[c.game] >= HEAT.closed) continue;
        const ev = c.ev * (heat[c.game] >= HEAT.short ? HEAT.shortPays : 1);
        /* The swinger sorts by payout, not by expectation.

           This is the player the game is actually built for, and leaving it
           out is why the first pass concluded the run was unwinnable at any
           quota. Every machine loses money slowly, so grinding the least-bad
           one is a slow loss with extra steps; the money is in the long shots,
           where a single hand can multiply the bank thirty-six times. It is a
           worse expectation and a much better strategy, which is the whole
           shape of a casino. */
        /* The swinger takes the biggest payout it can find, but only among
           bets that are not outright terrible: a one-in-thirty-seven shot
           staked every hand is ruin, not strategy, and the first version of
           this policy went broke on it in ninety-five runs out of a hundred. */
        const key = policy === 'swinger' ? (c.prob !== null && c.prob < 0.08 ? -1 : (c.pays || 0)) : ev;
        if (!best || key > best.key) best = { ...c, ev, key };
      }
      /* A careful player does not play a machine that is losing money.

         Picking the least-bad open machine every hand meant that once the pit
         had shut the two the kit had turned positive, the next thirty hands
         went into a duck race at minus five percent -- so the kit paid for
         itself and the wait for it to cool gave it all back. Standing at the
         bar for a minute costs nothing but the minute. */
      if (policy === 'careful' && best && best.ev + comps < 1.0) best = null;
      if (!best) { for (const g in heat) heat[g] = Math.max(0, heat[g] - HEAT.cool * 3); continue; }

      /* Size the bet to the gap and the clock.

         Flat-betting six percent cannot close a forty percent gap in the hands
         that are left, so a player who is behind with the doors closing bets
         bigger -- which is the whole shape of the game and has to be in the
         model or the model says the game is unwinnable when it is only the
         simulated player who cannot play it. */
      const bet = Math.min(stake, bank, limits.maxBet);
      if (bet < limits.minBet) break;
      bank -= bet;
      staked += bet; played++;
      onMachine[best.game] = (onMachine[best.game] || 0) + 1;
      const back = bet * play(rng, best);
      returned += back;
      bank += back;
      /* Comps: the house pays you a little for playing, win or lose.

         Every real casino does this, and it is the one lever that changes the
         shape of the game rather than its numbers. Without it every machine
         loses money in expectation, heat stops you grinding the single machine
         an item has turned positive, and the bank can only ever drift down --
         which is why the run was unwinnable at any quota, including one that
         topped out at $1,275. It is a stated rate off the top of the house
         edge, not a hidden thumb on the scale. */
      bank += bet * comps;
      if (items.skimmer) bank += 25;      // a friend played something too

      let rise = HEAT.perHand + (back > bet ? HEAT.perWin : 0);
      heat[best.game] += Math.min(HEAT.maxPerHand, rise);
      for (const g in heat) if (g !== best.game) heat[g] = Math.max(0, heat[g] - HEAT.cool);

      if (policy === 'swinger') {
        // nothing to adjust: the stake is re-derived from the bank each hand
      } else if (policy === 'chaser') {
        stake = back === 0 ? Math.min(limits.maxBet, stake * 2) : Math.max(limits.minBet, stake / 2);
      } else {
        stake = Math.max(limits.minBet, Math.min(limits.maxBet, Math.round(bank * 0.08 / 25) * 25));
      }
    }

    if (process.env.GW_TRACE) console.log('  day ' + day
      + ' played ' + played + ' staked $' + Math.round(staked)
      + ' back $' + Math.round(returned)
      + ' (' + (staked ? ((returned / staked - 1) * 100).toFixed(1) : '0') + '%) '
      + JSON.stringify(onMachine) + '\n         quota $' + quota
      + ' bank $' + Math.round(bank) + ' floor ' + floor
      + ' items ' + Object.keys(items).join(',') + ' strikes ' + strikes);
    if (bank >= quota) {
      bank -= quota;
      tickets += 1 + (bank >= quota ? 1 : 0);
    } else {
      strikes++;
      if (strikes >= C.MAX_STRIKES) return { end: 'house', day };
    }

    /* Spare money goes at the debt -- but "spare" is what is left above a
       working bankroll. The first version of this paid every dollar over and
       started the next day with nothing to bet, so it missed three quotas and
       reported the game as unwinnable when it was the policy that was broken.
       A player keeps enough to play with. */
    /* Keep back more than tomorrow needs. Keeping exactly tomorrow's quota
       left the careful player a little short every single morning, so it spent
       every evening shoving a third of its bank at a losing machine to close
       the gap -- a doom loop invented by the policy, not by the game. */
    /* How much to keep back rather than put against the debt.

       Hoarding a large cushion made sense when going broke ended the run; with
       the shark's stake floor it cannot, so the cushion was only stopping the
       player ever paying anything off -- the bank hovered under the float
       forever and the debt was never touched. */
    const next = quotaFor(Math.min(C.TOTAL_DAYS, day + 1));
    const float = Math.max(600, next * 1.5);
    const pay = Math.max(0, Math.min(bank - float, debt));
    bank -= pay; debt -= pay;
    if (debt <= 0) return { end: 'paid', day };
    debt += Math.round(debt * (items.repellent ? interest * 0.6 : interest));
  }
  return { end: 'ranout', day: C.TOTAL_DAYS, debt, fronted };
}

function measure(policy, tune) {
  const tally = { paid: 0, house: 0, ranout: 0 };
  const diedOn = [];
  for (let i = 0; i < RUNS; i++) {
    const r = simulate(i * 2654435761 + 12345, policy, tune);
    tally[r.end]++;
    if (r.end === 'house') diedOn.push(r.day);
  }
  diedOn.sort((a, b) => a - b);
  return { tally, median: diedOn.length ? diedOn[Math.floor(diedOn.length / 2)] : null };
}

/* Sweep the two numbers that decide whether the run is possible at all. The
   target is a game a careful player usually finishes and often wins, where
   chasing losses is punished without being hopeless. */
if (process.argv.includes('--sweep')) {
  const rows = [];
  for (const base of [200, 300, 400]) {
    for (const growth of [1.06, 1.10, 1.14]) {
      for (const bank of [2000, 2400, 3000]) {
       for (const comps of [0.020]) {
        for (const debt of [4000, 6000, 8000]) {
        for (const interest of [0.03, 0.05]) {
        for (const perWin of [0.08, 0.12]) {
        for (const cool of [0.070]) {
        const tune = { base, growth, bank, comps, debt, interest, perWin, cool };
        const a = measure('swinger', tune), b = measure('chaser', tune);
        const car = measure('careful', tune);
        rows.push({ base, growth, bank, comps, debt, interest, perWin, cool,
          careful: car.tally.paid / RUNS,
          swinger: a.tally.paid / RUNS, chaser: b.tally.paid / RUNS,
          out: car.tally.house / RUNS, last: quotaOf(tune, C.TOTAL_DAYS) });
        }
        }
        }
        }
       }
      }
    }
  }
  // A good row: careful wins often but not always, chasing wins sometimes.
  rows.sort((x, y) => score(y) - score(x));
  console.log('base growth bank  debt  perWin cool   careful swinger chaser  out   day-12');
  for (const r of rows.slice(0, 14)) {
    console.log(String(r.base).padEnd(5) + r.growth.toFixed(2).padEnd(7)
      + String(r.bank).padEnd(6) + String(r.debt).padEnd(6)
      + r.perWin.toFixed(2).padEnd(7) + r.cool.toFixed(3).padEnd(7)
      + (r.careful * 100).toFixed(0).padStart(6) + '%'
      + (r.swinger * 100).toFixed(0).padStart(7) + '%'
      + (r.chaser * 100).toFixed(0).padStart(6) + '%'
      + (r.out * 100).toFixed(0).padStart(5) + '%   $' + r.last.toLocaleString('en-US'));
  }
  process.exit(0);
}

function quotaOf(t, d) { return Math.round(t.base * Math.pow(t.growth, d - 1) / 25) * 25; }
function score(r) {
  if (r.out > 0.40) return -99;   // a game that throws most players out is not a game
  /* What a good balance looks like, stated as a number.

     A player who takes swings wins about half the time -- often enough that
     the run is worth starting, rarely enough that winning means something.
     Chasing losses does markedly worse but is not hopeless. And most runs
     should reach the end rather than collapsing in the first week, because a
     game that throws you out on day three has eleven days of content nobody
     sees. */
  return -Math.abs(r.careful - 0.45) * 3 - Math.abs(r.chaser - 0.15) - r.out * 0.8;
}

// Try a candidate curve without editing config, so a trace and a sweep row
// describe the same run.
const TUNE = process.env.GW_TUNE
  ? (([base, growth, bank, comps, debt, interest, perWin, cool]) => ({
      base: +base, growth: +growth, bank: +bank, comps: +comps,
      ...(debt ? { debt: +debt } : {}), ...(interest ? { interest: +interest } : {}),
      ...(perWin ? { perWin: +perWin } : {}), ...(cool ? { cool: +cool } : {}) }))(process.env.GW_TUNE.split(','))
  : null;
if (TUNE) console.log('tuned: base ' + TUNE.base + ' growth ' + TUNE.growth + ' bank $' + TUNE.bank);

for (const policy of ['careful', 'swinger', 'chaser']) {
  const { tally, median: med } = measure(policy, TUNE);
  const diedOn = med === null ? [] : [med];
  const pct = (n) => ((n / RUNS) * 100).toFixed(1) + '%';
  console.log(policy.padEnd(9)
    + 'paid off ' + pct(tally.paid).padEnd(8)
    + 'thrown out ' + pct(tally.house).padEnd(8)
    + 'ran out of days ' + pct(tally.ranout).padEnd(8)
    + (diedOn.length ? 'typically thrown out on day ' + diedOn[0] : ''));
}
console.log('\nquota by day: ' + Array.from({ length: C.TOTAL_DAYS }, (_, i) =>
  '$' + C.quotaFor(i + 1).toLocaleString('en-US')).join(' · '));
