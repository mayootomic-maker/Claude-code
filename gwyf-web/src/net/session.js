/* Playing the same run as somebody else.

   The shape of it follows the game rather than the other way round. Gamble With
   Your Friends is about one shared bank account that other people can reach, so
   the account is the thing that has to be authoritative and everything else can
   be local. One player hosts; the host's bank is the bank. Guests keep their own
   copy of the world, walk it themselves, and play their own tables at full frame
   rate -- what they send upstream is money moving, and what they get back is the
   balance as the host sees it.

   That trust model is deliberate and it is the game's own: anyone at the table
   can empty the account. A guest that lied about a payout would be doing by hand
   exactly what the game invites its friends to do anyway, and this connects
   people who passed a code to each other, not strangers. It is not a ranked
   ladder and there is nothing to defend.

   Both machines build the same rooms without exchanging any of it, because the
   layout of a floor comes from the run seed and the floor number (see
   `layoutRng` in main.js). All that has to travel is the seed.

   Positions go out about twelve times a second and are interpolated at the far
   end; nothing here is rolled back or predicted, because at casino walking pace
   over a link between friends there is nothing worth predicting. */

(function (global) {
  'use strict';

  const TICK = 1000 / 12;         // how often a position goes out
  const GONE = 6000;              // silence after which somebody has left

  function create(shell, link, opts) {
    const store = shell.store;
    const isHost = !!opts.host;
    const me = {
      id: link.id,
      name: (opts.name || 'Player').slice(0, 16),
      colour: opts.colour || 0xd9a441,
    };
    const peers = new Map();
    let lastSent = 0;
    const pendingGreet = new Set();
    let disposed = false;
    const off = [];

    const send = (t, d, to) => link.send(t, d, to);
    const listen = (t, fn) => off.push(link.on(t, fn));

    /* --- who is here --------------------------------------------------------- */

    function seePeer(id, info) {
      let p = peers.get(id);
      if (!p) {
        // Turned up without introducing themselves -- their hello was lost, or
        // they were here before we were. Ask, by introducing ourselves to them.
        pendingGreet.add(id);
        p = {
          id, name: 'Player', colour: 0x9aa0a6,
          pos: new THREE.Vector3(), to: new THREE.Vector3(),
          yaw: 0, toYaw: 0, floor: null, seen: 0, body: null, tag: null,
        };
        peers.set(id, p);
      }
      if (info) {
        if (info.name) p.name = String(info.name).slice(0, 16);
        if (info.colour !== undefined) p.colour = info.colour;
      }
      p.seen = performance.now();
      return p;
    }

    listen('hello', (d, from) => {
      const known = peers.has(from);
      const p = seePeer(from, d);
      pendingGreet.delete(from);
      // Answer somebody new so a late arrival learns about everyone already
      // here, not just about the host. Answering one we already knew about
      // would bounce hellos back and forth for the rest of the night.
      if (!known) greet(from);
      if (isHost) {
        send('run', runSnapshot(), from);
        store.say(p.name + ' sat down at the table.', 'house');
      }
      if (opts.onRoster) opts.onRoster();
    });

    listen('bye', (d, from) => {
      const p = peers.get(from);
      if (p) {
        store.say(p.name + ' left the table.', 'flat');
        dropPeer(from);
      }
    });

    listen('at', (d, from) => {
      const p = seePeer(from, null);
      p.to.set(d.x, d.y || 0, d.z);
      p.toYaw = d.r;
      p.floor = d.f;
      p.moving = !!d.m;
      if (!p.body) p.pos.copy(p.to);
    });

    /* --- the account --------------------------------------------------------- */

    /* Guests ask, the host does. `stake` and `resolve` are the only two ways
       money moves in the whole game -- everything else goes through them -- so
       forwarding these two forwards all of it. */
    listen('money', (d, from) => {
      if (!isHost) return;
      const p = peers.get(from);
      const who = p ? p.name : 'Somebody';
      if (d.kind === 'stake') {
        if (!store.stake(d.amount)) {
          send('money-denied', { amount: d.amount }, from);
          store.say(who + ' reaches for ' + money(d.amount) + ' and finds it gone.', 'bad');
        }
      } else if (d.kind === 'resolve') {
        const result = store.resolve(d.game, d.amount, d.multiplier, { by: 'net:' + from });
        const label = result.net >= 0
          ? who + ' takes ' + money(result.net) + ' off the ' + d.name + '.'
          : who + ' drops ' + money(-result.net) + ' on the ' + d.name + '.';
        store.say(label, result.net >= 0 ? 'good' : 'bad');
        broadcast('run', runSnapshot());
      }
      shell.renderHud();
    });

    listen('money-denied', () => {
      store.say('The account would not cover that. The host says no.', 'bad');
      shell.renderHud();
    });

    /* The host's word on the run. Guests take the numbers and do not argue. */
    function runSnapshot() {
      const s = store.s;
      return {
        seed: s.seed, day: s.day, bank: s.bank, debt: s.debt, quota: s.quota,
        timeLeft: s.timeLeft, phase: s.phase, floor: s.floor,
      };
    }

    listen('run', (d) => {
      if (isHost || !d) return;
      const s = store.s;
      const wasSeed = s.seed;
      s.seed = d.seed; s.day = d.day; s.bank = d.bank; s.debt = d.debt;
      s.quota = d.quota; s.timeLeft = d.timeLeft;
      if (wasSeed !== d.seed && opts.onSeed) opts.onSeed();
      shell.renderHud();
    });

    listen('say', (d) => { if (d && d.text) store.say(d.text, d.tone || 'flat'); });

    function broadcast(t, d) { send(t, d); }

    /* --- the frame ----------------------------------------------------------- */

    function tick(dt, now) {
      if (disposed) return;
      if (now - lastSent > TICK) {
        lastSent = now;
        const st = shell.player.state;
        send('at', {
          x: +st.pos.x.toFixed(2), z: +st.pos.z.toFixed(2), y: +st.y.toFixed(2),
          r: +st.viewYaw.toFixed(2), f: store.s.phase === 'lobby' ? -1 : store.s.floor,
          m: Math.hypot(st.vel.x, st.vel.z) > 0.4 ? 1 : 0,
        });
      }
      if (pendingGreet.size) {
        for (const id of pendingGreet) greet(id);
        pendingGreet.clear();
      }
      if (isHost && now - (tick.pushed || 0) > 1000) {
        tick.pushed = now;
        broadcast('run', runSnapshot());
      }

      const here = store.s.phase === 'lobby' ? -1 : store.s.floor;
      for (const p of Array.from(peers.values())) {
        if (now - p.seen > GONE) { dropPeer(p.id); continue; }
        // Only people in the same room get a body.
        const near = p.floor === here;
        if (near && !p.body) makeBody(p);
        if (!near && p.body) hideBody(p);
        if (!p.body) continue;
        // Interpolate towards the last report rather than snapping to it.
        const k = Math.min(1, dt * 9);
        p.pos.lerp(p.to, k);
        let d = p.toYaw - p.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        p.yaw += d * k;
        p.body.group.position.set(p.pos.x, p.pos.y, p.pos.z);
        p.body.group.rotation.y = p.yaw;
        p.cycle = (p.cycle || 0) + dt * (p.moving ? 7 : 1.2);
        const s = Math.sin(p.cycle);
        p.body.root.rotation.z = p.moving ? s * 0.12 : s * 0.02;
        p.body.root.position.y = p.moving ? Math.abs(Math.cos(p.cycle)) * 0.035 : 0;
        for (let i = 0; i < 2; i++) {
          const side = i === 0 ? -1 : 1;
          p.body.hands[i].position.z = 0.06 + (i === 0 ? s : -s) * (p.moving ? 0.16 : 0.02);
          p.body.hands[i].rotation.z = side * 0.1;
        }
      }
    }

    /* --- bodies -------------------------------------------------------------- */

    function makeBody(p) {
      if (!shell.level) return;
      try {
        p.body = GWCrew.buildBody(shell.lib, {
          body: p.colour, hat: null, height: 1.0, width: 1.0,
        });
      } catch (err) {
        console.warn('[gwyf] could not draw ' + p.name, err);
        return;
      }
      p.tag = GWCrew.nameTag(p.name, '#' + new THREE.Color(p.colour).getHexString());
      if (p.tag) {
        p.tag.position.y = p.body.joints.height * 0.98;
        p.body.group.add(p.tag);
      }
      shell.level.group.add(p.body.group);
    }

    function hideBody(p) {
      if (!p.body) return;
      if (p.body.group.parent) p.body.group.parent.remove(p.body.group);
      if (p.tag && p.tag.userData.dispose) p.tag.userData.dispose();
      p.body.dispose();
      p.body = null;
      p.tag = null;
    }

    function dropPeer(id) {
      const p = peers.get(id);
      if (!p) return;
      hideBody(p);
      peers.delete(id);
      if (opts.onRoster) opts.onRoster();
    }

    /* Bodies live in the level's group, so a floor change takes them with it.
       They are rebuilt on the next tick from the position already being sent. */
    function levelChanged() {
      for (const p of peers.values()) { p.body = null; p.tag = null; }
    }

    const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

    const greet = (to) => send('hello', { name: me.name, colour: me.colour }, to);

    /* Say hello, and keep saying it until somebody says it back.

       A data channel is not open the instant it is created, so the first hello
       goes into a closed pipe and is simply dropped -- which left both ends
       showing each other as "Player" in a grey coat, because the only thing
       that had arrived was a position. The link says when it opens; peers that
       turn up through a position report get asked directly. */
    listen('__open', () => greet());
    greet();

    return {
      me, peers, isHost, tick, levelChanged,
      kind: link.kind,
      roster() {
        return Array.from(peers.values()).map((p) => ({ id: p.id, name: p.name, colour: p.colour }));
      },
      /* The two calls that move money. A guest routes them through the host; a
         host does them locally and tells everyone the new balance. */
      stake(amount) {
        if (isHost) return store.stake(amount);
        send('money', { kind: 'stake', amount });
        // Shown immediately and corrected by the host's next word on it, which
        // is a second away at most. Waiting for a round trip before the chips
        // move makes every bet feel broken.
        store.s.bank = Math.max(0, store.s.bank - amount);
        return true;
      },
      resolve(game, amount, multiplier, name) {
        if (isHost) {
          const result = store.resolve(game, amount, multiplier);
          broadcast('run', runSnapshot());
          return result;
        }
        send('money', { kind: 'resolve', game, amount, multiplier, name });
        const gross = amount * multiplier;
        store.s.bank += gross;
        return { game, stake: amount, multiplier, net: gross - amount, gross, detail: null };
      },
      announce(text, tone) { send('say', { text, tone }); },
      dispose() {
        disposed = true;
        send('bye', null);
        for (const p of Array.from(peers.values())) hideBody(p);
        peers.clear();
        for (const fn of off) fn();
        link.close();
      },
    };
  }

  global.GWSession = { create };
})(window);
