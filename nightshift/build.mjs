/* Bundle the game into one HTML file.

   No bundler and nothing to install: the sources are plain scripts listed in
   dependency order by src/index.html, and this inlines them in that order
   along with the stylesheet. The result opens from a file:// URL with no
   server, which is the entire distribution plan -- a game a class has to
   install is a game the class does not play.

   Usage: node nightshift/build.mjs [--out path] [--fragment]

   --fragment emits the same page without its <!doctype>, <html>, <head> or
   <body> tags, for hosts that supply their own document skeleton. */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, 'src');
const outArg = process.argv.indexOf('--out');
const FRAGMENT = process.argv.includes('--fragment');
const OUT = outArg > 0
  ? resolve(process.argv[outArg + 1])
  : resolve(here, FRAGMENT ? 'nightshift.fragment.html' : 'nightshift.html');

const read = (p) => readFileSync(p, 'utf8');

let html = read(resolve(src, 'index.html'));
const parts = [];

/* The font link is left alone: it is on the artifact CSP's allowlist and
   falls back to the system stack when it cannot be reached. */
html = html.replace(/[ \t]*<link rel="stylesheet" href="([^"]+)">\n?/g, (whole, href) => {
  if (/^https?:/.test(href)) return whole;
  const css = read(resolve(src, href));
  parts.push({ what: href, bytes: Buffer.byteLength(css) });
  return '<style>\n' + css + '\n</style>\n';
});

html = html.replace(/[ \t]*<script src="([^"]+)"><\/script>\n?/g, (whole, href) => {
  if (/^https?:/.test(href)) return whole;
  const file = resolve(src, href);
  const js = read(file);
  parts.push({ what: relative(src, file), bytes: Buffer.byteLength(js) });
  /* A literal </script> inside a string would close the tag being written.
     Nothing in the sources has one today; this makes sure of it forever. */
  return '<script>\n' + js.replace(/<\/script>/gi, '<\\/script>') + '\n</script>\n';
});

if (/<script src="(?!https?:)/.test(html)) {
  console.error('a local script was not inlined; check the tag formatting in src/index.html');
  process.exit(1);
}

if (FRAGMENT) {
  html = html
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<html[^>]*>\s*/i, '')
    .replace(/<\/html>\s*/i, '')
    .replace(/<head>\s*/i, '')
    .replace(/<\/head>\s*/i, '')
    .replace(/<body>\s*/i, '')
    .replace(/<\/body>\s*/i, '');
  if (/<html|<body|<!doctype/i.test(html)) {
    console.error('fragment still contains document scaffolding');
    process.exit(1);
  }
}

writeFileSync(OUT, html);

const bytes = statSync(OUT).size;
const gz = gzipSync(Buffer.from(html)).length;
parts.sort((a, b) => b.bytes - a.bytes);
console.log('built ' + relative(process.cwd(), OUT));
for (const p of parts.slice(0, 7)) {
  console.log('  ' + p.what.padEnd(24) + (p.bytes / 1024).toFixed(1).padStart(7) + ' KB');
}
const rest = parts.slice(7).reduce((s, p) => s + p.bytes, 0);
if (rest) console.log('  ' + '(everything else)'.padEnd(24) + (rest / 1024).toFixed(1).padStart(7) + ' KB');
console.log('  ' + '='.repeat(32));
console.log('  ' + 'one file'.padEnd(24) + (bytes / 1024).toFixed(0).padStart(7) + ' KB  ('
  + (gz / 1024).toFixed(0) + ' KB gzipped)');
