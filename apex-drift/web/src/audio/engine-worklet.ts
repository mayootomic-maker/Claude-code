// Runs on the audio thread (AudioWorkletGlobalScope). Bundled by Vite as its own
// asset via `?worker&url`, so the DSP is inlined and the URL stays relative.
import { EngineDSP, ENGINE_PARAMS } from './engine-dsp'
import type { EngineProfile } from './engines'

declare const sampleRate: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}

class ApexEngine extends AudioWorkletProcessor {
  static get parameterDescriptors(): { name: string; defaultValue: number; automationRate: 'k-rate' }[] {
    return ENGINE_PARAMS.map((name) => ({ name, defaultValue: 0, automationRate: 'k-rate' }))
  }

  private readonly dsp: EngineDSP
  private alive = true

  constructor(options: { processorOptions: { profile: EngineProfile } }) {
    super(options)
    this.dsp = new EngineDSP(options.processorOptions.profile, sampleRate)
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data === 'stop') this.alive = false
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean {
    const inp = this.dsp.in
    for (let i = 0; i < ENGINE_PARAMS.length; i++) {
      const k = ENGINE_PARAMS[i]
      const v = params[k]
      if (v) inp[k] = v[0]
    }
    const eng = outputs[0]?.[0]
    const sfx = outputs[1]?.[0]
    const frames = eng?.length ?? sfx?.length ?? 128
    this.dsp.render(eng, sfx, frames)
    return this.alive
  }
}

registerProcessor('apex-engine', ApexEngine)
