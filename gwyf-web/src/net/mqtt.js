/* Just enough MQTT to find other people.

   A lobby list is shared state that strangers have to discover, and strangers
   cannot discover each other peer to peer -- something has to be in the middle.
   There is no server here and there is nowhere to run one, so the middle is a
   public MQTT broker: free, anonymous, spoken over a WebSocket, and run by
   somebody else for anybody who wants it.

   This is MQTT 3.1.1 with everything not needed thrown out. CONNECT, SUBSCRIBE,
   PUBLISH at QoS 0, and a ping to keep the socket up -- about two hundred lines
   against the ~100 KB the usual client library costs, in a project that ships
   as one file and has hand-rolled everything else for the same reason.

   What is deliberately not here: QoS 1 and 2, retained messages, wills, and
   session persistence. Everything this sends is a position update or a lobby
   announcement that is repeated a second later anyway, so a dropped packet
   costs nothing and an acknowledgement round trip would cost more than the
   packet is worth.

   Be clear about what a public broker is: unauthenticated and unencrypted at
   the application layer. Anybody who knows the topic can read what is on it or
   write to it. That is fine for what this carries -- names, positions and the
   contents of an imaginary bank account -- and it is said plainly in the
   interface rather than left to be discovered. */

(function (global) {
  'use strict';

  const CONNECT = 1, CONNACK = 2, PUBLISH = 3, SUBSCRIBE = 8, SUBACK = 9,
        PINGREQ = 12, PINGRESP = 13, DISCONNECT = 14;
  const KEEPALIVE = 45;

  /* MQTT counts a length in a base-128 varint, seven bits at a time with the
     top bit as a continuation flag. */
  function varint(n) {
    const out = [];
    do {
      let byte = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) byte |= 0x80;
      out.push(byte);
    } while (n > 0);
    return out;
  }

  function readVarint(bytes, at) {
    let value = 0, shift = 1, i = at;
    for (let k = 0; k < 4; k++) {
      const byte = bytes[i++];
      if (byte === undefined) return null;
      value += (byte & 127) * shift;
      if ((byte & 128) === 0) return { value, at: i };
      shift *= 128;
    }
    return null;
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function str(s) {
    const b = encoder.encode(s);
    return [b.length >> 8, b.length & 255, ...b];
  }

  function packet(type, flags, payload) {
    return new Uint8Array([(type << 4) | flags, ...varint(payload.length), ...payload]);
  }

  /* Connect to a broker and hand back something that can publish, subscribe and
     say when it has fallen over. `onUp` fires once the broker has accepted the
     connection, not merely once the socket is open -- they are not the same
     thing and acting on the second is how you publish into a void. */
  function connect(opts) {
    const url = opts.url;
    const clientId = opts.clientId || ('gwyf' + Math.random().toString(36).slice(2, 12));
    const handlers = new Set();
    let ws = null;
    let up = false;
    let ping = null;
    let nextId = 1;
    let buffer = new Uint8Array(0);
    let closed = false;

    function fail(why) {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      try { ws && ws.close(); } catch (e) { /* already gone */ }
      if (opts.onDown) opts.onDown(why);
    }

    try {
      // The subprotocol matters: brokers reject a plain WebSocket on the MQTT
      // endpoint, and the failure looks exactly like the network being down.
      ws = new WebSocket(url, 'mqtt');
    } catch (err) {
      fail(err.message);
      return null;
    }
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      const payload = [
        ...str('MQTT'), 4,          // protocol name and level
        0x02,                       // clean session, no will, no credentials
        KEEPALIVE >> 8, KEEPALIVE & 255,
        ...str(clientId),
      ];
      ws.send(packet(CONNECT, 0, payload));
    };

    ws.onerror = () => fail('the broker could not be reached');
    ws.onclose = () => fail('the connection to the broker closed');

    ws.onmessage = (e) => {
      const chunk = new Uint8Array(e.data);
      const merged = new Uint8Array(buffer.length + chunk.length);
      merged.set(buffer);
      merged.set(chunk, buffer.length);
      buffer = merged;
      // A WebSocket frame is not an MQTT packet: one frame can carry several
      // packets and one packet can span frames, so it is drained as a stream.
      for (;;) {
        if (buffer.length < 2) return;
        const header = readVarint(buffer, 1);
        if (!header) return;
        const total = header.at + header.value;
        if (buffer.length < total) return;
        handle(buffer[0] >> 4, buffer.subarray(header.at, total));
        buffer = buffer.subarray(total);
      }
    };

    function handle(type, body) {
      if (type === CONNACK) {
        // Byte 1 is the return code; anything but zero is a refusal, and the
        // reason is worth passing on rather than reporting "it did not work".
        if (body[1] !== 0) return fail('the broker refused the connection (code ' + body[1] + ')');
        up = true;
        ping = setInterval(() => {
          if (ws.readyState === 1) ws.send(packet(PINGREQ, 0, []));
        }, KEEPALIVE * 500);
        if (opts.onUp) opts.onUp();
        return;
      }
      if (type === PUBLISH) {
        const len = (body[0] << 8) | body[1];
        const topic = decoder.decode(body.subarray(2, 2 + len));
        const text = decoder.decode(body.subarray(2 + len));
        let data = null;
        try { data = JSON.parse(text); } catch (err) { return; }
        for (const fn of Array.from(handlers)) fn(topic, data);
        return;
      }
      // SUBACK, PINGRESP and the rest need no action; the broker having
      // answered at all is the only information in them we use.
    }

    return {
      get ready() { return up && ws && ws.readyState === 1; },
      publish(topic, value) {
        if (!up || ws.readyState !== 1) return false;
        const payload = [...str(topic), ...encoder.encode(JSON.stringify(value))];
        ws.send(packet(PUBLISH, 0, payload));
        return true;
      },
      subscribe(topic) {
        if (!up || ws.readyState !== 1) return false;
        const id = nextId++ & 0xffff;
        ws.send(packet(SUBSCRIBE, 2, [id >> 8, id & 255, ...str(topic), 0]));
        return true;
      },
      onMessage(fn) { handlers.add(fn); return () => handlers.delete(fn); },
      close() {
        if (up && ws && ws.readyState === 1) {
          try { ws.send(packet(DISCONNECT, 0, [])); } catch (e) { /* going anyway */ }
        }
        closed = true;
        clearInterval(ping);
        try { ws && ws.close(); } catch (e) { /* already gone */ }
      },
    };
  }

  global.GWMqtt = { connect };
})(window);
