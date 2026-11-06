// Packs the production build (dist/) into one self-contained HTML file that
// runs straight from disk: double-click it, no server, no install, offline.
//   npm run single   ->  dist-single/apex-drift.html
// Every image, sound, font and the engine-sound worklet goes in as a data: URL
// (see src/core/assets.ts for how the game finds them again).
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname
const OUT_DIR = new URL('../dist-single/', import.meta.url).pathname
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.json': 'application/json', '.woff2': 'font/woff2',
  '.html': 'text/html;charset=utf-8', '.txt': 'text/plain;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
}

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const dataUrl = (file) => {
  const type = MIME[extname(file).toLowerCase()]
  if (!type) throw new Error(`no MIME type for ${file}`)
  return `data:${type};base64,${readFileSync(file).toString('base64')}`
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8')
const jsRef = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/)
const cssRef = html.match(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/)
if (!jsRef || !cssRef) throw new Error('dist/index.html does not look like a Vite build')

const assets = {}
for (const f of walk(DIST)) {
  const rel = relative(DIST, f).split('\\').join('/')
  if (rel === 'index.html' || rel === jsRef[1] || rel === cssRef[1]) continue
  assets[rel] = dataUrl(f)
}

// Fonts and images the stylesheet points at, relative to assets/.
const css = readFileSync(join(DIST, cssRef[1]), 'utf8').replace(/url\(\.\.\/([^)]+)\)/g, (m, p) => {
  if (!assets[p]) throw new Error(`stylesheet refers to missing ${p}`)
  return `url(${assets[p]})`
})
// A literal "</script" inside the code or the data would end the tag early.
const safe = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')
const js = safe(readFileSync(join(DIST, jsRef[1]), 'utf8'))
const table = safe(JSON.stringify(assets))

const out = html
  .replace(jsRef[0], '')
  .replace(cssRef[0], () => `<style>${css}</style>`)
  .replace('</body>', () => `<script>window.__APEX_ASSETS=${table}</script>\n<script type="module">${js}</script>\n</body>`)

for (const bad of [/\bsrc="\.\//, /\bhref="\.\//, /url\(\.\.\//]) {
  if (bad.test(out)) throw new Error(`single file still points at an outside file: ${bad}`)
}
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'apex-drift.html'), out)
console.log(`dist-single/apex-drift.html  ${(out.length / 1024 / 1024).toFixed(2)} MB, ${Object.keys(assets).length} files inside`)
