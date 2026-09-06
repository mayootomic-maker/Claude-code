import { describe, expect, it } from 'vitest'
import { ConfigError, parseArgs } from '../src/config.js'
import { extractCommand } from '../src/ui/chat.js'
import { describeTime } from '../src/bot/world.js'

describe('argument parsing', () => {
  it('works with no arguments at all', () => {
    const config = parseArgs([])
    expect(config).not.toBe('help')
    if (config === 'help') return
    expect(config.host).toBe('localhost')
    expect(config.port).toBe(25565)
    expect(config.username).toBe('Golem')
    expect(config.humanise).toBe(true)
  })

  it('reads connection settings', () => {
    const config = parseArgs(['--host', 'mc.example.com', '--port', '25566', '--username', 'Tom_99'])
    if (config === 'help') throw new Error('unexpected help')
    expect(config.host).toBe('mc.example.com')
    expect(config.port).toBe(25566)
    expect(config.username).toBe('Tom_99')
  })

  it('collects repeated owners', () => {
    const config = parseArgs(['--owner', 'alice', '--owner', 'bob'])
    if (config === 'help') throw new Error('unexpected help')
    expect(config.owners).toEqual(['alice', 'bob'])
  })

  it('treats --no-humanise and --online as flags taking no value', () => {
    const config = parseArgs(['--no-humanise', '--online', '--host', 'here'])
    if (config === 'help') throw new Error('unexpected help')
    expect(config.humanise).toBe(false)
    expect(config.auth).toBe('microsoft')
    expect(config.host).toBe('here')
  })

  it('asks for help when asked', () => {
    expect(parseArgs(['--help'])).toBe('help')
    expect(parseArgs(['-h'])).toBe('help')
  })

  it('rejects bad input with a message a person can act on', () => {
    expect(() => parseArgs(['--port', 'abc'])).toThrow(ConfigError)
    expect(() => parseArgs(['--port', '99999'])).toThrow(/between 1 and 65535/)
    expect(() => parseArgs(['--provider', 'gemini'])).toThrow(/anthropic/)
    expect(() => parseArgs(['--username', 'x'])).toThrow(/3-16/)
    expect(() => parseArgs(['--log', 'verbose'])).toThrow(/debug, info, warn or error/)
    expect(() => parseArgs(['--host'])).toThrow(/needs a value/)
    expect(() => parseArgs(['nonsense'])).toThrow(/unexpected argument/)
  })
})

describe('being spoken to', () => {
  it('answers to its name in the shapes people actually type', () => {
    for (const line of ['golem, get iron', 'Golem get iron', '@golem get iron', 'golem: get iron']) {
      expect(extractCommand(line, 'Golem')).toBe('get iron')
    }
  })

  it('treats a bare name as a greeting rather than an empty order', () => {
    expect(extractCommand('golem', 'Golem')).toBe('say hello')
  })

  it('ignores everything not addressed to it', () => {
    // A bot that answers every line in a busy server is unusable.
    expect(extractCommand('anyone got iron?', 'Golem')).toBeNull()
    expect(extractCommand('hey steve, get iron', 'Golem')).toBeNull()
  })
})

describe('the clock, in words', () => {
  it('names each part of the day', () => {
    expect(describeTime(0)).toBe('dawn')
    expect(describeTime(6_000)).toBe('midday')
    expect(describeTime(13_500)).toBe('night')
    expect(describeTime(23_000)).toBe('before dawn')
  })

  it('handles a wrapped or negative tick count', () => {
    expect(describeTime(24_000)).toBe('dawn')
    expect(describeTime(30_000)).toBe('midday') // 30000 wraps to 6000
    expect(describeTime(-1_000)).toBe('before dawn')
  })
})
