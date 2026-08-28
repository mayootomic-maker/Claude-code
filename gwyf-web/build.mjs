/* Bundle the whole game into one HTML file.

   No bundler, no build step to install: the sources are plain scripts in
   dependency order and this inlines them in that order, along with the
   stylesheet and the model blob. The result opens from a file:// URL with no
   server, which is the point -- a casino you have to npm install is not a thing
   anybody will actually play.

   Usage: node gwyf-web/build.mjs [--out path] */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, 'src');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? resolve(process.argv[outArg + 1]) : resolve(here, 'gamble-with-your-friends.html');

const read = (p) => readFileSync(p, 'utf8');

let html = read(resolve(src, 'index.html'));
const parts = [];

/* Stylesheet. Anything that is not a local file -- the font link -- is left
   alone: it is on the CDN allowlist and degrades to the fallback stack offline. */
html = html.replace(/[ \t]*<link rel="stylesheet" href="([^"]+)">\n?/g, (whole, href) => {
  if (/^https?:/.test(href)) return whole;
  const css = read(resolve(src, href));
  parts.push({ what: href, bytes: Buffer.byteLength(css) });
  return '<style>\n' + css + '\n</style>\n';
});

/* Scripts, in the order the page lists them. */
html = html.replace(/[ \t]*<script src="([^"]+)"><\/script>\n?/g, (whole, href) => {
  if (/^https?:/.test(href)) return whole;
  const file = resolve(src, href);
  const js = read(file);
  parts.push({ what: relative(here, file), bytes: Buffer.byteLength(js) });
  // A literal </script> inside a string would close the tag we are writing it
  // into. Nothing in the sources has one today; this makes sure of it forever.
  return '<script>\n' + js.replace(/<\/script>/gi, '<\\/script>') + '\n</script>\n';
});

/* The models, as a JSON island the page reads instead of fetching. */
const models = read(resolve(here, 'assets/models.json'));
parts.push({ what: 'assets/models.json', bytes: Buffer.byteLength(models) });
html = html.replace('<script>\n' + read(resolve(src, 'core/rng.js')),
  '<script id="gw-models" type="application/json">' + models + '</script>\n'
  + '<script>window.__GW_MODELS__ = JSON.parse(document.getElementById("gw-models").textContent);</script>\n'
  + '<script>\n' + read(resolve(src, 'core/rng.js')));

if (html.indexOf('__GW_MODELS__') < 0) {
  console.error('models were not injected: the anchor script moved');
  process.exit(1);
}

writeFileSync(OUT, html);

const bytes = statSync(OUT).size;
const gz = gzipSync(Buffer.from(html)).length;
parts.sort((a, b) => b.bytes - a.bytes);
console.log('built ' + relative(process.cwd(), OUT));
for (const p of parts.slice(0, 8)) {
  console.log('  ' + p.what.padEnd(28) + (p.bytes / 1024).toFixed(0).padStart(6) + ' KB');
}
const rest = parts.slice(8).reduce((s, p) => s + p.bytes, 0);
if (rest) console.log('  ' + '(everything else)'.padEnd(28) + (rest / 1024).toFixed(0).padStart(6) + ' KB');
console.log('  ' + '='.repeat(36));
console.log('  ' + 'one file'.padEnd(28) + (bytes / 1024 / 1024).toFixed(2).padStart(6) + ' MB  (' + (gz / 1024 / 1024).toFixed(2) + ' MB gzipped)');
