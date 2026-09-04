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

    /* --- the room ---------------------------------------------------------

       Everything above is a one-shot: something happened, here is the noise it
       made. A building made only of those is silent between events, and a
       casino is the last place on earth that is ever silent -- the whole point
       of the room is that it never stops. Four layers, all running
       continuously and none of them a sample:

       Air, because every large interior has a ventilation plant in it and you
       stop hearing it the moment it goes away. Hum, two oscillators a few
       cents apart so they beat slowly against each other, pitched per floor --
       it is the only thing here you could call music and it is doing the work
       of telling you which floor you are on with your eyes shut. Babble, which
       is the crowd: noise through a wandering bandpass, gated at a syllable
       rate and swelling over ten-second breaths, and set from how many people
       are actually near you rather than from a constant. And the machines,
       scattered chimes and payouts from somewhere else in the room, drenched
       in the reverb so they read as far off.

       It crossfades rather than cuts on a floor change: the lift doors open on
       a different room, and a hard switch of a continuous bed is the one thing
       that makes an ambient loop audible as a loop. */
    let room = null;              // the graph that is currently playing
    let wantRoom = null;          // asked for before the first gesture
    let crowd = 0;                // 0..1, how loud the babble should be
    let nextMachine = 3;          // seconds until the next distant payout
    let noiseLoop = null;         // one buffer, shared by every layer
    let probe = null, probeBuf = null;   // see level(), below

    function loopBuffer() {
      if (noiseLoop) return noiseLoop;
      // Three seconds: long enough that the repeat is not a texture you can
      // hear, short enough to build without a pause on a phone.
      const len = ctx.sampleRate * 3;
      noiseLoop = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseLoop.getChannelData(0);
      // Pink-ish rather than white. White noise is a hiss; the low end is what
      // makes it a room.
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.16;
      }
      return noiseLoop;
    }

    function looping() {
      const src = ctx.createBufferSource();
      src.buffer = loopBuffer();
      src.loop = true;
      src.start();
      return src;
    }

    // A slow oscillator wired into somebody else's parameter, which is how
    // every wobble down here is made.
    function lfo(rate, depth, target, type) {
      const o = ctx.createOscillator();
      o.type = type || 'sine';
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g); g.connect(target);
      o.start();
      return { o, g };
    }

    function buildRoom(spec) {
      const out = ctx.createGain();
      out.gain.value = 0.0001;
      out.connect(master);
      const send = ctx.createGain();
      send.gain.value = 0.4;
      out.connect(send); send.connect(verb);
      const parts = [];

      // Air.
      const airSrc = looping();
      const airFilt = ctx.createBiquadFilter();
      airFilt.type = 'lowpass';
      airFilt.frequency.value = spec.air || 340;
      airFilt.Q.value = 0.6;
      const airGain = ctx.createGain();
      airGain.gain.value = 0.16;
      airSrc.connect(airFilt); airFilt.connect(airGain); airGain.connect(out);
      parts.push(airSrc);

      // Hum: two oscillators a few cents apart, so they beat rather than sit.
      const humGain = ctx.createGain();
      humGain.gain.value = 0.05;
      humGain.connect(out);
      for (const cents of [0, 4.5]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = (spec.hum || 55) * Math.pow(2, cents / 1200);
        o.connect(humGain);
        o.start();
        parts.push(o);
      }

      /* Babble. The bandpass wanders, the gate opens and shuts at roughly the
         rate a person gets a syllable out, and the whole thing breathes over
         about ten seconds. Three unrelated rates, so nothing in it lands on a
         beat you could tap along to. */
      const babSrc = looping();
      const bab = ctx.createBiquadFilter();
      bab.type = 'bandpass';
      bab.frequency.value = spec.voice || 760;
      bab.Q.value = 1.3;
      const babTop = ctx.createBiquadFilter();
      babTop.type = 'peaking';
      babTop.frequency.value = 1750;      // roughly where a vowel's second
      babTop.Q.value = 1.1;               // formant sits, which is what makes
      babTop.gain.value = 6;              // noise read as people
      const babGain = ctx.createGain();
      babGain.gain.value = 0.0001;
      babSrc.connect(bab); bab.connect(babTop); babTop.connect(babGain);
      babGain.connect(out);
      parts.push(babSrc);
      parts.push(lfo(0.23, 260, bab.frequency).o);
      parts.push(lfo(3.7, 0.35, babGain.gain).o);
      parts.push(lfo(0.093, 0.22, babGain.gain).o);

      return { out, parts, babGain, spec };
    }

    function stopRoom(r, at) {
      if (!r) return;
      r.out.gain.cancelScheduledValues(at);
      r.out.gain.setValueAtTime(Math.max(r.out.gain.value, 0.0001), at);
      r.out.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
      for (const p of r.parts) { try { p.stop(at + 1.3); } catch (e) { /* already stopped */ } }
      // Disconnect after the fade rather than now: a node cut off mid-ramp
      // clicks, and a click is louder than anything it was playing.
      global.setTimeout(() => { try { r.out.disconnect(); } catch (e) { /* gone */ } }, 1600);
    }

    return {
      unlock() {
        if (!boot()) return;
        if (ctx.state === 'suspended') ctx.resume();
        // A room asked for before the first gesture starts now, rather than
        // being lost -- otherwise the floor you boot into is the one floor
        // that never gets a room tone.
        if (wantRoom && !room) { const w = wantRoom; wantRoom = null; this.setRoom(w); }
      },

      /* Play this room, fading out whatever was playing. Passing null is
         leaving the building -- the title screen and the report are silent on
         purpose, so the bed coming back is part of arriving somewhere. */
      setRoom(spec) {
        if (!ready) { wantRoom = spec; return; }
        const t = ctx.currentTime;
        if (room && spec && room.spec.id === spec.id) return;
        stopRoom(room, t);
        room = null;
        if (!spec) return;
        room = buildRoom(spec);
        room.out.gain.setValueAtTime(0.0001, t);
        room.out.gain.exponentialRampToValueAtTime(muted ? 0.0001 : 0.5, t + 1.4);
        nextMachine = 2 + Math.random() * 4;
      },

      /* How many people are within earshot, which the room turns into how loud
         the talking is. Not a count of the whole floor: a crowd you cannot see
         should not be a crowd you can hear. */
      setCrowd(n) { crowd = Math.max(0, Math.min(1, n / 6)); },

      /* Called every frame. Two jobs: ease the babble towards the crowd it has
         actually got, and every few seconds let a machine somewhere else in
         the room pay somebody out. */
      tick(dt) {
        if (!ready || !room) return;
        const want = muted ? 0.0001 : 0.02 + crowd * 0.16;
        const g = room.babGain.gain;
        // Eased rather than set, because walking past four people should sound
        // like walking past four people, not like a fader being moved.
        g.value += (want - g.value) * Math.min(1, dt * 1.6);
        if (muted) return;
        nextMachine -= dt;
        if (nextMachine > 0) return;
        nextMachine = 3.5 + Math.random() * 9;
        // Quiet and almost entirely reverb, so it is unmistakably somebody
        // else's win on the other side of the room.
        const far = { gain: 0.035, send: 0.9 };
        if (Math.random() < 0.45) {
          tone(Object.assign({ type: 'triangle', from: 1400 + Math.random() * 700,
                               to: 900, decay: 0.4 }, far));
        } else {
          [0, 0.09, 0.18].forEach((d, i) =>
            tone(Object.assign({ type: 'square', from: 900 + i * 220, decay: 0.13,
                                 delay: d }, far)));
        }
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
      get room() { return room ? room.spec.id : null; },
      get crowd() { return crowd; },

      /* Is anything actually coming out?

         The whole point of an ambient bed is that you stop noticing it, which
         makes "there is no ambient bed" and "the ambient bed is working" look
         identical from anywhere except the speakers. A harness that asserts
         `audio.room === 'velvet'` proves a string was assigned and nothing
         else -- exactly the class of test that let a world where nothing had a
         top pass for months.

         So this taps the master and reports the RMS of what is on it. The
         analyser is built on first ask and kept, because nothing but a test
         ever asks and a test asks repeatedly. */
      level() {
        if (!ready) return 0;
        if (!probe) {
          probe = ctx.createAnalyser();
          probe.fftSize = 2048;
          probeBuf = new Float32Array(probe.fftSize);
          master.connect(probe);
        }
        probe.getFloatTimeDomainData(probeBuf);
        let sum = 0;
        for (let i = 0; i < probeBuf.length; i++) sum += probeBuf[i] * probeBuf[i];
        return Math.sqrt(sum / probeBuf.length);
      },
      get muted() { return muted; },
      get names() { return Object.keys(SOUNDS); },
    };
  }

  global.GWAudio = { create };
})(window);
