/* Talking to another copy of the game.

   Two transports, because the two places this page runs have very different
   rules about the network.

   **Same computer.** `BroadcastChannel` connects tabs and windows of the same
   origin with no setup and no server at all. Open the page twice and you are
   playing together. This works everywhere the page works.

   **Different computers.** A WebRTC data channel, peer to peer, with the
   signalling done by hand: the host produces a block of text, the guest pastes
   it in and hands back a block of its own, and after that the two browsers talk
   directly with nothing in between. It needs no server, which is the only
   reason it is possible here at all -- there is nowhere to run one.

   What this deliberately does not do is pretend. Inside the artifact viewer
   WebRTC is not merely blocked, it is removed: the host page defines
   RTCPeerConnection as undefined before any of this loads. So `webrtcAvailable`
   is checked up front and the interface says so, rather than offering a button
   that cannot work.

   Messages are plain objects with a `t` (type) field. Nothing here knows what
   any of them mean; that is session.js. */

(function (global) {
  'use strict';

  const CHANNEL = 'gwyf-table';
  /* Public STUN is the one piece of outside help a peer connection needs, and
     only to discover its own address. Two machines on the same network connect
     without it. If it is unreachable the offer still forms -- it just carries
     fewer candidates, so it will work on a LAN and may not across the internet,
     which the interface says rather than leaving you to find out. */
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' },
               { urls: 'stun:global.stun.twilio.com:3478' }];

  function webrtcAvailable() {
    return typeof global.RTCPeerConnection === 'function';
  }

  function broadcastAvailable() {
    return typeof global.BroadcastChannel === 'function';
  }

  function newId() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID().slice(0, 8);
    return Math.random().toString(36).slice(2, 10);
  }

  function emitter() {
    const handlers = new Map();
    return {
      on(type, fn) {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type).add(fn);
        return () => handlers.get(type).delete(fn);
      },
      emit(type, payload, from) {
        const set = handlers.get(type);
        if (set) for (const fn of Array.from(set)) fn(payload, from);
        const all = handlers.get('*');
        if (all) for (const fn of Array.from(all)) fn({ t: type, d: payload }, from);
      },
    };
  }

  /* --- same computer, many windows ----------------------------------------- */

  function openBroadcast(opts) {
    const bus = emitter();
    const me = (opts && opts.id) || newId();
    const channel = new global.BroadcastChannel(CHANNEL);

    channel.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.from === me) return;
      // Addressed messages are ignored by everyone else. A channel is a room,
      // not a wire, so this is all that separates a whisper from a shout.
      if (msg.to && msg.to !== me) return;
      bus.emit(msg.t, msg.d, msg.from);
    };

    return {
      kind: 'local',
      id: me,
      on: bus.on,
      send(t, d, to) { channel.postMessage({ t, d, from: me, to: to || null }); },
      close() { try { channel.close(); } catch (e) { /* already gone */ } },
      get ready() { return true; },
      describe: 'Other windows on this computer',
    };
  }

  /* --- different computers -------------------------------------------------- */

  /* One peer connection, signalled by copy and paste.

     `createOffer` gives the host a blob to send however they like; `accept`
     takes the guest's answer back. The guest does the mirror image with
     `answerOffer`. Both wait for ICE gathering before handing over a blob,
     because a half-gathered offer connects only sometimes, and "sometimes" is
     the worst possible thing to debug through a chat window. */
  function openPeer(opts) {
    const bus = emitter();
    const me = (opts && opts.id) || newId();
    const pc = new global.RTCPeerConnection({ iceServers: ICE });
    let channel = null;
    let open = false;

    function wire(dc) {
      channel = dc;
      dc.onopen = () => { open = true; bus.emit('__open', null, me); };
      dc.onclose = () => { open = false; bus.emit('__close', null, me); };
      dc.onmessage = (e) => {
        let msg = null;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (msg && msg.t) bus.emit(msg.t, msg.d, msg.from || 'peer');
      };
    }

    if (opts && opts.host) wire(pc.createDataChannel('gwyf', { ordered: false, maxRetransmits: 1 }));
    else pc.ondatachannel = (e) => wire(e.channel);

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        open = false;
        bus.emit('__close', null, me);
      }
    };

    /* Wait for the candidates. Chrome fires an empty candidate to say it is
       done; the timeout is there because some networks never finish gathering,
       and a blob with the candidates it has beats no blob at all. */
    function gathered() {
      if (pc.iceGatheringState === 'complete') return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(done, 2500);
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') done();
        };
      });
    }

    const pack = (sdp) => btoa(JSON.stringify({ id: me, sdp }));
    const unpack = (blob) => JSON.parse(atob(String(blob).replace(/\s+/g, '')));

    return {
      kind: 'peer',
      id: me,
      on: bus.on,
      send(t, d) {
        if (!open || !channel) return false;
        try { channel.send(JSON.stringify({ t, d, from: me })); return true; }
        catch (err) { return false; }
      },
      get ready() { return open; },
      describe: 'Another computer, peer to peer',

      async createOffer() {
        await pc.setLocalDescription(await pc.createOffer());
        await gathered();
        return pack(pc.localDescription);
      },
      async answerOffer(blob) {
        const { sdp } = unpack(blob);
        await pc.setRemoteDescription(sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered();
        return pack(pc.localDescription);
      },
      async accept(blob) {
        const { sdp } = unpack(blob);
        await pc.setRemoteDescription(sdp);
      },
      close() { try { pc.close(); } catch (e) { /* already gone */ } },
    };
  }

  /* --- anyone on the internet ----------------------------------------------

     The third transport, and the only one that lets a stranger find you. Both
     of the others need something arranged out of band -- the same computer, or
     a code passed hand to hand -- because two browsers cannot discover each
     other on their own. This uses a public MQTT broker as the meeting point:
     free, anonymous, run by somebody else for anybody who wants it, and spoken
     over an ordinary WebSocket.

     Everything lives on two topics. Hosts announce themselves on a shared one
     every few seconds and stop when they stop; everyone browsing subscribes to
     it and forgets a lobby that has gone quiet. A room then has a topic of its
     own that the whole game runs over -- the same messages the other transports
     carry, which is why nothing above this layer knows the difference.

     Where this cannot work, and why:

       - Inside the claude.ai artifact viewer, where the page's connect-src
         allows nothing but the font host. A WebSocket to a broker is refused
         before it is opened. `available()` says so rather than hanging.
       - On networks that block the broker's port, which some do.

     And what it is: an unauthenticated public bus. Anybody who knows the topic
     can read what is on it or join what is announced on it. That is stated in
     the interface, not left to be found out. */

  /* More than one, because a public broker is somebody else's goodwill and any
     of them can be down, full or blocked. They are tried in order. */
  const BROKERS = [
    { url: 'wss://broker.emqx.io:8084/mqtt', name: 'EMQX' },
    { url: 'wss://broker.hivemq.com:8884/mqtt', name: 'HiveMQ' },
    { url: 'wss://test.mosquitto.org:8081/mqtt', name: 'Mosquitto' },
  ];
  const TOPIC = 'gwyf/v1/lobbies';
  const ROOM = 'gwyf/v1/room/';
  const ANNOUNCE = 3000;        // how often a host says it is still there
  const FORGET = 11000;         // and how long a lobby lives without being said

  function openAvailable() {
    return typeof global.WebSocket === 'function';
  }

  /* Watch the lobby list without joining anything. `onList` gets the whole list
     every time it changes. */
  function browseLobbies(opts) {
    const seen = new Map();
    let client = null;
    let index = 0;
    let stopped = false;
    let sweep = null;

    function announce() {
      const now = Date.now();
      let changed = false;
      for (const [id, lobby] of seen) {
        if (now - lobby.at > FORGET) { seen.delete(id); changed = true; }
      }
      if (changed && opts.onList) opts.onList(list());
    }

    const list = () => Array.from(seen.values())
      .sort((a, b) => b.at - a.at)
      .map((l) => ({ id: l.id, host: l.host, players: l.players, day: l.day }));

    function tryNext() {
      if (stopped) return;
      if (index >= BROKERS.length) {
        if (opts.onError) {
          opts.onError('No public broker would take the connection. The network here may '
            + 'block them, or they may all be down.');
        }
        return;
      }
      const broker = BROKERS[index++];
      if (opts.onStatus) opts.onStatus('Looking for lobbies via ' + broker.name + '…');
      client = GWMqtt.connect({
        url: broker.url,
        onUp() {
          if (stopped) { client.close(); return; }
          client.subscribe(TOPIC);
          if (opts.onStatus) opts.onStatus('Connected via ' + broker.name + '.');
          if (opts.onReady) opts.onReady(client, broker);
        },
        onDown() {
          if (stopped || !client) return;
          // Only fall through to the next broker if this one never worked.
          if (!seen.size) tryNext();
          else if (opts.onError) opts.onError('Lost the connection to ' + broker.name + '.');
        },
      });
      if (!client) { tryNext(); return; }
      client.onMessage((topic, data) => {
        if (topic !== TOPIC || !data || !data.id) return;
        if (data.gone) {
          if (seen.delete(data.id) && opts.onList) opts.onList(list());
          return;
        }
        seen.set(data.id, {
          id: String(data.id).slice(0, 24),
          host: String(data.host || 'Somebody').slice(0, 16),
          players: Math.max(1, Math.min(16, data.players | 0)),
          day: Math.max(1, Math.min(99, data.day | 0)),
          at: Date.now(),
        });
        if (opts.onList) opts.onList(list());
      });
      sweep = setInterval(announce, 1500);
    }

    tryNext();
    return {
      list,
      stop() {
        stopped = true;
        clearInterval(sweep);
        if (client) client.close();
        client = null;
      },
      get client() { return client; },
    };
  }

  /* Join or host a room over the broker. Satisfies the same shape as the other
     two transports, so session.js cannot tell which one it has. */
  function openOpen(opts) {
    const bus = emitter();
    const me = (opts && opts.id) || newId();
    const lobbyId = opts.lobbyId || newId();
    const isHost = !!opts.host;
    const topic = ROOM + lobbyId;
    let client = null;
    let beat = null;
    let ready = false;

    const browser = browseLobbies({
      onStatus: opts.onStatus,
      onError: opts.onError,
      onReady(c) {
        client = c;
        client.subscribe(topic);
        ready = true;
        client.onMessage((t, data) => {
          if (t !== topic || !data || !data.t) return;
          if (data.from === me) return;
          if (data.to && data.to !== me) return;
          bus.emit(data.t, data.d, data.from);
        });
        if (isHost) {
          const say = () => client.publish(TOPIC, {
            id: lobbyId,
            host: opts.name || 'Somebody',
            players: 1 + (opts.countPeers ? opts.countPeers() : 0),
            day: opts.day ? opts.day() : 1,
          });
          say();
          beat = setInterval(say, ANNOUNCE);
        }
        bus.emit('__open', null, me);
        if (opts.onOpen) opts.onOpen();
      },
    });

    return {
      kind: 'open',
      id: me,
      lobbyId,
      on: bus.on,
      send(t, d, to) {
        if (!client || !ready) return false;
        return client.publish(topic, { t, d, from: me, to: to || null });
      },
      get ready() { return ready; },
      describe: 'Anyone on the internet',
      close() {
        clearInterval(beat);
        // Take the lobby off the list on the way out rather than leaving it to
        // time out, so nobody spends ten seconds joining something that is gone.
        if (isHost && client) client.publish(TOPIC, { id: lobbyId, gone: true });
        browser.stop();
        client = null;
        ready = false;
      },
    };
  }

  global.GWLink = {
    openBroadcast, openPeer, openOpen, browseLobbies,
    webrtcAvailable, broadcastAvailable, openAvailable, newId, BROKERS,
  };
})(window);
