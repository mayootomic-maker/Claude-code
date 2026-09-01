/* Every pose the animation can hold, side by side.

   Usage: node gwyf-web/tools/pose-shot.mjs out.png

   A walk cycle is judged in motion, but the poses it passes through can be
   judged still -- and a sheet of all six next to each other is the only way to
   catch one of them leaning the wrong way, which is exactly what happened. Each
   cell drives the real `pose` function through the real rig, held at a chosen
   state, rather than posing the meshes by hand. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const out = process.argv[2] || '/tmp/poses.png';
const models = JSON.parse(read('assets/models.json'));

const html = `<!doctype html><meta charset=utf8>
<style>html,body{margin:0;background:#241a18}canvas{display:block}</style>
<script>${read('vendor/three.min.js')}</script>
<script>${read('src/gfx/models.js')}</script>
<script>${read('src/gfx/env.js')}</script>
<script>${read('src/world/collision.js')}</script>
<script>${read('src/world/crew.js')}</script>
<script>window.__models = ${JSON.stringify(models)};</script>`;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1680, height: 460 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.setContent(html);

const labels = await page.evaluate(async () => {
  const lib = GWModels.decode(window.__models);
  const CASES = [
    { name: 'idle', state: 'idle', speed: 0 },
    { name: 'walking', state: 'walk', speed: 1.7 },
    { name: 'at a table', state: 'play', speed: 0 },
    { name: 'won', state: 'idle', speed: 0, mood: 1 },
    { name: 'lost', state: 'idle', speed: 0, mood: -1 },
    { name: 'about to tilt', state: 'idle', speed: 0, tilting: true },
  ];
  /* Cells wide enough for the pose, not just for the body.

     A tall narrow viewport narrows the horizontal field of view with it, so the
     first version cropped to a head at what should have been a full-length
     shot -- and cut the raised hands off the one pose that is mostly hands. */
  const CELL = 280, H = 460, W = CELL * CASES.length;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  document.body.appendChild(canvas);
  const r = new THREE.WebGLRenderer({ canvas, antialias: true });
  r.setSize(W, H, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.environment = GWEnv.build(r, 'velvet');
  const key = new THREE.DirectionalLight(0xfff0dd, 2.4);
  key.position.set(-3, 5, 4);
  scene.add(key, new THREE.AmbientLight(0xffffff, 0.2));
  const cam = new THREE.PerspectiveCamera(30, CELL / H, 0.05, 60);

  // The pose function is private to the module, so it is exercised the way the
  // game exercises it: through a real crew on a stub level.
  const solids = new GWCollision.World().setBounds(-6, -6, 6, 6);
  const level = {
    group: new THREE.Group(), solids, anchors: [], lift: { x: 0, z: 0, w: 1, d: 1 },
    spawn: { x: 0, z: 0, angle: 0 }, size: { w: 12, d: 12, height: 4 },
  };
  scene.add(level.group);
  const store = {
    rng: null, s: { friends: [{ id: 'den', name: 'Den', colour: '#ef6f79' }], floor: 0, phase: 'floor', timeLeft: 300 },
    say() {},
  };
  const crew = GWCrew.create({ store, level, lib });
  const person = crew.people[0];

  CASES.forEach((c, i) => {
    person.state = c.state;
    person.mood = c.mood || 0;
    person.moodLeft = c.mood ? 2.4 : 0;
    person.tilting = !!c.tilting;
    person.rig = null;
    person.pos.set(0, 0, 0);
    person.yaw = 0;
    // Settle: the springs need time to reach the pose they are aiming at.
    for (let f = 0; f < 90; f++) crew.update(1 / 60, null);
    person.body.group.position.set(0, 0, 0);
    person.body.group.rotation.y = Math.PI - 0.5;

    r.setViewport(i * CELL, 0, CELL, H);
    r.setScissor(i * CELL, 0, CELL, H);
    r.setScissorTest(true);
    cam.aspect = CELL / H;
    cam.position.set(0, 1.0, 4.0);
    cam.lookAt(0, 0.80, 0);
    cam.updateProjectionMatrix();
    r.render(scene, cam);
  });
  return CASES.map((c) => c.name);
});

writeFileSync(out, await (await page.$('canvas')).screenshot());
await browser.close();
if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
console.log(out, '·', labels.join(' | '));
