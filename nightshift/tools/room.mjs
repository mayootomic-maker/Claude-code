/* The artifact transport, against a stand-in for the room capability.

   Inside the claude.ai viewer the game finds players through `claude.use
   ("room")` rather than a broker, and none of that code can run here: there is
   no `window.claude` outside the viewer. Publishing it untested is how you
   discover, from a class of thirty, that the lobby filter was reading the
   player's colour.

   So the contract is stood up locally -- emit/on, presence/onPeers, peers()
   with the same `peer`/`isMe`/`sameTab`/`kind` shape -- over a BroadcastChannel
   between two tabs, and the real net/link.js talks to it. This proves this
   game's use of the contract, not the platform's implementation of it: the
   shim is written from the type definitions and is only as right as they are.
   What it does catch is every assumption on our side of the line. */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + resolve(here, '..', 'nightshift.html');

const problems = [];
let checks = 0;
function check(ok, what) {
  checks++;
  console.log((ok ? '  ok   ' : '  FAIL ') + what);
  if (!ok) problems.push(what);
}

const SHIM = () => {
  const channel = new BroadcastChannel('fake-artifact-room');
  const me = Math.random().toString(36).slice(2, 12);
  const presence = {};
  const others = new Map();
  const topicHandlers = new Map();
  const peerHandlers = new Set();
  let opened = false;

  const shape = (peer, own, isMe) => ({
    peer, by: null, isMe, sameTab: isMe, kind: 'viewer',
    presence: Object.freeze(Object.assign({}, own)), updatedAt: Date.now(),
  });

  function peers() {
    const out = [shape(me, presence, true)];
    for (const [id, p] of others) out.push(shape(id, p, false));
    return Object.freeze(out);
  }
  function announce() {
    const list = peers();
    for (const fn of peerHandlers) fn({ peers: list, joined: list, left: [], updated: [] });
  }

  channel.onmessage = (e) => {
    const m = e.data;
    if (!m || m.from === me) return;
    if (m.kind === 'presence') {
      others.set(m.from, m.presence);
      channel.postMessage({ from: me, kind: 'presence', presence });
      announce();
      return;
    }
    if (m.kind === 'event') {
      const set = topicHandlers.get(m.topic);
      if (!set) return;
      for (const fn of set) fn({ peer: m.from, by: null, isMe: false, sameTab: false, kind: 'viewer', topic: m.topic, data: m.data });
    }
  };

  const room = {
    emit(topic, data) {
      channel.postMessage({ from: me, kind: 'event', topic, data });
      /* The real room hands your own moments back to you. */
      const set = topicHandlers.get(topic);
      if (set) {
        for (const fn of Array.from(set)) {
          setTimeout(() => fn({ peer: me, by: null, isMe: true, sameTab: true, kind: 'viewer', topic, data }), 0);
        }
      }
      return Promise.resolve();
    },
    on(topic, handler) {
      if (!topicHandlers.has(topic)) topicHandlers.set(topic, new Set());
      topicHandlers.get(topic).add(handler);
      return () => topicHandlers.get(topic).delete(handler);
    },
    presence(patch) {
      for (const k in patch) { if (patch[k] === null) delete presence[k]; else presence[k] = patch[k]; }
      channel.postMessage({ from: me, kind: 'presence', presence });
      return Promise.resolve();
    },
    peers,
    onPeers(handler) {
      peerHandlers.add(handler);
      /* "no earlier than a microtask", and never synchronously. */
      setTimeout(() => {
        if (!peerHandlers.has(handler)) return;
        const list = peers();
        handler({ peers: list, joined: list, left: [], updated: [] });
      }, 0);
      return () => peerHandlers.delete(handler);
    },
    connected: () => true,
    onConnection(fn) { setTimeout(() => fn(true), 0); return () => {}; },
  };

  window.claude = {
    use(name) {
      return new Promise((r) => setTimeout(() => r(name === 'room' ? room : null), 40));
    },
  };
  setInterval(() => channel.postMessage({ from: me, kind: 'presence', presence }), 400);
  setInterval(announce, 500);
  opened = true;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
await context.addInitScript(SHIM);

function watch(page, who) {
  page.on('pageerror', (e) => console.log('  [' + who + ' error] ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/fonts\.googleapis|favicon|ERR_/.test(t)) return;
    problems.push(who + ' console: ' + t);
  });
  page.on('pageerror', (e) => problems.push(who + ' page error: ' + e.message));
}

const host = await context.newPage();
watch(host, 'host');
const guest = await context.newPage();
watch(guest, 'guest');

for (const [page, name] of [[host, 'Ada'], [guest, 'Bo']]) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.screen--title', { timeout: 20000 });
  await page.fill('.field', name);
}

check(await host.evaluate(() => window.NS.link.roomAvailable()),
  'the game notices it is inside a room');

await host.click('.btn--primary.btn--big');
await host.waitForSelector('.screen--lobby', { timeout: 10000 });
const mode = await host.evaluate(() => window.NS.session.mode);
check(mode === 'room', 'it chose the room transport, not a broker (' + mode + ')');

const hostId = await host.evaluate(() => window.NS.session.myId);
check(!!hostId && hostId === await host.evaluate(() => window.NS.world.me.id),
  'the local player is keyed by the room\'s own peer id');

const code = (await host.textContent('.code strong')).trim();
await guest.fill('.field--code', code);
await guest.click('.join-row .btn--ghost');
await guest.waitForSelector('.screen--lobby', { timeout: 10000 });
await guest.waitForTimeout(1800);

check(await host.evaluate(() => Array.from(window.NS.world.players.values()).some((p) => p.name === 'Bo')),
  'the host sees the guest through the room');
check(await guest.evaluate(() => Array.from(window.NS.world.players.values()).some((p) => p.name === 'Ada')),
  'the guest sees the host');

/* The colour index and the lobby code both used to be called `c`. If that ever
   comes back the room looks empty, so it is checked by name. */
const presenceKeys = await host.evaluate(() =>
  Object.keys(window.NS.session.link.peers().find((p) => !p.isMe).presence).sort().join(','));
check(/(^|,)lobby(,|$)/.test(presenceKeys), 'the lobby filter has a key of its own (' + presenceKeys + ')');

/* A second game in the same room must be invisible to the first. Injected as
   a peer rather than as a third browser page: what is being tested is the
   lobby filter, and three copies of a game carrying a thirty-megabyte canvas
   in one browser tests the machine instead. */
await host.evaluate(() => {
  const channel = new BroadcastChannel('fake-artifact-room');
  channel.postMessage({
    from: 'somebody-elses-game',
    kind: 'presence',
    presence: { lobby: 'ZZZZ', n: 'Cass', c: 2, h: 0, x: 100, y: 100 },
  });
});
await host.waitForTimeout(1000);
check(!(await host.evaluate(() => window.NS.session.link.peers().some((p) => p.id === 'somebody-elses-game'))),
  'a different lobby in the same room is filtered out');
check(!(await host.evaluate(() => Array.from(window.NS.world.players.values()).some((p) => p.name === 'Cass'))),
  'and never reaches the game');

for (let i = 0; i < 2; i++) { await host.click('.bot-row .btn:last-of-type'); await host.waitForTimeout(150); }
await host.waitForTimeout(1200);

await host.click('.lobby-buttons .btn--primary');
await host.waitForSelector('.reveal', { timeout: 10000 });
await guest.waitForSelector('.reveal', { timeout: 10000 });
check(true, 'the round starts on both devices over the room');

const roles = await Promise.all([
  host.evaluate(() => window.NS.world.myRole),
  guest.evaluate(() => window.NS.world.myRole),
]);
check(!!roles[0] && !!roles[1], 'both were dealt a sealed role (' + roles.join(' / ') + ')');

/* One entity per person: the id-timing bug produced two of you. */
const doubled = await guest.evaluate(() => {
  const names = Array.from(window.NS.world.players.values()).map((p) => p.name);
  return names.length !== new Set(names).size;
});
check(!doubled, 'nobody appears twice');

await browser.close();

if (problems.length) {
  console.log('\n' + problems.length + ' problem(s):');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log('\nclean: ' + checks + ' checks against the room contract');
