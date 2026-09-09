/* Getting fourteen phones to agree on where everybody is.

   Three ways in, one interface above them, because the three places this page
   runs have completely different rules about the network:

     - **A file, or any web host.** A public MQTT broker over a WebSocket.
       Nothing to install and nothing to sign into: somebody reads a four
       letter code out and the class types it in. This is the one that works
       for a class, and it is the one the built file uses.

     - **Inside the claude.ai artifact viewer.** No WebSocket and no WebRTC --
       both are blocked before they open. What there is instead is the `room`
       capability: presence for where everyone is, topics for what they did.
       It only reaches signed-in viewers of the same organisation, which is a
       real limit and is said on the join screen rather than left to be found
       out when half the class cannot connect.

     - **Nobody else at all.** A loopback that hands your own messages back to
       you, so one player and a pile of bots runs the identical code path as
       fourteen people. This is not a stub for the other two: it is how the
       page is playable the second it opens.

   Everything above this file sees the same four things -- `send`, `presence`,
   `peers` and an id -- and cannot tell which one it got. */

(function (NS) {
  'use strict';

  const U = NS.util;

  /* Public brokers, tried in order. Each is somebody else's goodwill and any
     of them can be down, full, or blocked by a school network. */
  const BROKERS = [
    { url: 'wss://broker.emqx.io:8084/mqtt', name: 'EMQX' },
    { url: 'wss://broker.hivemq.com:8884/mqtt', name: 'HiveMQ' },
    { url: 'wss://test.mosquitto.org:8081/mqtt', name: 'Mosquitto' },
  ];
  const ROOT = 'nightshift/v2/';
  const PRESENCE_HZ = 10;
  const KEEPALIVE = 1100;        // say something even when standing still
  /* A backgrounded tab is throttled to roughly one interval a second, so this
     has to be several of those and not two: dropping somebody who alt-tabbed
     is worse than carrying a ghost for a few seconds. */
  const GONE = 9000;

  const roomAvailable = () => !!(window.claude && typeof window.claude.use === 'function');

  /* One place decides which way this page talks, so the join screen and the
     lobby browser can never pick differently. */
  function preferred() {
    if (window.location.hash === '#local' && typeof window.BroadcastChannel === 'function') return 'local';
    return roomAvailable() ? 'room' : 'mqtt';
  }
  const mqttAvailable = () => typeof window.WebSocket === 'function';
  const localAvailable = () => typeof window.BroadcastChannel === 'function';

  const LOBBIES = ROOT + 'lobbies';
  const ANNOUNCE_EVERY = 3000;
  const FORGET_LOBBY = 11000;

  /* ---- browsing ------------------------------------------------------------

     Reading a four-letter code out works and will keep working, but in a room
     of thirty it is four letters mis-heard six times. So a host also puts its
     lobby on a shared channel, and everybody else gets a list to tap.

     Nothing on that list is private: it is a name, a code and a head count on
     a public bus, which is said on the screen that shows it. */

  function browse(opts) {
    const mode = opts.mode;
    if (mode === 'room') return browseRoom(opts);
    if (mode === 'mqtt') return browseMqtt(opts);
    opts.onError('There is no way to look for games from here.');
    return { stop() {} };
  }

  function browseMqtt(opts) {
    const seen = new Map();
    let client = null;
    let index = 0;
    let stopped = false;
    let sweep = null;

    const list = () => Array.from(seen.values())
      .filter((l) => Date.now() - l.at < FORGET_LOBBY)
      .sort((a, b) => b.players - a.players || a.code.localeCompare(b.code));

    function connect() {
      if (stopped) return;
      if (index >= BROKERS.length) {
        opts.onError('No public broker would answer, so there is no list to show. '
          + 'A code still works if somebody reads one out.');
        return;
      }
      const broker = BROKERS[index++];
      opts.onStatus('Looking for games via ' + broker.name + '...');
      client = NS.mqtt.connect({
        url: broker.url,
        clientId: 'nsb' + U.id(8),
        onUp() {
          if (stopped) { client.close(); return; }
          client.subscribe(LOBBIES);
          opts.onStatus('');
          opts.onList(list());
        },
        onDown() { if (!stopped && !seen.size) connect(); },
      });
      if (!client) { connect(); return; }
      client.onMessage((topic, msg) => {
        if (stopped || topic !== LOBBIES || !msg || !msg.c) return;
        const code = String(msg.c).slice(0, 8).toUpperCase();
        if (msg.gone) { seen.delete(code); opts.onList(list()); return; }
        seen.set(code, {
          code,
          host: U.cleanName(msg.h, 12) || 'Somebody',
          players: Math.max(1, Math.min(14, msg.n | 0)),
          at: Date.now(),
        });
        opts.onList(list());
      });
      sweep = setInterval(() => opts.onList(list()), 2000);
    }

    connect();
    return {
      stop() {
        stopped = true;
        clearInterval(sweep);
        if (client) client.close();
      },
    };
  }

  /* In the artifact everybody is already in one room, so the lobbies are just
     the hosts standing in it -- no announcement channel needed. */
  function browseRoom(opts) {
    let room = null;
    let stopped = false;
    let off = null;

    function report() {
      if (!room || stopped) return;
      const found = new Map();
      for (const peer of room.peers()) {
        const pres = peer.presence;
        if (!pres || !pres.H || !pres.lobby) continue;
        const code = String(pres.lobby).toUpperCase();
        const entry = found.get(code) || { code, host: U.cleanName(pres.n, 12) || 'Somebody', players: 0 };
        found.set(code, entry);
      }
      for (const peer of room.peers()) {
        const pres = peer.presence;
        if (!pres || !pres.lobby) continue;
        const entry = found.get(String(pres.lobby).toUpperCase());
        if (entry) entry.players++;
      }
      opts.onList(Array.from(found.values()).sort((a, b) => b.players - a.players));
    }

    opts.onStatus('Looking for games...');
    window.claude.use('room').then((got) => {
      if (stopped) return;
      if (!got) { opts.onError('This view cannot reach the room, so there is no list.'); return; }
      room = got;
      off = room.onPeers(report);
      opts.onStatus('');
      report();
    }).catch(() => { if (!stopped) opts.onError('The room would not load.'); });

    return { stop() { stopped = true; if (off) off(); } };
  }

  /* ---- the shape everything above this file talks to --------------------- */

  function base(opts) {
    return {
      mode: opts.mode,
      code: opts.code || '',
      id: '',
      ready: false,
      send() {},
      presence() {},
      peers() { return []; },
      announce() {},
      close() {},
    };
  }

  /* ---- loopback --------------------------------------------------------- */

  function openSolo(opts) {
    const self = base(opts);
    self.id = 'me';
    self.ready = true;
    let mine = {};
    let closed = false;

    self.send = (kind, data) => {
      if (closed) return;
      /* Delivered on a later turn, exactly as the networked paths deliver it.
         Making a solo game synchronous would let the host logic depend on an
         ordering that never happens once there is a network involved. */
      setTimeout(() => {
        if (!closed) opts.onMessage({ from: self.id, kind, data, mine: true });
      }, 0);
    };
    self.presence = (patch) => {
      for (const k in patch) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; }
    };
    self.peers = () => [{ id: self.id, presence: mine, isMe: true }];
    self.close = () => { closed = true; };

    setTimeout(() => { opts.onStatus('Playing on this device.'); opts.onReady(); }, 0);
    return self;
  }

  /* ---- public broker ---------------------------------------------------- */

  function openMqtt(opts) {
    const self = base(opts);
    self.id = U.id(10);
    const code = String(opts.code || '').toUpperCase();
    const tPresence = ROOT + code + '/p';
    const tEvent = ROOT + code + '/e';

    const table = new Map();       // id -> { id, presence, isMe, seen }
    let mine = {};
    let client = null;
    let brokerIndex = 0;
    let closed = false;
    let dirty = true;
    let lastSent = 0;
    let pump = null;
    let sweep = null;

    table.set(self.id, { id: self.id, presence: mine, isMe: true, seen: Date.now() });

    function publishPresence(force) {
      if (!client || !client.ready) return;
      const t = Date.now();
      if (!force && !dirty && t - lastSent < KEEPALIVE) return;
      if (t - lastSent < 1000 / PRESENCE_HZ) return;
      lastSent = t;
      dirty = false;
      client.publish(tPresence, { i: self.id, p: mine });
    }

    function forget() {
      const t = Date.now();
      let changed = false;
      for (const [id, peer] of table) {
        if (peer.isMe) continue;
        if (t - peer.seen > GONE) { table.delete(id); changed = true; }
      }
      if (changed) opts.onPeers();
    }

    function connect() {
      if (closed) return;
      if (brokerIndex >= BROKERS.length) {
        opts.onError('No public broker would take the connection. This network may block them, '
          + 'or all three may be down. A phone hotspot usually gets around it.');
        return;
      }
      const broker = BROKERS[brokerIndex++];
      opts.onStatus('Connecting via ' + broker.name + '...');
      client = NS.mqtt.connect({
        url: broker.url,
        clientId: 'ns' + self.id + U.id(4),
        onUp() {
          if (closed) { client.close(); return; }
          client.subscribe(tPresence);
          client.subscribe(tEvent);
          opts.onStatus('Connected via ' + broker.name + '.');
          self.ready = true;
          publishPresence(true);
          opts.onReady(broker);
        },
        onDown(why) {
          if (closed) return;
          if (!self.ready) { connect(); return; }   // this one never worked; try the next
          self.ready = false;
          opts.onError('Lost the connection to ' + broker.name + '. ' + (why || ''));
        },
      });
      if (!client) { connect(); return; }

      client.onMessage((topic, msg) => {
        if (closed || !msg) return;
        if (topic === tPresence) {
          const id = String(msg.i || '');
          if (!id || id === self.id) return;
          let peer = table.get(id);
          if (!peer) {
            peer = { id, presence: {}, isMe: false, seen: 0 };
            table.set(id, peer);
            peer.presence = (msg.p && typeof msg.p === 'object') ? msg.p : {};
            peer.seen = Date.now();
            opts.onPeers();
            return;
          }
          peer.presence = (msg.p && typeof msg.p === 'object') ? msg.p : {};
          peer.seen = Date.now();
          return;
        }
        if (topic === tEvent) {
          const from = String(msg.i || '');
          if (!from) return;
          opts.onMessage({ from, kind: String(msg.k || ''), data: msg.d, mine: from === self.id });
        }
      });
    }

    self.send = (kind, data) => {
      if (closed || !client || !client.ready) return;
      client.publish(tEvent, { i: self.id, k: kind, d: data });
    };
    let lastAnnounce = 0;
    self.announce = (info) => {
      if (closed || !client || !client.ready) return;
      const now = Date.now();
      if (info && now - lastAnnounce < ANNOUNCE_EVERY) return;
      lastAnnounce = now;
      if (!info) client.publish(LOBBIES, { c: code, gone: 1 });
      else client.publish(LOBBIES, { c: code, h: info.host, n: info.players });
    };
    self.presence = (patch) => {
      for (const k in patch) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; }
      dirty = true;
    };
    self.peers = () => Array.from(table.values());
    self.close = () => {
      closed = true;
      clearInterval(pump); clearInterval(sweep);
      if (client) {
        try {
          client.publish(tPresence, { i: self.id, gone: 1 });
          client.publish(LOBBIES, { c: code, gone: 1 });
        } catch (e) {}
        client.close();
      }
    };

    pump = setInterval(publishPresence, Math.floor(1000 / PRESENCE_HZ));
    sweep = setInterval(forget, 700);
    connect();
    return self;
  }

  /* ---- two tabs on one computer ----------------------------------------- */

  /* BroadcastChannel reaches every other tab of the same page with no server,
     no broker and no permission. Two people can share a laptop with it, and --
     the reason it exists -- it is the only way to exercise the guest half of
     this game without fourteen devices: the host and the guest run the real
     code, including the sealed role delivery, in two tabs. */
  function openLocal(opts) {
    const self = base(opts);
    self.id = U.id(10);
    const code = String(opts.code || 'MAIN').toUpperCase();
    const table = new Map();
    let mine = {};
    let closed = false;
    let channel = null;
    let beat = null;
    let sweep = null;

    table.set(self.id, { id: self.id, presence: mine, isMe: true, seen: Date.now() });

    try {
      channel = new BroadcastChannel('nightshift-v2-' + code);
    } catch (e) {
      opts.onError('This browser will not open a channel between tabs.');
      return self;
    }

    const post = (msg) => { if (!closed && channel) channel.postMessage(msg); };

    channel.onmessage = (e) => {
      const msg = e.data;
      if (closed || !msg || msg.i === self.id) return;
      if (msg.p) {
        let peer = table.get(msg.i);
        if (!peer) {
          peer = { id: msg.i, presence: {}, isMe: false, seen: 0 };
          table.set(msg.i, peer);
          peer.presence = msg.p;
          peer.seen = Date.now();
          post({ i: self.id, p: mine });          // say hello back at once
          opts.onPeers();
          return;
        }
        peer.presence = msg.p;
        peer.seen = Date.now();
        return;
      }
      if (msg.gone) {
        if (table.delete(msg.i)) opts.onPeers();
        return;
      }
      if (msg.k) opts.onMessage({ from: msg.i, kind: msg.k, data: msg.d, mine: false });
    };

    self.send = (kind, data) => {
      if (closed) return;
      /* Your own messages come back to you on every other transport, so they
         have to here too, or the host would not hear itself. */
      opts.onMessage({ from: self.id, kind, data, mine: true });
      post({ i: self.id, k: kind, d: data });
    };
    self.presence = (patch) => {
      for (const k in patch) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; }
    };
    self.peers = () => Array.from(table.values());
    self.close = () => {
      closed = true;
      clearInterval(beat); clearInterval(sweep);
      if (channel) { post({ i: self.id, gone: 1 }); channel.close(); }
    };

    beat = setInterval(() => post({ i: self.id, p: mine }), Math.floor(1000 / PRESENCE_HZ));
    sweep = setInterval(() => {
      const t = Date.now();
      let changed = false;
      for (const [id, peer] of table) {
        if (peer.isMe) continue;
        if (t - peer.seen > GONE) { table.delete(id); changed = true; }
      }
      if (changed) opts.onPeers();
    }, 700);

    self.ready = true;
    setTimeout(() => {
      if (closed) return;
      post({ i: self.id, p: mine });
      opts.onStatus('Playing across tabs on this computer.');
      opts.onReady();
    }, 0);
    return self;
  }

  /* ---- the artifact room ------------------------------------------------ */

  function openRoom(opts) {
    const self = base(opts);
    const code = String(opts.code || 'MAIN').toUpperCase();
    let room = null;
    let mine = {};
    let closed = false;
    let started = false;
    let waiting = null;
    const unsubs = [];

    /* One topic per direction, all three opened to `interact` at publish time
       so a viewer who can only view the page can still play it. A topic that
       is not opened is admin-only, and the class would be able to walk around
       and do nothing else. */
    const TOPICS = ['act', 'sys', 'chat'];

    /* Everybody viewing the page is in one room, so several games can run in
       it at once and each has to ignore the others. The key is `lobby` and not
       something shorter for a reason: presence already carries `c` for the
       player's colour, and a two-games-at-once filter that silently matched a
       colour index would have made the room look empty to everybody. */
    const LOBBY = 'lobby';

    self.send = (kind, data) => {
      if (closed || !room || TOPICS.indexOf(kind) < 0) return;
      room.emit(kind, { lobby: code, d: data }).catch((e) => {
        if (e && e.code === 'not_permitted') {
          opts.onError('This page was published without the game topics open, so nothing you do '
            + 'can reach the others. Republishing it fixes that.');
        }
      });
    };
    self.presence = (patch) => {
      for (const k in patch) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; }
      if (room && !closed) {
        const out = {};
        for (const k in patch) out[k] = patch[k];
        out[LOBBY] = code;
        room.presence(out).catch(() => {});
      }
    };
    self.peers = () => {
      if (!room) return [{ id: self.id, presence: mine, isMe: true }];
      return room.peers()
        .filter((p) => p.kind === 'viewer' && p.presence && p.presence[LOBBY] === code)
        .map((p) => ({ id: p.peer, presence: p.presence, isMe: !!(p.isMe && p.sameTab) }));
    };
    self.close = () => {
      closed = true;
      clearTimeout(waiting);
      unsubs.forEach((fn) => { try { fn(); } catch (e) {} });
    };

    /* The game cannot start until this view knows its own peer id: every
       player in a snapshot is keyed by it, so starting a moment early would
       give this device an entity nobody else has heard of and a second one
       arriving in the first snapshot. The id comes from the first onPeers,
       not from `use()`, so readiness waits for it. */
    function begin() {
      if (started || closed) return;
      const me = room.peers().find((p) => p.isMe && p.sameTab);
      if (!me) return;
      started = true;
      clearTimeout(waiting);
      self.id = me.peer;
      self.ready = true;
      opts.onStatus('In the room.');
      opts.onReady();
      opts.onPeers();
    }

    opts.onStatus('Looking for the others...');
    window.claude.use('room').then((got) => {
      if (closed) return;
      if (!got) {
        opts.onError('This view cannot reach the room. That usually means you are signed out, '
          + 'or the page was shared outside the organisation that published it. '
          + 'Practice mode works either way.');
        return;
      }
      room = got;
      for (const topic of TOPICS) {
        unsubs.push(room.on(topic, (msg) => {
          if (closed || !msg || !msg.data || msg.data.lobby !== code) return;
          opts.onMessage({
            from: msg.peer, kind: topic, data: msg.data.d,
            mine: !!(msg.isMe && msg.sameTab),
          });
        }, (err) => opts.onError('The room closed: ' + (err && err.message ? err.message : 'unknown'))));
      }
      unsubs.push(room.onPeers(() => {
        if (closed) return;
        if (!started) begin(); else opts.onPeers();
      }));
      self.presence({});
      begin();
      waiting = setTimeout(() => {
        if (!started && !closed) {
          opts.onError('The room never said who this device is, so it cannot join a game here. '
            + 'Practice mode still works.');
        }
      }, 8000);
    }).catch(() => {
      if (!closed) opts.onError('The room capability failed to load. Practice mode still works.');
    });

    return self;
  }

  function open(opts) {
    const wired = {
      mode: opts.mode,
      code: opts.code,
      onStatus: opts.onStatus || function () {},
      onReady: opts.onReady || function () {},
      onError: opts.onError || function () {},
      onMessage: opts.onMessage || function () {},
      onPeers: opts.onPeers || function () {},
    };
    if (opts.mode === 'room') return openRoom(wired);
    if (opts.mode === 'mqtt') return openMqtt(wired);
    if (opts.mode === 'local') return openLocal(wired);
    return openSolo(wired);
  }

  NS.link = { open, browse, preferred, roomAvailable, mqttAvailable, localAvailable, BROKERS };
})(window.NS);
