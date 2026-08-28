/* The contract every game of chance implements.

   A game owns its 3D table and its animation and nothing else. It never touches
   the bank: the shell takes the stake before calling `play` and settles the
   returned multiplier afterwards, through the one funnel in the store. That is
   what stops a game from inventing money, and it is why the odds table below
   can be trusted -- `chances` is the same data the Monte Carlo test asserts on.

   play() returns { multiplier, detail, headline, tone }:
     multiplier  total return on the stake. 0 loses it, 1 is a push, 2 doubles.
     headline    what to shout on the result card.
     tone        'win' | 'lose' | 'push' | 'huge'
*/

(function (global) {
  'use strict';

  const registry = new Map();

  function register(def) {
    if (registry.has(def.id)) throw new Error('duplicate game id: ' + def.id);
    if (!def.bets || !def.bets.length) throw new Error(def.id + ': a game needs at least one bet');
    for (const bet of def.bets) {
      if (typeof bet.prob !== 'number' || typeof bet.pays !== 'number') {
        throw new Error(def.id + '/' + bet.id + ': every bet states its probability and payout');
      }
    }
    registry.set(def.id, def);
    return def;
  }

  const get = (id) => registry.get(id);
  const all = () => Array.from(registry.values());

  /* House edge implied by a bet's stated probability and payout. Shown to the
     player in the odds panel: this game is about knowing you are being taken,
     so hiding the number would be the one dishonest thing in it. */
  function edge(bet) { return 1 - bet.prob * bet.pays; }

  /* --- animation helpers -------------------------------------------------- */

  function makeContext(shell) {
    const ctx = {
      stage: shell.stage,
      lib: shell.lib,
      store: shell.store,
      audio: shell.audio,
      get rng() { return shell.store.rng; },
      get group() { return shell.stage.group; },
      model(name) { return GWModels.instance(shell.lib, name); },

      /* Run `fn(t, dt, elapsed)` for `seconds`, driven by the stage's own loop
         so animations pause with the renderer instead of racing on in a
         background tab. */
      animate(seconds, fn, easing) {
        return new Promise((resolve) => {
          let elapsed = 0;
          const ease = easing || ((x) => x);
          // Reduced motion shortens animations rather than skipping them. A
          // coin that teleports to its result tells you nothing about which
          // face came up, and the whole game is watching things settle.
          if (shell.stage.state.reduced) seconds = Math.max(seconds * 0.32, 0.12);
          const stop = shell.stage.onTick((dt) => {
            elapsed += dt;
            const raw = Math.min(elapsed / seconds, 1);
            fn(ease(raw), dt, elapsed, raw);
            if (raw >= 1) { stop(); resolve(); }
          });
        });
      },

      wait(seconds) {
        return ctx.animate(Math.max(seconds, 0.0001), () => {});
      },

      /* Wait until `fn` says it is finished. For anything whose length is not
         known up front, like a physics playback. */
      until(fn) {
        return new Promise((resolve) => {
          let elapsed = 0;
          const stop = shell.stage.onTick((dt) => {
            elapsed += dt;
            if (fn(dt, elapsed)) { stop(); resolve(); }
          });
        });
      },

      /* Put the machine into the world.

         A game builds its cabinet or table around its own origin and hands it
         over; the shell parents it to wherever that machine stands on the
         floor. Games used to add themselves straight to the scene at the world
         origin, which is fine when the whole game is one table and impossible
         once there are four machines in a room. */
      mount(group) { return shell.mountMachine(group); },

      /* Where the camera sits to play this machine, in the machine's own space.
         The shell turns it into world space using the anchor's transform, so a
         table rotated to face down the room is still viewed from the player's
         side of it. */
      view(position, look) { shell.setMachineView(position, look); },

      announce(text, tone) { shell.announce(text, tone); },
      setStatus(text) { shell.setStatus(text); },

      /* A big number over the table that changes every frame -- the climbing
         multiplier in Crash, the rung in the ladder. It is DOM rather than a
         canvas texture because uploading a new texture sixty times a second to
         render four characters is a lot of bus traffic for some text. Pass null
         to take it away. */
      live(text, tone) { shell.setLive(text, tone); },

      /* Ask the player something mid-hand.

         Blackjack, crash, mines and the ladder are not one-shot bets: the stake
         is already down and the game needs an answer before it can finish. One
         call covers both ways of answering -- buttons in the rail, or clicking
         a thing on the table -- because several of these want both at once and
         racing two separate promises leaves whichever lost still listening.

         Resolves { type: 'option', id } or { type: 'mesh', object }. */
      prompt(spec) { return shell.prompt(spec); },

      /* Draw the player's attention to part of the table. */
      highlight(object, on) { shell.highlight(object, on); },

      /* Put more money on a hand that is already in play -- doubling down, and
         nothing else so far.

         The shell took the opening stake before calling play() and settles
         against `totalStake` afterwards, so a game that raises has to go
         through here rather than touching the bank itself. Returns false when
         the account cannot cover it, and the game carries on undoubled. */
      raiseStake(amount) {
        if (!shell.store.canBet(amount)) return false;
        shell.store.stake(amount);
        ctx.totalStake += amount;
        return true;
      },
    };
    return ctx;
  }

  const EASE = {
    linear: (t) => t,
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inCubic: (t) => t * t * t,
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outBack: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
    outElastic: (t) => (t === 0 || t === 1) ? t
      : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
    outBounce: (t) => {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    },
  };

  global.GWGames = { register, get, all, edge, makeContext, EASE, registry };
})(window);
