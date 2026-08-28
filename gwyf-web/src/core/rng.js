/* Seeded randomness.

   The run's seed is drawn from crypto once and then saved, so reloading the page
   continues the same stream rather than re-rolling the spin you did not like.
   A gambling game that can be save-scummed by pressing F5 is not a gambling
   game, and the fix has to live at the source of the numbers -- anywhere later
   and some path will miss it. */

(function (global) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newSeed() {
    if (global.crypto && global.crypto.getRandomValues) {
      return global.crypto.getRandomValues(new Uint32Array(1))[0];
    }
    return (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
  }

  function Rng(seed, calls) {
    this.seed = seed >>> 0;
    this.calls = 0;
    this._next = mulberry32(this.seed);
    // Replaying the stream on load is what makes the seed worth saving.
    for (let i = 0; i < (calls || 0); i++) this._next();
    this.calls = calls || 0;
  }

  Rng.prototype.next = function () { this.calls++; return this._next(); };
  Rng.prototype.float = function (lo, hi) { return lo + this.next() * (hi - lo); };
  /* Integer in [lo, hi]. */
  Rng.prototype.int = function (lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); };
  Rng.prototype.chance = function (p) { return this.next() < p; };
  Rng.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };

  Rng.prototype.shuffle = function (arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  /* Pick an index from a list of weights. Used by every game whose outcomes are
     not equally likely, so the weights are the one place a payout table has to
     be checked against. */
  Rng.prototype.weighted = function (weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  };

  Rng.prototype.save = function () { return { seed: this.seed, calls: this.calls }; };

  global.GWRng = { Rng, newSeed, mulberry32 };
})(window);
