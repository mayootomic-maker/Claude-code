/* A real MQTT broker on localhost, for testing the public-lobby code against
   something that actually speaks the protocol.

   The public brokers cannot be reached from this container -- the outbound
   proxy refuses to tunnel a WebSocket, so every one of the three times out.
   Testing the client against a mock I wrote myself would only prove that my
   idea of MQTT agrees with itself. aedes is a third-party implementation of
   the same spec; if the hand-rolled client can log into it, subscribe and
   exchange messages, the packet encoding is right. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire('/tmp/mqtttest/');
const { Aedes } = require('aedes');
const { WebSocketServer, createWebSocketStream } = require('ws');

/* aedes 1.x will not serve a client until `listen()` has run -- the constructor
   alone leaves it without persistence and it drops every CONNECT in silence,
   which reads exactly like a broken client. */
export async function startBroker(port = 0) {
  const aedes = await Aedes.createBroker();
  const http = createServer();
  /* Real MQTT brokers answer with the `mqtt` subprotocol, and a browser fails
     the connection outright if it offered one and the server named none. Not
     doing this made the client look broken when it was the test that was. */
  const wss = new WebSocketServer({
    server: http,
    handleProtocols: (protocols) => (protocols.has('mqtt') ? 'mqtt' : false),
  });
  wss.on('connection', (ws) => {
    const stream = createWebSocketStream(ws);
    stream.on('error', () => {});
    aedes.handle(stream);
  });
  return new Promise((ok) => {
    http.listen(port, '127.0.0.1', () => {
      const url = 'ws://127.0.0.1:' + http.address().port;
      ok({ url, close: () => new Promise((r) => { wss.close(); http.close(() => r()); aedes.close(); }) });
    });
  });
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const b = await startBroker(9001);
  console.log('broker on ' + b.url);
}
