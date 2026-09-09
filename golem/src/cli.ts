#!/usr/bin/env node
/**
 * The entry point.
 *
 * Connect, load the game data, build the planner, wire up chat, and stay out of
 * the way. Everything the operator needs to do after this happens in game chat.
 */

import { GolemBot } from './bot/bot.js'
import { Agent, createAgentModel } from './brain/agent.js'
import { ConfigError, helpText, parseArgs, type Config } from './config.js'
import { GameData } from './mc/data.js'
import { Memory } from './memory/store.js'
import { Planner } from './plan/acquire.js'
import { attachChat } from './ui/chat.js'
import { createLogger, setLogLevel } from './util/log.js'

async function main(): Promise<number> {
  let config: Config | 'help'
  try {
    config = parseArgs(process.argv.slice(2))
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`golem: ${error.message}\n\nTry --help.\n`)
      return 2
    }
    throw error
  }

  if (config === 'help') {
    process.stdout.write(helpText())
    return 0
  }

  setLogLevel(config.logLevel)
  const log = createLogger('golem')

  if (!config.apiKey && !config.baseUrl) {
    const variable = config.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'
    process.stderr.write(
      `golem: no API key. Set ${variable}, or point --base-url at a local model.\n`,
    )
    return 2
  }

  // The recipe tables load once, up front: a failure here is a configuration
  // problem and should be reported before anything connects to a server.
  log.info('loading game data', { version: config.dataVersion })
  const data = new GameData(config.dataVersion)
  const planner = new Planner(data)
  log.info('priced the game', { items: planner.costs.cost.size })

  const memory = await Memory.open(config.username, log.child('memory'), config.memoryDir)

  const golem = new GolemBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    auth: config.auth,
    humanise: config.humanise,
    logger: log.child('bot'),
  })

  log.info('connecting', { host: config.host, port: config.port, as: config.username })
  try {
    await golem.ready()
  } catch (error) {
    log.error('could not join the server', { error: String(error) })
    return 1
  }

  const model = createAgentModel({
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    logger: log.child('model'),
  })

  const agent = new Agent({
    golem,
    data,
    planner,
    memory,
    model,
    log: log.child('agent'),
  })

  agent.startReflexes()
  attachChat({ golem, agent, data, memory, log: log.child('chat'), owners: config.owners })

  golem.bot.on('death', () => {
    const p = golem.bot.entity.position
    memory.died({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) }, 'unknown')
    void memory.save()
    log.warn('died', { at: `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}` })
  })

  await golem.say(`hey, ${config.username} here. tell me what you need.`, 'considered')
  log.info('ready', { model: model.name })

  // Stay running until the process is asked to stop or the connection drops.
  await new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      log.info('shutting down', { signal })
      agent.cancel()
      agent.stopReflexes()
      void memory.save().finally(() => {
        golem.dispose('bye')
        resolve()
      })
    }
    process.once('SIGINT', () => shutdown('SIGINT'))
    process.once('SIGTERM', () => shutdown('SIGTERM'))
    golem.bot.once('end', () => {
      agent.stopReflexes()
      void memory.save().finally(resolve)
    })
  })

  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`golem: ${String(error)}\n`)
    process.exitCode = 1
  })
