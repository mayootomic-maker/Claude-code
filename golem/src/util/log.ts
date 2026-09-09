/**
 * Logging.
 *
 * Structured, because the interesting failures in a long-running bot are things
 * like "why did it decide to do that at 3am", and grepping prose does not
 * answer that. Human-readable by default because the usual reader is a person
 * watching a terminal.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
  child(scope: string): Logger
}

export interface LoggerOptions {
  level?: LogLevel
  /** Emit one JSON object per line instead of formatted text. */
  json?: boolean
  sink?: (line: string) => void
}

let globalLevel: LogLevel = (process.env.GOLEM_LOG_LEVEL as LogLevel) ?? 'info'

export function setLogLevel(level: LogLevel): void {
  globalLevel = level
}

export function createLogger(scope: string, options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? ((line: string) => process.stderr.write(`${line}\n`))
  const json = options.json ?? process.env.GOLEM_LOG_FORMAT === 'json'

  const emit = (level: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    const threshold = options.level ?? globalLevel
    if (ORDER[level] < ORDER[threshold]) return

    if (json) {
      sink(JSON.stringify({ ts: new Date().toISOString(), level, scope, message, ...fields }))
      return
    }
    const time = new Date().toISOString().slice(11, 19)
    const extra = fields && Object.keys(fields).length > 0 ? ` ${formatFields(fields)}` : ''
    sink(`${time} ${level.toUpperCase().padEnd(5)} ${scope.padEnd(9)} ${message}${extra}`)
  }

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (child) => createLogger(`${scope}:${child}`, options),
  }
}

function formatFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ')
}
