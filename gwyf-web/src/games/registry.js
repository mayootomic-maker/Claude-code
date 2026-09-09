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

      /* The lit placard on the rail of a table.

         Two jobs in one small object. The first is information: a card table
         has a sign on it saying what it will take, and until now the only way
         to find that out was to walk up and open a panel. The second is that a
         card table does not move -- measured, six of the fourteen machines on
         a floor stood perfectly still with nobody at them, which is what makes
         a room read as a showroom. The placard breathes, slowly, the way a lit
         sign does, so every table on the floor is doing something.

         The numbers come out of the floor the machine is standing on rather
         than being written down here, so a placard cannot disagree with the
         rail. Returns the stop function for the game's dispose. */
      placard(opts) {
        const o = Object.assign({ x: 0, y: 0.06, z: 1.35, rotY: 0, scale: 1 }, opts || {});
        const def = shell.store.floorLimits();
        const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

        const c = document.createElement('canvas');
        c.width = 256; c.height = 128;
        const g = c.getContext('2d');
        g.fillStyle = '#140d0b';
        g.fillRect(0, 0, 256, 128);
        g.strokeStyle = '#b08234';
        g.lineWidth = 5;
        g.strokeRect(6, 6, 244, 116);
        g.textAlign = 'center';
        g.fillStyle = '#f2ebe6';
        g.font = '700 40px Inter, system-ui, sans-serif';
        g.fillText(money(def.minBet), 128, 54);
        g.fillStyle = '#9a7333';
        g.font = '600 22px Inter, system-ui, sans-serif';
        g.fillText('to ' + money(def.maxBet), 128, 92);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;

        const group = new THREE.Group();
        const faceMat = new THREE.MeshStandardMaterial({
          map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.5,
          roughness: 0.6,
        });
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.23), faceMat);
        face.position.z = 0.021;
        group.add(face);
        const bodyMat = new THREE.MeshStandardMaterial({
          color: 0x241a15, roughness: 0.55, metalness: 0.3,
        });
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.29, 0.04), bodyMat);
        group.add(body);
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.018, 0.022, 0.20, 8),
          new THREE.MeshStandardMaterial({ color: 0xb08234, metalness: 0.9, roughness: 0.3 })
        );
        post.position.y = -0.24;
        group.add(post);
        group.position.set(o.x, o.y + 0.30, o.z);
        group.rotation.y = o.rotY;
        group.scale.setScalar(o.scale);
        // Tilted back, the way a placard on a rail is.
        group.rotation.x = -0.22;
        // Trim, not machine: the camera frames the table, not the sign on it.
        group.userData.trim = true;
        shell.mountMachine(group);

        let t = Math.random() * 6;
        return shell.stage.onTick((dt) => {
          t += dt;
          // Two frequencies, so it does not read as a metronome.
          faceMat.emissiveIntensity = 0.46 + Math.sin(t * 1.1) * 0.14
                                           + Math.sin(t * 0.37) * 0.06;
        });
      },

      /* Fold a part of a machine into one mesh per material.

         A cabinet is built from slabs the way the rooms are, and a wheel is
         two dozen wedges and two dozen pegs -- every one of them its own draw
         call, standing on a floor that draws eight machines at once. Anything
         that never moves relative to the group it is in can be folded, and the
         group goes on moving: the wheel spins as one mesh. Call it once the
         part is fully built and never on a group whose children animate
         separately -- a mesh that has been folded away is gone, so a game that
         still holds a reference to it would be moving nothing. */
      fold(root) { return GWLevel.mergeStatic(root); },

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
