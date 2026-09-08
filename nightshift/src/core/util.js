/* Small things everything else needs.

   One global, `NS`, with a namespace per file. The build inlines these scripts
   in dependency order, so there is no module loader and nothing to install --
   the built page opens from a file:// URL, which is how a class actually gets
   to play it without anybody hosting anything. */

window.NS = window.NS || {};

(function (NS) {
  'use strict';

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* Angle-aware lerp, for turning a body toward a heading without spinning it
     the long way round. */
  function lerpAngle(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  /* Seeded RNG. Role assignment and task dealing run on the host, and being
     able to replay a deal from its seed is what made the balance testable. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rand) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const swap = out[i];
      out[i] = out[j];
      out[j] = swap;
    }
    return out;
  }

  const pick = (list, rand) => list[Math.floor(rand() * list.length)];

  /* Room codes people read out loud across a classroom. No vowels, so a code
     can never spell anything, and none of 0/O/1/I/5/S, which get misheard and
     mistyped more than any other characters. */
  const CODE_ALPHABET = 'BCDFGHJKMNPQRTVWXYZ2346789';
  function roomCode(len) {
    const bytes = new Uint8Array(len || 4);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return out;
  }

  function id(len) {
    const n = len || 8;
    const bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => (b % 36).toString(36)).join('').slice(0, n);
  }

  /* Everything a player types is drawn by us and never handed to innerHTML,
     but names also travel through a public broker, so they are cleaned on the
     way in as well as on the way out: no control characters, no direction
     marks, no zero-width padding to fake a longer name or a blank one.
     Written as escapes on purpose -- a literal invisible character in the
     source is a thing nobody can review. */
  const INVISIBLE = new RegExp(
    '[\\u0000-\\u001F\\u007F-\\u009F\\u00AD\\u034F\\u061C\\u115F\\u1160'
    + '\\u17B4\\u17B5\\u180B-\\u180E\\u200B-\\u200F\\u202A-\\u202E'
    + '\\u2060-\\u206F\\u3164\\uFE00-\\uFE0F\\uFEFF\\uFFA0\\uFFF9-\\uFFFB]', 'g');

  function cleanName(raw, max) {
    return String(raw == null ? '' : raw)
      .replace(INVISIBLE, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || 12);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* mm:ss over a minute, plain seconds under it -- a meeting timer reading
     "0:09" at the end is harder to read at a glance than one reading "9". */
  function clock(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    if (s < 60) return String(s);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

  /* Local storage that never throws. Private windows, and iOS with site data
     switched off, make `localStorage` throw on access and not only on write,
     so every touch of it is wrapped. Losing a saved nickname is nothing;
     losing the page to an uncaught exception on load is everything. */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('nightshift.' + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('nightshift.' + key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
  };

  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      }
    }
    if (kids) for (const kid of [].concat(kids)) if (kid) node.appendChild(kid);
    return node;
  }

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* One clock for the whole game. Countdowns measure against performance.now()
     and the host ships seconds remaining rather than a deadline, because two
     phones in the same room do not agree on what time it is. */
  const now = () => performance.now();

  NS.util = {
    clamp, lerp, lerpAngle, mulberry32, shuffle, pick, roomCode, id,
    cleanName, escapeHtml, clock, dist, dist2, store, el, $, $$, now,
  };
})(window.NS);
