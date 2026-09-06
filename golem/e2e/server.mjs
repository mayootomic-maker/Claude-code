/**
 * A real Minecraft server, offline, for the end-to-end drive.
 *
 * flying-squid generates an actual world and speaks the actual 1.21.4
 * protocol, so the bot exercises the real join, chunk-loading, movement,
 * digging and chat paths rather than a mock of them. It needs no Mojang
 * account and no downloaded jar, which is what makes it runnable in CI.
 */

import squid from 'flying-squid'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = Number(process.env.GOLEM_E2E_PORT ?? 25599)
// A world folder of `null` is taken literally and leaves a directory called
// "null" in the repo. Give it a real temporary one instead.
const world = mkdtempSync(join(tmpdir(), 'golem-world-'))

squid.createMCServer({
  motd: 'golem e2e',
  port,
  'max-players': 4,
  'online-mode': false,
  logging: false,
  gameMode: 0,
  difficulty: 1,
  worldFolder: world,
  generation: { name: 'diamond_square', options: { seed: 4242, worldHeight: 80 } },
  kickTimeout: 60_000,
  plugins: {},
  modpe: false,
  'view-distance': 4,
  'player-list-text': { header: 'golem', footer: 'e2e' },
  'everybody-op': true,
  version: '1.21.4',
})

process.stdout.write(`e2e server listening on ${port}\n`)
