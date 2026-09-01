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

  global.GWLink = { openBroadcast, openPeer, webrtcAvailable, broadcastAvailable, newId };
})(window);
