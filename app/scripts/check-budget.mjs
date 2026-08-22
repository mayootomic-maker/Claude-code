/**
 * Enforces the bundle budget.
 *
 * The budget in CLAUDE.md is only real if something fails when it is breached.
 * A commute app that takes three seconds to tell you when to leave has failed
 * at its one job, and bundles grow by accident, a few KB at a time.
 *
 * Measures gzip, because that is what actually crosses the network.
 */

import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const DIST = new URL('../dist/assets/', import.meta.url).pathname

/** Gzipped kilobytes. */
const BUDGETS = { js: 50, css: 10 }

const files = await readdir(DIST).catch(() => {
  console.error('No dist/assets — run `npm run build` first.')
  process.exit(1)
})

const totals = { js: 0, css: 0 }

for (const name of files) {
  const kind = name.endsWith('.js') ? 'js' : name.endsWith('.css') ? 'css' : null
  if (kind === null) continue

  const raw = await readFile(`${DIST}${name}`)
  const gz = gzipSync(raw).length / 1024
  totals[kind] += gz
  console.log(`  ${name.padEnd(34)} ${gz.toFixed(2).padStart(7)} KB gz`)
}

console.log()
let failed = false
for (const [kind, budget] of Object.entries(BUDGETS)) {
  const used = totals[kind]
  const pct = Math.round((used / budget) * 100)
  const status = used > budget ? 'OVER BUDGET' : 'ok'
  if (used > budget) failed = true
  console.log(
    `  ${kind.toUpperCase().padEnd(4)} ${used.toFixed(2).padStart(7)} / ${budget} KB gz  (${pct}%)  ${status}`,
  )
}

if (failed) {
  console.error('\nBundle budget exceeded. See the Budget section in CLAUDE.md.')
  process.exit(1)
}
console.log('\nWithin budget.')
