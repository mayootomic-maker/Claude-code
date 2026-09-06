/**
 * Start the server, drive the bot at it, shut everything down.
 *
 * One command so the end-to-end run is as easy to reach for as the unit tests.
 * A drive nobody runs proves nothing.
 */

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const port = process.env.GOLEM_E2E_PORT ?? '25599'

const server = spawn(process.execPath, [join(here, 'server.mjs')], {
  env: { ...process.env, GOLEM_E2E_PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const stop = () => {
  if (!server.killed) server.kill('SIGKILL')
}
process.on('exit', stop)
process.on('SIGINT', () => {
  stop()
  process.exit(130)
})

// The world is generated on boot; the bot cannot join before that finishes.
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server did not start within 60s')), 60_000)
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes('listening')) {
      clearTimeout(timer)
      // Chunk generation continues briefly after the socket opens.
      setTimeout(resolve, 6_000)
    }
  })
  server.once('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`server exited early with code ${code}`))
  })
})

const drive = spawn(process.execPath, [join(here, 'drive.mjs')], {
  env: { ...process.env, GOLEM_E2E_PORT: port },
  stdio: 'inherit',
})

const [code] = await once(drive, 'exit')
stop()
process.exit(code ?? 1)
