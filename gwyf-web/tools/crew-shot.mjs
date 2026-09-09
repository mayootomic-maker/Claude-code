/* Render the four friends the way the game assembles them.

   Usage: node gwyf-web/tools/crew-shot.mjs out.png [pose]

   The bodies are four separate meshes joined at runtime, so a contact sheet of
   the parts proves nothing about whether the head sits on the neck. This drives
   the same GWCrew.buildBody the floor does, then puts each friend in the poses
   the walk cycle actually produces. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const out = process.argv[2] || '/tmp/crew.png';

const models = JSON.parse(read('assets/models.json'));

const html = `<!doctype html><meta charset=utf8>
<style>html,body{margin:0;background:#241a18}canvas{display:block}</style>
<script>${read('vendor/three.min.js')}</script>
<script>${read('src/gfx/models.js')}</script>
<script>${read('src/gfx/env.js')}</script>
<script>${read('src/world/crew.js')}</script>
<script>window.__models = ${JSON.stringify(models)};</script>`;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.setContent(html);

const report = await page.evaluate(() => {
  const lib = GWModels.decode(window.__models);
  const ids = Object.keys(GWCrew.LOOK);
  const CELL = 320, ROWS = 2, W = CELL * ids.length, H = CELL * ROWS * 1.15;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = Math.round(H);
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.environment = GWEnv.build(renderer, 'velvet');
  const key = new THREE.DirectionalLight(0xfff0dd, 2.2);
  key.position.set(-3, 5, 4);
  scene.add(key, new THREE.AmbientLight(0xffffff, 0.12));
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 60);

  const cellH = H / ROWS;
  const tris = {};
  ids.forEach((id, i) => {
    for (let row = 0; row < ROWS; row++) {
      const body = GWCrew.buildBody(lib, GWCrew.LOOK[id]);
      const holder = new THREE.Group();
      holder.add(body.group);
      // The models face -Z, so a camera on +Z sees the back of the head
      // unless the friend is turned round to face it.
      holder.rotation.y = row === 0 ? Math.PI : Math.PI - 0.7;
      scene.add(holder);

      if (row === 1) {
        // Mid-waddle, posed the way the walk cycle poses it: rolled onto one
        // side, stretched at the top of the step, hands swung across. There are
        // no legs to put mid-stride -- that is the point of the design.
        body.root.rotation.z = 0.12;
        body.root.rotation.x = 0.16;
        body.root.position.y = 0.045;
        body.trunk.scale.set(0.96, 1.05, 0.96);
        body.head.position.y = body.joints.neck * 1.05;
        body.head.rotation.y = -0.28;
        body.brow.rotation.x = -0.2;
        body.hands[0].position.z += 0.26;
        body.hands[1].position.z -= 0.26;
        body.hands[0].rotation.x = -0.16;
        body.hands[1].rotation.x = 0.16;
      }
      if (!tris[id]) {
        let n = 0;
        body.group.traverse((m) => { if (m.isMesh) n += m.geometry.index.count / 3; });
        tris[id] = n;
      }

      const vx = i * 320, vy = H - (row + 1) * cellH;
      renderer.setViewport(vx, vy, 320, cellH);
      renderer.setScissor(vx, vy, 320, cellH);
      renderer.setScissorTest(true);
      cam.aspect = 320 / cellH;
      cam.position.set(0, 0.95, 3.4);
      cam.lookAt(0, 0.80, 0);
      cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      scene.remove(holder);
      body.dispose();
    }
  });
  return { tris, w: canvas.width, h: canvas.height };
});

const el = await page.$('canvas');
writeFileSync(out, await el.screenshot());
await browser.close();
if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
console.log(out, report.w + 'x' + report.h, JSON.stringify(report.tris));
