/* Every sound in the game, synthesised.

   No audio files: they would be the largest thing in the bundle by an order of
   magnitude, and a casino's noises -- clicks, chimes, rattles, a room tone --
   are exactly the kind of sound an oscillator and a noise burst do well.

   The context is created on the first gesture, because every browser refuses to
   start one before that and a muted-forever game is a worse bug than a silent
   first click. */

(function (global) {
  'use strict';

  function create() {
    let ctx = null, master = null, verb = null, dry = null, wet = null;
    let muted = false, ready = false;

    function impulse(seconds, decay) {
      const rate = ctx.sampleRate;
      const len = Math.floor(rate * seconds);
      const buf = ctx.createBuffer(2, len, rate);
      for (let c = 0; c < 2; c++) {
        const data = buf.getChannelData(c);
        for (let i = 0; i < len; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
      }
      return buf;
    }

    function boot() {
      if (ready) return true;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      verb = ctx.createConvolver();
      verb.buffer = impulse(1.6, 2.6);
      wet = ctx.createGain(); wet.gain.value = 0.22; wet.connect(master);
      verb.connect(wet);
      dry = ctx.createGain(); dry.gain.value = 1.0; dry.connect(master);
      ready = true;
      return true;
    }

    function bus(send) {
      const g = ctx.createGain();
      g.connect(dry);
      if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(verb); }
      return g;
    }

    function env(node, t, a, d, peak) {
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(0.0001, t);
      node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
      node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }

    function tone(opts) {
      if (!ready || muted) return;
      const t = ctx.currentTime + (opts.delay || 0);
      const osc = ctx.createOscillator();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(opts.from, t);
      if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t + (opts.glide || opts.decay));
      const g = ctx.createGain();
      env(g, t, opts.attack || 0.006, opts.decay || 0.18, opts.gain === undefined ? 0.25 : opts.gain);
      osc.connect(g); g.connect(bus(opts.send === undefined ? 0.3 : opts.send));
      osc.start(t); osc.stop(t + (opts.attack || 0.006) + (opts.decay || 0.18) + 0.05);
    }

    function noise(opts) {
      if (!ready || muted) return;
      const t = ctx.currentTime + (opts.delay || 0);
      const dur = opts.decay || 0.15;
      const len = Math.max(1, Math.floor(ctx.sampleRate * (dur + 0.05)));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = opts.filter || 'bandpass';
      filt.frequency.setValueAtTime(opts.freq || 1400, t);
      if (opts.freqTo) filt.frequency.exponentialRampToValueAtTime(opts.freqTo, t + dur);
      filt.Q.value = opts.q === undefined ? 1.2 : opts.q;
      const g = ctx.createGain();
      env(g, t, opts.attack || 0.004, dur, opts.gain === undefined ? 0.3 : opts.gain);
      src.connect(filt); filt.connect(g); g.connect(bus(opts.send === undefined ? 0.25 : opts.send));
      src.start(t); src.stop(t + dur + 0.06);
    }

    const SOUNDS = {
      click: () => tone({ type: 'square', from: 880, to: 620, decay: 0.05, gain: 0.10, send: 0.1 }),
      hover: () => tone({ type: 'sine', from: 1400, decay: 0.035, gain: 0.045, send: 0.05 }),
      chip: () => { noise({ freq: 2600, decay: 0.07, gain: 0.20, q: 2.2 });
                    tone({ type: 'triangle', from: 320, to: 180, decay: 0.09, gain: 0.14 }); },
      deny: () => tone({ type: 'sawtooth', from: 200, to: 90, decay: 0.22, gain: 0.16 }),
      whoosh: () => noise({ filter: 'bandpass', freq: 420, freqTo: 2200, decay: 0.34, gain: 0.13, q: 0.7 }),
      coin: () => { tone({ type: 'triangle', from: 1760, to: 1180, decay: 0.30, gain: 0.16, send: 0.5 });
                    tone({ type: 'sine', from: 2640, decay: 0.22, gain: 0.08, delay: 0.02, send: 0.5 }); },
      dice: () => { for (let i = 0; i < 5; i++) {
                      noise({ freq: 900 + Math.random() * 1600, decay: 0.05, gain: 0.11,
                              delay: i * 0.055 + Math.random() * 0.03, q: 2.4 }); } },
      tick: () => tone({ type: 'square', from: 2200, decay: 0.022, gain: 0.05, send: 0.05 }),
      step: () => { noise({ filter: 'lowpass', freq: 260 + Math.random() * 90, decay: 0.085,
                            gain: 0.055, q: 0.7, send: 0.12 });
                    tone({ type: 'sine', from: 120, to: 72, decay: 0.07, gain: 0.035, send: 0.1 }); },
      reel: () => noise({ freq: 700, decay: 0.045, gain: 0.09, q: 3.0 }),
      win: () => { [523.25, 659.25, 783.99].forEach((f, i) =>
                      tone({ type: 'triangle', from: f, decay: 0.34, gain: 0.16, delay: i * 0.07, send: 0.45 })); },
      big: () => { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
                      tone({ type: 'triangle', from: f, decay: 0.5, gain: 0.17, delay: i * 0.085, send: 0.6 })); },
      lose: () => { tone({ type: 'sine', from: 190, to: 84, decay: 0.5, gain: 0.20, send: 0.35 });
                    noise({ freq: 260, decay: 0.3, gain: 0.10, q: 0.8 }); },
      bust: () => { tone({ type: 'sawtooth', from: 160, to: 52, decay: 0.9, gain: 0.24, send: 0.5 });
                    noise({ freq: 180, decay: 0.7, gain: 0.14, q: 0.6 }); },
      cash: () => { [1046.5, 1396.9].forEach((f, i) =>
                      tone({ type: 'square', from: f, decay: 0.12, gain: 0.10, delay: i * 0.06 }));
                    noise({ freq: 3200, decay: 0.18, gain: 0.12, q: 1.6, delay: 0.02 }); },
      alarm: () => { [0, 0.26, 0.52].forEach((d) =>
                      tone({ type: 'square', from: 740, to: 520, decay: 0.2, gain: 0.13, delay: d })); },
      door: () => { noise({ filter: 'lowpass', freq: 380, decay: 0.5, gain: 0.20 });
                    tone({ type: 'sine', from: 96, to: 58, decay: 0.55, gain: 0.16 }); },
      shout: () => { tone({ type: 'sawtooth', from: 300, to: 520, decay: 0.14, gain: 0.14 });
                     noise({ freq: 1200, decay: 0.12, gain: 0.08 }); },
      shot: () => { noise({ filter: 'lowpass', freq: 2400, freqTo: 200, decay: 0.55, gain: 0.42, q: 0.5 });
                    tone({ type: 'sawtooth', from: 220, to: 40, decay: 0.5, gain: 0.30, send: 0.7 }); },
      empty: () => { tone({ type: 'square', from: 1500, to: 900, decay: 0.06, gain: 0.14 });
                     noise({ freq: 3000, decay: 0.05, gain: 0.10, q: 3 }); },
    };

    return {
      unlock() {
        if (!boot()) return;
        if (ctx.state === 'suspended') ctx.resume();
      },
      play(name) {
        if (!ready || muted) return;
        const fn = SOUNDS[name];
        if (fn) fn();
      },
      setMuted(v) {
        muted = !!v;
        if (master) master.gain.value = muted ? 0 : 0.5;
      },
      get muted() { return muted; },
      get names() { return Object.keys(SOUNDS); },
    };
  }

  global.GWAudio = { create };
})(window);
