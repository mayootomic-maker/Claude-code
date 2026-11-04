// Fails the build if the release bundle carries anything that must not ship:
// the 2.0 admin backdoor, debug hooks, network endpoints, or a broken asset path.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dist = new URL('../dist/', import.meta.url).pathname
const files = []
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else files.push(p)
  }
}
walk(dist)

const forbidden = [
  [/TOMIC-ADMIN/i, 'the 2.0 admin unlock code'],
  [/adminBtn|toggleAdmin/, 'the 2.0 admin panel'],
  [/broker\.(emqx|hivemq)/, 'the public MQTT brokers 2.0 used for online play'],
  [/[?&]brokers=/, 'the broker override parameter'],
  [/wss?:\/\//, 'a WebSocket endpoint (3.0 has no network features)'],
  [/\bdev\.ts\b|__ready/, 'dev-only harness code'],
]
const problems = []
let js = 0, css = 0, total = 0
for (const f of files) {
  const size = statSync(f).size
  total += size
  if (!/\.(js|css|html|json)$/.test(f)) continue
  const text = readFileSync(f, 'utf8')
  if (f.endsWith('.js')) js += size
  if (f.endsWith('.css')) css += size
  for (const [re, what] of forbidden) if (re.test(text)) problems.push(`${f.replace(dist, '')}: contains ${what}`)
  // Absolute asset URLs break inside the Android asset loader (served under /assets/www/).
  if (f.endsWith('.css') && /url\(\s*['"]?\/(?!\/)/.test(text)) problems.push(`${f.replace(dist, '')}: absolute url() in CSS`)
}
if (!files.some((f) => f.endsWith('privacy.html'))) problems.push('privacy.html is missing from the build')
const kb = (n) => `${(n / 1024).toFixed(0)} KB`
console.log(`release bundle: ${files.length} files, ${kb(total)} total, JS ${kb(js)}, CSS ${kb(css)}`)
if (total > 40 * 1024 * 1024) problems.push(`bundle is ${kb(total)}, over the 40 MB download target`)
if (problems.length) {
  console.error('Release check failed:\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log('release check passed')
