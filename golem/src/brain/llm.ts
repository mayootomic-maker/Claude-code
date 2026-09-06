/**
 * Talking to a language model.
 *
 * Written against the HTTP APIs directly rather than through a vendor SDK. The
 * surface actually used here is small — one endpoint, tool calls, a retry —
 * and going direct means one provider abstraction instead of two, no SDK
 * version to keep in step, and an OpenAI-compatible path that covers local
 * models through Ollama or anything else that speaks the same shape.
 */

import type { JsonSchema } from './tools.js'
import type { Logger } from '../util/log.js'

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly input: JsonSchema
}

export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
}

export type Message =
  | { readonly role: 'user'; readonly text: string }
  | { readonly role: 'assistant'; readonly text: string; readonly toolCalls: readonly ToolCall[] }
  | { readonly role: 'tool'; readonly callId: string; readonly text: string; readonly failed: boolean }

export interface Reply {
  readonly text: string
  readonly toolCalls: readonly ToolCall[]
  readonly stopped: 'tools' | 'end' | 'length'
}

export interface LanguageModel {
  readonly name: string
  respond(system: string, messages: readonly Message[], tools: readonly ToolDefinition[]): Promise<Reply>
}

export interface ModelConfig {
  readonly provider: 'anthropic' | 'openai'
  readonly model: string
  readonly apiKey?: string
  /** Override for OpenAI-compatible servers, e.g. http://localhost:11434/v1 */
  readonly baseUrl?: string
  readonly maxTokens?: number
  readonly logger?: Logger
}

export function createModel(config: ModelConfig): LanguageModel {
  return config.provider === 'anthropic' ? new AnthropicModel(config) : new OpenAIModel(config)
}

/** Transient failures are the norm on a long-running bot; give up only slowly. */
async function post(url: string, headers: Record<string, string>, body: unknown, log?: Logger): Promise<unknown> {
  let lastError: unknown = null

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      const backoff = 500 * 2 ** (attempt - 1)
      await new Promise((r) => setTimeout(r, backoff))
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })

      if (response.ok) return await response.json()

      const detail = await response.text()
      // 4xx other than rate limiting will not fix itself; fail immediately
      // rather than burning three more round trips on the same bad request.
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`model returned ${response.status}: ${detail.slice(0, 400)}`)
      }
      lastError = new Error(`model returned ${response.status}: ${detail.slice(0, 200)}`)
      log?.warn('model call failed, retrying', { status: response.status, attempt })
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('model returned 4')) throw error
      lastError = error
      log?.warn('model call errored, retrying', { error: String(error), attempt })
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

class AnthropicModel implements LanguageModel {
  readonly name: string
  private readonly key: string
  private readonly url: string

  constructor(private readonly config: ModelConfig) {
    this.name = config.model
    const key = config.apiKey ?? process.env.ANTHROPIC_API_KEY
    if (!key) throw new Error('no Anthropic API key: set ANTHROPIC_API_KEY')
    this.key = key
    this.url = `${config.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`
  }

  async respond(
    system: string,
    messages: readonly Message[],
    tools: readonly ToolDefinition[],
  ): Promise<Reply> {
    const body = {
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 2048,
      system,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input,
      })),
      messages: toAnthropic(messages),
    }

    const raw = await post(
      this.url,
      { 'x-api-key': this.key, 'anthropic-version': '2023-06-01' },
      body,
      this.config.logger,
    )

    const response = raw as {
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>
      stop_reason?: string
    }

    let text = ''
    const toolCalls: ToolCall[] = []
    for (const block of response.content ?? []) {
      if (block.type === 'text' && block.text) text += block.text
      if (block.type === 'tool_use' && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: (block.input as Record<string, unknown>) ?? {},
        })
      }
    }

    return {
      text: text.trim(),
      toolCalls,
      stopped:
        response.stop_reason === 'tool_use' ? 'tools' : response.stop_reason === 'max_tokens' ? 'length' : 'end',
    }
  }
}

function toAnthropic(messages: readonly Message[]): Array<{ role: string; content: unknown }> {
  const out: Array<{ role: string; content: unknown }> = []

  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: message.text }] })
      continue
    }
    if (message.role === 'assistant') {
      const content: unknown[] = []
      if (message.text) content.push({ type: 'text', text: message.text })
      for (const call of message.toolCalls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
      }
      // An assistant turn with no content at all is rejected by the API.
      out.push({ role: 'assistant', content: content.length > 0 ? content : [{ type: 'text', text: '...' }] })
      continue
    }

    // Tool results are user-role blocks, and consecutive ones must be merged
    // into a single turn or the API rejects the alternation.
    const block = {
      type: 'tool_result',
      tool_use_id: message.callId,
      content: message.text,
      is_error: message.failed,
    }
    const previous = out[out.length - 1]
    if (previous?.role === 'user' && Array.isArray(previous.content) && isToolResults(previous.content)) {
      previous.content.push(block)
    } else {
      out.push({ role: 'user', content: [block] })
    }
  }
  return out
}

function isToolResults(content: unknown[]): boolean {
  return content.length > 0 && content.every((c) => (c as { type?: string }).type === 'tool_result')
}

/**
 * OpenAI-compatible chat completions.
 *
 * Also the route to local models: Ollama, llama.cpp's server and LM Studio all
 * expose this shape, so pointing `baseUrl` at one of them makes the bot run
 * with no API key and no network.
 */
class OpenAIModel implements LanguageModel {
  readonly name: string
  private readonly url: string
  private readonly key: string

  constructor(private readonly config: ModelConfig) {
    this.name = config.model
    this.url = `${config.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`
    // Local servers ignore the key but object to it being absent.
    this.key = config.apiKey ?? process.env.OPENAI_API_KEY ?? 'local'
  }

  async respond(
    system: string,
    messages: readonly Message[],
    tools: readonly ToolDefinition[],
  ): Promise<Reply> {
    const body = {
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 2048,
      messages: [{ role: 'system', content: system }, ...toOpenAI(messages)],
      tools: tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.input },
      })),
    }

    const raw = await post(this.url, { authorization: `Bearer ${this.key}` }, body, this.config.logger)
    const response = raw as {
      choices?: Array<{
        finish_reason?: string
        message?: {
          content?: string | null
          tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }>
        }
      }>
    }

    const choice = response.choices?.[0]
    const toolCalls: ToolCall[] = []
    for (const call of choice?.message?.tool_calls ?? []) {
      if (!call.function?.name) continue
      toolCalls.push({
        id: call.id,
        name: call.function.name,
        // Arguments arrive as a JSON string, and models do sometimes emit
        // malformed ones. An empty object lets the tool's own validation
        // produce a useful message instead of crashing the loop here.
        input: safeParse(call.function.arguments),
      })
    }

    return {
      text: (choice?.message?.content ?? '').trim(),
      toolCalls,
      stopped:
        choice?.finish_reason === 'tool_calls' ? 'tools' : choice?.finish_reason === 'length' ? 'length' : 'end',
    }
  }
}

function toOpenAI(messages: readonly Message[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.role === 'user') return { role: 'user', content: message.text }
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.text || null,
        ...(message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.input) },
              })),
            }
          : {}),
      }
    }
    return { role: 'tool', tool_call_id: message.callId, content: message.text }
  })
}

function safeParse(text: string | undefined): Record<string, unknown> {
  if (!text) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
