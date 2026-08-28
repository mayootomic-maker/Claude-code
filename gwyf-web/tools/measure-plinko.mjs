/* Measure the plinko board and propose a payout ladder.

   The board's distribution is a property of the physics, not of a formula, so
   it has to be counted -- and counted enough times to pin the tails. The
   outermost pocket comes up about once in a hundred and fifty drops and pays
   twenty-six times, so it alone is a quarter of the machine's return: an
   estimate from three thousand drops is nowhere near good enough, which is how
   the first published table ended up claiming 94% for a board that actually
   returned 104%.

   Usage: node gwyf-web/tools/measure-plinko.mjs [drops] [targetRtp] */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };

new Function(readFileSync(resolve(root, 'vendor/three.min.js'), 'utf8')).call(globalThis);
new Function(readFileSync(resolve(root, 'vendor/cannon.min.js'), 'utf8')).call(globalThis);
new Function(readFileSync(resolve(root, 'src/core/rng.js'), 'utf8'))(globalThis);
new Function(readFileSync(resolve(root, 'src/gfx/physics.js'), 'utf8'))(globalThis);

const DROPS = Number(process.argv[2] || 40000);
const TARGET = Number(process.argv[3] || 0.94);
const ROWS = 12, PITCH = 0.34;

const rng = new globalThis.GWRng.Rng(0xC0FFEE);
const board = globalThis.GWPhysics.plinkoBoard(ROWS, PITCH);
const counts = new Array(board.slots).fill(0);

const t0 = Date.now();
for (let i = 0; i < DROPS; i++) {
  counts[globalThis.GWPhysics.dropPlinko({ board, rng }).slot]++;
  if ((i + 1) % 5000 === 0) process.stderr.write('  ' + (i + 1) + ' drops\n');
}
const secs = (Date.now() - t0) / 1000;

const raw = counts.map((c) => c / DROPS);
// The board is symmetric by construction and the simulation is symmetrised, so
// folding the two halves together halves the error on every pocket.
const sym = raw.map((_, i) => (raw[i] + raw[raw.length - 1 - i]) / 2);

const shape = [26, 7.5, 2.9, 1.15, 0.65, 0.35, 0.2, 0.35, 0.65, 1.15, 2.9, 7.5, 26];
const shapeRtp = sym.reduce((s, p, i) => s + p * shape[i], 0);
const k = TARGET / shapeRtp;
const tuned = shape.map((m) => {
  const v = m * k;
  return v >= 10 ? Math.round(v) : v >= 1 ? Math.round(v * 20) / 20 : Math.round(v * 100) / 100;
});
const tunedRtp = sym.reduce((s, p, i) => s + p * tuned[i], 0);

const se = (p) => Math.sqrt(p * (1 - p) / DROPS);
console.log('drops: ' + DROPS + '   (' + secs.toFixed(0) + 's)');
console.log('\npocket  measured   ±1 s.e.');
sym.forEach((p, i) => {
  if (i > 6) return;
  console.log('  ' + String(i).padStart(2) + '   ' + (p * 100).toFixed(3).padStart(7) + '%   ±'
    + (se(p) * 100).toFixed(3) + '%');
});
console.log('\nMEASURED = [' + sym.map((p) => p.toFixed(5)).join(', ') + '];');
console.log('PAYS     = [' + tuned.join(', ') + '];');
console.log('\nreturn with these pays: ' + (tunedRtp * 100).toFixed(2) + '%'
  + '   (house edge ' + ((1 - tunedRtp) * 100).toFixed(2) + '%)');
