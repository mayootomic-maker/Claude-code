/* A procedural HDR environment map.

   Metal has no diffuse term: a gold coin lit only by lamps renders as a dark
   shape with two white dots on it, and everything it should be reflecting is
   missing. So the scene needs an environment -- and it has to be high dynamic
   range. An environment painted into a canvas is capped at 1.0 per channel,
   which is roughly "a sheet of grey paper", and gold lit by grey paper looks
   like grey paper. Building the texels as floats lets a lamp be twenty times
   brighter than the ceiling, which is what puts a hot streak across a coin's
   milled edge.

   Costs about a millisecond and downloads nothing. */

(function (global) {
  'use strict';

  const W = 256, H = 128;

  // Lamps are placed by direction, not by pixel: azimuth around the room and
  // elevation above the floor, which is how you would describe where a light is.
  const PRESETS = {
    velvet: {
      zenith: [0.105, 0.072, 0.050], horizon: [0.030, 0.021, 0.017], floor: [0.006, 0.004, 0.003],
      lamps: [
        { az: -40, el: 62, size: 24, power: 13.0, colour: [1.00, 0.86, 0.62] },
        { az: 70, el: 34, size: 30, power: 4.0, colour: [1.00, 0.93, 0.80] },
        { az: 168, el: 46, size: 34, power: 2.4, colour: [0.95, 0.55, 0.36] },
        { az: -120, el: 12, size: 40, power: 1.0, colour: [0.55, 0.62, 1.00] },
      ],
    },
    emerald: {
      zenith: [0.062, 0.100, 0.076], horizon: [0.018, 0.030, 0.023], floor: [0.004, 0.007, 0.005],
      lamps: [
        { az: -34, el: 60, size: 24, power: 12.0, colour: [0.92, 1.00, 0.90] },
        { az: 84, el: 30, size: 32, power: 3.6, colour: [0.55, 1.00, 0.78] },
        { az: 170, el: 40, size: 36, power: 2.2, colour: [0.90, 0.95, 0.70] },
      ],
    },
    crimson: {
      zenith: [0.125, 0.055, 0.050], horizon: [0.038, 0.016, 0.015], floor: [0.008, 0.003, 0.003],
      lamps: [
        { az: -46, el: 58, size: 22, power: 14.0, colour: [1.00, 0.72, 0.62] },
        { az: 66, el: 26, size: 30, power: 4.4, colour: [1.00, 0.36, 0.30] },
        { az: 175, el: 44, size: 34, power: 2.4, colour: [1.00, 0.85, 0.70] },
      ],
    },
    void: {
      zenith: [0.070, 0.064, 0.120], horizon: [0.020, 0.018, 0.036], floor: [0.004, 0.004, 0.008],
      lamps: [
        { az: -38, el: 64, size: 22, power: 11.0, colour: [0.86, 0.88, 1.00] },
        { az: 78, el: 28, size: 30, power: 3.8, colour: [0.45, 1.00, 0.95] },
        { az: 160, el: 40, size: 34, power: 2.4, colour: [0.80, 0.55, 1.00] },
      ],
    },
  };  const rad = (d) => d * Math.PI / 180;

  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function buildData(preset) {
    const data = new Float32Array(W * H * 4);
    const lamps = preset.lamps.map((l) => {
      const el = rad(l.el), az = rad(l.az);
      return {
        dir: [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)],
        // A lamp falls off as a power of the cosine: cheap, always smooth, and
        // `size` maps to something like an angular radius in degrees.
        sharp: Math.max(1, 12000 / (l.size * l.size)),
        power: l.power, colour: l.colour,
      };
    });

    for (let y = 0; y < H; y++) {
      const theta = (y + 0.5) / H * Math.PI;          // 0 at +Y pole
      const sy = Math.cos(theta), st = Math.sin(theta);
      // Elevation drives the gradient: bright warm ceiling, a band at the
      // horizon where the room's own lights bounce, and a dark floor.
      const t = sy;
      const base = t >= 0 ? mix(preset.horizon, preset.zenith, Math.pow(t, 0.65))
                          : mix(preset.horizon, preset.floor, Math.pow(-t, 0.5));
      for (let x = 0; x < W; x++) {
        const phi = (x + 0.5) / W * Math.PI * 2 - Math.PI;
        const dir = [st * Math.sin(phi), sy, st * Math.cos(phi)];
        let r = base[0], g = base[1], b = base[2];
        for (const l of lamps) {
          const d = dir[0] * l.dir[0] + dir[1] * l.dir[1] + dir[2] * l.dir[2];
          if (d <= 0) continue;
          const f = Math.pow(d, l.sharp) * l.power;
          if (f < 1e-4) continue;
          r += l.colour[0] * f; g += l.colour[1] * f; b += l.colour[2] * f;
        }
        const i = (y * W + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 1;
      }
    }
    return data;
  }

  const cache = new Map();

  function build(renderer, name) {
    if (cache.has(name)) return cache.get(name);
    const preset = PRESETS[name] || PRESETS.velvet;
    const tex = new THREE.DataTexture(buildData(preset), W, H, THREE.RGBAFormat, THREE.FloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const target = pmrem.fromEquirectangular(tex);
    tex.dispose();
    pmrem.dispose();
    cache.set(name, target.texture);
    return target.texture;
  }

  /* The average of the upper hemisphere, used to tint fog and the page chrome so
     the HTML around the canvas belongs to the same room as what is inside it. */
  function ambientTint(name) {
    const p = PRESETS[name] || PRESETS.velvet;
    const c = mix(p.horizon, p.zenith, 0.5);
    const to8 = (v) => Math.round(Math.min(1, Math.pow(v, 1 / 2.2)) * 255);
    return '#' + [c[0], c[1], c[2]].map((v) => to8(v).toString(16).padStart(2, '0')).join('');
  }

  global.GWEnv = { build, PRESETS, ambientTint };
})(window);
