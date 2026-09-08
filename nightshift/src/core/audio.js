/* Every sound in the game, made by the browser.

   Nothing here is a file. A station alarm and a task chirp are a few hundred
   bytes of oscillator each, and sampling them instead would have been most of
   the download for a page whose whole pitch is that you can mail it to
   fourteen people. It also means the sounds are parametric: the alarm during
   a reactor meltdown is the meeting alarm with its interval pulled tighter,
   rather than a second recording that has to be kept in tune with the first.

   Browsers will not start audio until the player has touched something, which
   is the correct rule and not a bug to work around: the context is created on
   the first real gesture and everything before that is silently dropped. */

(function (NS) {
  'use strict';

  let ctx = null;
  let master = null;
  let muted = NS.util.store.get('muted', false);
  let volume = NS.util.store.get('volume', 0.7);

  /* Nothing is built until somebody has touched the page. A browser refuses to
     start audio before a gesture and says so in the console, and the room tone
     wants to start on its own the moment the game loads -- so the gate is here
     rather than at each call site, and `unlock` is wired to the first real
     touch or key press in main.js. */
  let unlocked = false;
  function unlock() {
    unlocked = true;
    wake();
  }

  function wake() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    if (!unlocked) return null;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    return ctx;
  }

  function setMuted(v) {
    muted = !!v;
    NS.util.store.set('muted', muted);
    if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
    if (hum) hum.gain.gain.setTargetAtTime(muted ? 0 : hum.level, ctx.currentTime, 0.1);
  }
  function setVolume(v) {
    volume = NS.util.clamp(Number(v) || 0, 0, 1);
    NS.util.store.set('volume', volume);
    if (master && !muted) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
  }

  /* One shaped tone. `bend` sweeps the pitch over the life of the note, which
     is the difference between a beep and something that sounds like it came
     off a machine. */
  function tone(o) {
    const c = wake();
    if (!c || muted) return;
    const t = c.currentTime + (o.at || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.bend) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.bend), t + o.dur);
    const peak = (o.gain == null ? 0.25 : o.gain);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + (o.attack || 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node = osc;
    if (o.filter) {
      const f = c.createBiquadFilter();
      f.type = o.filter;
      f.frequency.value = o.cutoff || 900;
      f.Q.value = o.q || 1;
      osc.connect(f);
      node = f;
    }
    node.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  /* Filtered noise: footsteps, vent clunks, the hiss of a door. */
  function noise(o) {
    const c = wake();
    if (!c || muted) return;
    const t = c.currentTime + (o.at || 0);
    const len = Math.max(1, Math.floor(c.sampleRate * o.dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 700, t);
    if (o.bend) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.bend), t + o.dur);
    f.Q.value = o.q || 1.2;
    const gain = c.createGain();
    gain.gain.setValueAtTime(o.gain == null ? 0.2 : o.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(gain); gain.connect(master);
    src.start(t);
  }

  const SOUNDS = {
    tap:      () => tone({ freq: 520, dur: 0.05, type: 'square', gain: 0.06 }),
    click:    () => { tone({ freq: 880, dur: 0.04, type: 'square', gain: 0.09 }); tone({ freq: 1320, dur: 0.05, at: 0.03, type: 'square', gain: 0.05 }); },
    deny:     () => { tone({ freq: 190, dur: 0.13, bend: 120, type: 'sawtooth', gain: 0.12, filter: 'lowpass', cutoff: 800 }); },
    step:     () => noise({ freq: 380 + Math.random() * 160, dur: 0.05, gain: 0.035, q: 2.4 }),

    taskOpen: () => { tone({ freq: 420, dur: 0.09, type: 'triangle', gain: 0.12 }); tone({ freq: 630, dur: 0.1, at: 0.06, type: 'triangle', gain: 0.1 }); },
    taskStep: () => tone({ freq: 720, dur: 0.07, type: 'triangle', gain: 0.13 }),
    taskDone: () => { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.16, at: i * 0.055, type: 'triangle', gain: 0.13 })); },
    taskFail: () => { tone({ freq: 300, dur: 0.1, type: 'square', gain: 0.1 }); tone({ freq: 200, dur: 0.16, at: 0.08, type: 'square', gain: 0.1 }); },

    kill:     () => { noise({ freq: 1600, bend: 120, dur: 0.32, gain: 0.34, filter: 'lowpass', q: 0.7 }); tone({ freq: 150, bend: 45, dur: 0.5, type: 'sawtooth', gain: 0.22, filter: 'lowpass', cutoff: 500 }); },
    died:     () => { tone({ freq: 320, bend: 60, dur: 0.9, type: 'sine', gain: 0.3 }); tone({ freq: 214, bend: 41, dur: 1.1, type: 'triangle', gain: 0.18 }); },
    shoot:    () => { noise({ freq: 2600, bend: 300, dur: 0.14, gain: 0.3, filter: 'highpass' }); tone({ freq: 640, bend: 90, dur: 0.2, type: 'square', gain: 0.14 }); },
    shield:   () => { tone({ freq: 700, bend: 1400, dur: 0.3, type: 'sine', gain: 0.16 }); tone({ freq: 1050, bend: 2100, dur: 0.3, at: 0.05, type: 'sine', gain: 0.09 }); },
    vent:     () => { noise({ freq: 240, bend: 90, dur: 0.28, gain: 0.28, filter: 'lowpass', q: 0.8 }); tone({ freq: 96, dur: 0.18, type: 'square', gain: 0.1 }); },
    vanish:   () => { tone({ freq: 900, bend: 180, dur: 0.4, type: 'sine', gain: 0.14 }); noise({ freq: 3000, bend: 400, dur: 0.4, gain: 0.08, filter: 'highpass' }); },
    shift:    () => { tone({ freq: 200, bend: 1200, dur: 0.45, type: 'sawtooth', gain: 0.12, filter: 'lowpass', cutoff: 1600, q: 6 }); },

    /* The meeting alarm and the meltdown alarm are the same three notes; the
       meltdown just repeats them twice as often, from sabotage.js. */
    alarm:    () => { [0, 0.22, 0.44].forEach((at) => { tone({ freq: 740, dur: 0.18, at, type: 'square', gain: 0.16 }); tone({ freq: 988, dur: 0.18, at: at + 0.09, type: 'square', gain: 0.14 }); }); },
    report:   () => { tone({ freq: 220, dur: 0.5, type: 'sawtooth', gain: 0.2, filter: 'lowpass', cutoff: 700 }); tone({ freq: 330, dur: 0.6, at: 0.1, type: 'sawtooth', gain: 0.14, filter: 'lowpass', cutoff: 900 }); },
    vote:     () => tone({ freq: 660, dur: 0.09, type: 'square', gain: 0.13 }),
    eject:    () => { tone({ freq: 500, bend: 80, dur: 1.4, type: 'sine', gain: 0.2 }); noise({ freq: 900, bend: 100, dur: 1.6, gain: 0.1, filter: 'lowpass' }); },

    sabotage: () => { tone({ freq: 130, dur: 0.7, type: 'sawtooth', gain: 0.22, filter: 'lowpass', cutoff: 420 }); [0, 0.3, 0.6].forEach((at) => tone({ freq: 620, dur: 0.2, at, type: 'square', gain: 0.12 })); },
    fixed:    () => { [392, 523, 659].forEach((f, i) => tone({ freq: f, dur: 0.2, at: i * 0.07, type: 'triangle', gain: 0.13 })); },
    lightsOut: () => { tone({ freq: 400, bend: 60, dur: 0.8, type: 'sawtooth', gain: 0.18, filter: 'lowpass', cutoff: 600 }); },
    door:     () => { noise({ freq: 500, bend: 160, dur: 0.35, gain: 0.2, filter: 'lowpass' }); tone({ freq: 110, dur: 0.2, type: 'square', gain: 0.12 }); },

    win:      () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, dur: 0.5, at: i * 0.1, type: 'triangle', gain: 0.14 })); },
    lose:     () => { [440, 392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.55, at: i * 0.16, type: 'sawtooth', gain: 0.13, filter: 'lowpass', cutoff: 900 })); },
    join:     () => { tone({ freq: 620, dur: 0.1, type: 'triangle', gain: 0.1 }); tone({ freq: 930, dur: 0.12, at: 0.07, type: 'triangle', gain: 0.08 }); },
    leave:    () => { tone({ freq: 500, dur: 0.1, type: 'triangle', gain: 0.09 }); tone({ freq: 330, dur: 0.14, at: 0.07, type: 'triangle', gain: 0.07 }); },
    chat:     () => tone({ freq: 1180, dur: 0.05, type: 'sine', gain: 0.07 }),
  };

  /* ---- the room tone ------------------------------------------------------ */

  /* A station you can hear. Two detuned oscillators under a low-pass, at a
     level you stop noticing in about ten seconds -- which is the point: you
     notice when it changes. The lights going out drops it a fifth and opens
     the filter, so the dark sounds different before you have finished reading
     the banner. */
  let hum = null;
  function ambience(mood) {
    const c = wake();
    if (!c) return;
    if (!hum) {
      const gain = c.createGain();
      gain.gain.value = 0;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 260;
      filter.Q.value = 0.7;
      const a = c.createOscillator();
      const b = c.createOscillator();
      a.type = 'sawtooth'; b.type = 'triangle';
      a.frequency.value = 55; b.frequency.value = 82.5;
      /* A slow wobble so it never sits perfectly still, which is what makes a
         drone sound like a recording instead of a place. */
      const wobble = c.createOscillator();
      const wobbleGain = c.createGain();
      wobble.frequency.value = 0.07;
      wobbleGain.gain.value = 3.5;
      wobble.connect(wobbleGain);
      wobbleGain.connect(a.frequency);
      a.connect(filter); b.connect(filter);
      filter.connect(gain); gain.connect(master);
      a.start(); b.start(); wobble.start();
      hum = { gain, filter, a, b, level: 0 };
    }
    const t = c.currentTime;
    const settings = {
      off:     { level: 0,     freq: 260, base: 55 },
      station: { level: 0.055, freq: 240, base: 55 },
      dark:    { level: 0.085, freq: 520, base: 36.7 },
      alarm:   { level: 0.075, freq: 420, base: 46 },
    }[mood] || { level: 0, freq: 260, base: 55 };
    hum.gain.gain.setTargetAtTime(muted ? 0 : settings.level, t, 0.6);
    hum.filter.frequency.setTargetAtTime(settings.freq, t, 0.5);
    hum.a.frequency.setTargetAtTime(settings.base, t, 0.5);
    hum.b.frequency.setTargetAtTime(settings.base * 1.5, t, 0.5);
  }

  /* Somebody else's footsteps, quieter the further away they are and audible
     through a wall on purpose. Hearing someone you cannot see is most of the
     tension in a dark corridor, and it is information the impostor has too. */
  function footstep(nearness) {
    const c = wake();
    if (!c || muted || nearness <= 0) return;
    noise({
      freq: 300 + Math.random() * 200,
      dur: 0.055,
      gain: 0.028 * nearness * nearness,
      q: 2.6,
    });
  }

  let lastStep = 0;
  function play(name, opts) {
    const fn = SOUNDS[name];
    if (!fn) return;
    /* Footsteps come from the animation, which runs at frame rate. One every
       260ms is a walk; every frame is a swarm of bees. */
    if (name === 'step') {
      const t = NS.util.now();
      if (t - lastStep < 240) return;
      lastStep = t;
    }
    try { fn(opts); } catch (e) { /* audio is never worth an exception */ }
  }

  NS.audio = {
    play, wake, unlock, setMuted, setVolume, ambience, footstep,
    get unlocked() { return unlocked; },
    get muted() { return muted; },
    get volume() { return volume; },
  };
})(window.NS);
