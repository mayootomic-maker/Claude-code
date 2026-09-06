/**
 * Configuration, from flags and the environment.
 *
 * Validated by hand rather than with a schema library. The whole surface is a
 * dozen fields, and the errors a hand-written check produces ("--port must be a
 * number between 1 and 65535, got 'abc'") are better than the ones a generic
 * validator produces for a program whose users are mostly not programmers.
 */

import type { LogLevel } from './util/log.js'

export interface Config {
  readonly host: string
  readonly port: number
  readonly username: string
  readonly version: string | undefined
  readonly auth: 'offline' | 'microsoft'
  /** Who may give the bot orders. Empty means anyone on the server. */
  readonly owners: readonly string[]
  readonly provider: 'anthropic' | 'openai'
  readonly model: string | undefined
  readonly apiKey: string | undefined
  readonly baseUrl: string | undefined
  readonly humanise: boolean
  readonly logLevel: LogLevel
  readonly memoryDir: string | undefined
  /** Data version for the recipe tables. Defaults to the server's version. */
  readonly dataVersion: string
}

export class ConfigError extends Error {}

const HELP = `golem — an AI that plays Minecraft

Usage:
  golem [options]

Connection:
  --host <host>          Server address (default: localhost)
  --port <port>          Server port (default: 25565)
  --username <name>      Name to join as (default: Golem)
                         Also seeds the persona, so the same name always
                         plays the same way.
  --version <version>    Minecraft version (default: detect from server)
  --online               Join with a Microsoft account instead of offline mode

Brain:
  --provider <name>      anthropic (default) or openai
  --model <model>        Model id (default: claude-sonnet-5)
  --base-url <url>       For OpenAI-compatible servers, e.g. a local Ollama:
                         http://localhost:11434/v1
  --owner <name>         Player allowed to give orders. Repeatable.
                         With none set, anyone on the server can.

Behaviour:
  --no-humanise          Act at machine speed. Off by default.
  --data-version <ver>   Recipe data version (default: 1.21.4)
  --memory-dir <path>    Where to keep memory (default: ~/.golem)
  --log <level>          debug, info, warn or error (default: info)
  -h, --help             This.

Environment:
  ANTHROPIC_API_KEY      Key for the default provider.
  OPENAI_API_KEY         Key when --provider openai is used.

Once it joins, talk to it in game chat:
  golem, get me a diamond pickaxe
  golem, stop
  golem, status
`

export function parseArgs(argv: readonly string[]): Config | 'help' {
  const flags = new Map<string, string[]>()
  let i = 0

  while (i < argv.length) {
    const arg = argv[i]!
    if (arg === '-h' || arg === '--help') return 'help'
    if (!arg.startsWith('--')) throw new ConfigError(`unexpected argument "${arg}"`)

    const key = arg.slice(2)
    const next = argv[i + 1]
    // Boolean flags take no value; everything else consumes the next argument.
    if (key.startsWith('no-') || key === 'online') {
      push(flags, key, 'true')
      i += 1
      continue
    }
    if (next === undefined || next.startsWith('--')) {
      throw new ConfigError(`--${key} needs a value`)
    }
    push(flags, key, next)
    i += 2
  }

  const one = (key: string): string | undefined => flags.get(key)?.[0]
  const port = one('port')

  if (port !== undefined && !isPort(port)) {
    throw new ConfigError(`--port must be a number between 1 and 65535, got "${port}"`)
  }

  const provider = one('provider') ?? 'anthropic'
  if (provider !== 'anthropic' && provider !== 'openai') {
    throw new ConfigError(`--provider must be "anthropic" or "openai", got "${provider}"`)
  }

  const logLevel = one('log') ?? 'info'
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new ConfigError(`--log must be debug, info, warn or error, got "${logLevel}"`)
  }

  const username = one('username') ?? 'Golem'
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    throw new ConfigError(
      `--username must be 3-16 letters, digits or underscores, got "${username}"`,
    )
  }

  return {
    host: one('host') ?? 'localhost',
    port: port === undefined ? 25565 : Number(port),
    username,
    version: one('version'),
    auth: flags.has('online') ? 'microsoft' : 'offline',
    owners: flags.get('owner') ?? [],
    provider,
    model: one('model'),
    apiKey: provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY,
    baseUrl: one('base-url'),
    humanise: !flags.has('no-humanise'),
    logLevel: logLevel as LogLevel,
    memoryDir: one('memory-dir'),
    dataVersion: one('data-version') ?? '1.21.4',
  }
}

export function helpText(): string {
  return HELP
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function isPort(value: string): boolean {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 65535
}
