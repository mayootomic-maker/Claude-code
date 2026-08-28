/* Render the model library headlessly and write a contact sheet.

   Usage: node gwyf-web/tools/shoot.mjs out.png [cols] [name ...]

   Existing only so models can be judged the way they will be seen -- lit,
   shaded and in a browser -- rather than from a Blender viewport screenshot
   that uses a different renderer. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const out = process.argv[2] || '/tmp/models.png';
const cols = Number(process.argv[3] || 4);
const only = process.argv.slice(4);

const models = JSON.parse(read('assets/models.json'));
const names = only.length ? only : Object.keys(models.meshes);

const html = `<!doctype html><meta charset=utf8>
<style>html,body{margin:0;background:#3a2c28}canvas{display:block}</style>
<script>${read('vendor/three.min.js')}</script>
<script>${read('src/gfx/models.js')}</script>
<script>${read('src/gfx/env.js')}</script>
<script>${read('tools/viewer.js')}</script>
<script>window.__models = ${JSON.stringify(models)};</script>`;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.setContent(html);

const report = await page.evaluate(({ names, cols }) => {
  const lib = GWModels.decode(window.__models);
  const canvas = GWViewer(lib, names, { cols });
  return { labels: window.__labels, w: canvas.width, h: canvas.height };
}, { names, cols });

const el = await page.$('canvas');
writeFileSync(out, await el.screenshot({ omitBackground: false }));
await browser.close();

if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
console.log(out, report.w + 'x' + report.h);
for (const l of report.labels) console.log(` ${l.name.padEnd(12)} ${String(l.tris).padStart(6)} tris  size ${l.size.join(' x ')}`);
