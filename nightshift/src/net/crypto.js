/* Keeping the one secret the game actually has.

   Every transport under this game is a broadcast. MQTT is a public bus, and
   the room capability delivers everything to everyone -- there is no private
   channel to send a role down. So a role handed out in the clear is a role
   anybody can read with the network tab open, and the whole round is over
   before it starts. One person in a class of thirty will try this.

   So: every player makes an ECDH keypair on the way in and publishes the
   public half in their presence. The host derives a separate shared secret
   with each player and encrypts that player's role to it. The ciphertext goes
   out on the same public channel as everything else and only its owner can
   read it -- deriving the secret needs one of the two private keys, and
   neither ever leaves the device that made it.

   What this does NOT do, said plainly rather than left to be discovered:
   positions, kills and votes still travel in the open, because every client
   has to draw them. Somebody reading the wire can tell where people are. The
   defence against that is that it takes real effort and the game is over in
   ten minutes -- not that it is impossible. Roles are worth protecting
   because knowing them once ruins every round; the rest is worth exactly the
   twenty lines below and no more. */

(function (NS) {
  'use strict';

  const subtle = (window.crypto && window.crypto.subtle) || null;
  const CURVE = { name: 'ECDH', namedCurve: 'P-256' };
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function fromBase64(text) {
    const raw = atob(String(text));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  let pair = null;
  let publicKey = null;          // base64, goes in presence
  const derived = new Map();     // their public key -> AES key

  /* Made once per page load. If it fails -- an insecure origin, an old
     browser -- `available` stays false and the game says so in the lobby
     rather than pretending. */
  let available = false;
  async function init() {
    if (!subtle) return false;
    try {
      pair = await subtle.generateKey(CURVE, false, ['deriveKey']);
      publicKey = toBase64(await subtle.exportKey('raw', pair.publicKey));
      available = true;
    } catch (e) {
      available = false;
    }
    return available;
  }

  async function keyFor(theirPublicKey) {
    if (derived.has(theirPublicKey)) return derived.get(theirPublicKey);
    const theirs = await subtle.importKey('raw', fromBase64(theirPublicKey), CURVE, false, []);
    const key = await subtle.deriveKey(
      { name: 'ECDH', public: theirs }, pair.privateKey,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    derived.set(theirPublicKey, key);
    return key;
  }

  /* Returns `{ iv, ct }` for the wire, or null when there is nothing to
     encrypt with -- the caller then sends the value in the clear, having
     already told the players so. */
  async function sealTo(theirPublicKey, value) {
    if (!available || !theirPublicKey) return null;
    try {
      const key = await keyFor(theirPublicKey);
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
      return { iv: toBase64(iv), ct: toBase64(ct) };
    } catch (e) { return null; }
  }

  async function openFrom(theirPublicKey, sealed) {
    if (!available || !sealed || !theirPublicKey) return null;
    try {
      const key = await keyFor(theirPublicKey);
      const plain = await subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(sealed.iv) }, key, fromBase64(sealed.ct));
      return JSON.parse(decoder.decode(plain));
    } catch (e) { return null; }
  }

  NS.secrets = {
    init, sealTo, openFrom,
    get publicKey() { return publicKey; },
    get available() { return available; },
  };
})(window.NS);
