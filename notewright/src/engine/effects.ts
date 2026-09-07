/**
 * Effects, built from native Web Audio nodes only.
 *
 * No AudioWorklet anywhere in here. A worklet would buy a truer bitcrusher and
 * a few decibels of analogue character, at the cost of a second module that has
 * to load before the first note can sound and a whole class of "why is it
 * silent on this browser" failure. Everything below runs on nodes every engine
 * has had for a decade.
 */
import { clamp, crushCurve, divisionToBeats, driveCurve, impulseResponse } from './audio'
import type { Effect } from '../format/types'

export interface EffectNode {
  input: AudioNode
  output: AudioNode
  /** The parameters automation lanes can aim at, by their name in the file. */
  params: Record<string, AudioParam>
  dispose(): void
}

interface WetDry {
  input: GainNode
  output: GainNode
  dry: GainNode
  wet: GainNode
}

function wetDry(context: BaseAudioContext, mix: number): WetDry {
  const input = context.createGain()
  const output = context.createGain()
  const dry = context.createGain()
  const wet = context.createGain()
  dry.gain.value = 1 - clamp(mix, 0, 1)
  wet.gain.value = clamp(mix, 0, 1)
  input.connect(dry)
  dry.connect(output)
  wet.connect(output)
  return { input, output, dry, wet }
}

/**
 * A mix control has to move both halves of the crossfade, and an AudioParam can
 * only move one. Feeding the wet gain from a constant source lets automation
 * write to a single parameter and have the dry side follow it.
 */
function linkMix(context: BaseAudioContext, parts: WetDry): AudioParam {
  const control = context.createConstantSource()
  control.offset.value = parts.wet.gain.value
  const inverted = context.createGain()
  inverted.gain.value = -1
  const one = context.createConstantSource()
  one.offset.value = 1

  parts.wet.gain.value = 0
  parts.dry.gain.value = 0
  control.connect(parts.wet.gain)
  control.connect(inverted)
  one.connect(parts.dry.gain)
  inverted.connect(parts.dry.gain)

  control.start()
  one.start()
  return control.offset
}

export function createEffect(context: BaseAudioContext, effect: Effect, tempo: number): EffectNode {
  const secondsPerBeat = 60 / tempo

  switch (effect.type) {
    case 'filter': {
      const filter = context.createBiquadFilter()
      filter.type = effect.mode
      filter.frequency.value = clamp(effect.frequency, 20, 20000)
      filter.Q.value = clamp(effect.resonance, 0.0001, 30)
      return {
        input: filter,
        output: filter,
        params: { frequency: filter.frequency, resonance: filter.Q },
        dispose: () => filter.disconnect(),
      }
    }

    case 'drive': {
      const parts = wetDry(context, effect.mix)
      const shaper = context.createWaveShaper()
      shaper.curve = driveCurve(context, effect.amount)
      shaper.oversample = '4x'
      // Distortion adds harmonics all the way up; the tone control is what
      // stops that being an ice pick.
      const tone = context.createBiquadFilter()
      tone.type = 'lowpass'
      tone.frequency.value = 700 + clamp(effect.tone, 0, 1) * 15000
      // Soft clipping raises the average level a lot, so pull it back to make
      // the drive control a character knob rather than a volume knob.
      const trim = context.createGain()
      trim.gain.value = 1 / (1 + effect.amount * 1.6)
      parts.input.connect(shaper)
      shaper.connect(tone)
      tone.connect(trim)
      trim.connect(parts.wet)
      const mix = linkMix(context, parts)
      return {
        input: parts.input,
        output: parts.output,
        params: { mix, tone: tone.frequency },
        dispose: () => [parts.input, shaper, tone, trim, parts.output].forEach((node) => node.disconnect()),
      }
    }

    case 'chorus': {
      const parts = wetDry(context, effect.mix)
      const lfo = context.createOscillator()
      lfo.type = 'sine'
      lfo.frequency.value = clamp(effect.rate, 0.01, 12)
      const depth = context.createGain()
      depth.gain.value = 0.0008 + clamp(effect.depth, 0, 1) * 0.006
      lfo.connect(depth)

      const voices: AudioNode[] = []
      for (const [index, side] of [-0.8, 0.8].entries()) {
        const delay = context.createDelay(0.05)
        delay.delayTime.value = 0.012 + index * 0.007
        const panner = context.createStereoPanner()
        panner.pan.value = side
        // Opposite polarity on the second voice widens the image instead of
        // just doubling the same wobble.
        const polarity = context.createGain()
        polarity.gain.value = index === 0 ? 1 : -1
        depth.connect(polarity)
        polarity.connect(delay.delayTime)
        parts.input.connect(delay)
        delay.connect(panner)
        panner.connect(parts.wet)
        voices.push(delay, panner, polarity)
      }
      lfo.start()
      const mix = linkMix(context, parts)
      return {
        input: parts.input,
        output: parts.output,
        params: { mix, rate: lfo.frequency, depth: depth.gain },
        dispose: () => {
          try {
            lfo.stop()
          } catch {
            // Not started, or already stopped.
          }
          ;[parts.input, depth, parts.output, ...voices].forEach((node) => node.disconnect())
        },
      }
    }

    case 'delay': {
      const parts = wetDry(context, effect.mix)
      const time = clamp(divisionToBeats(effect.time) * secondsPerBeat, 0.001, 4)
      const feedback = context.createGain()
      feedback.gain.value = clamp(effect.feedback, 0, 0.95)
      // Each repeat losing its top end is what makes a delay sit behind the
      // dry signal rather than fighting it.
      const damp = context.createBiquadFilter()
      damp.type = 'lowpass'
      damp.frequency.value = 5200

      const left = context.createDelay(4)
      const right = context.createDelay(4)
      left.delayTime.value = time
      right.delayTime.value = time
      const panLeft = context.createStereoPanner()
      const panRight = context.createStereoPanner()
      panLeft.pan.value = effect.pingPong ? -0.85 : 0
      panRight.pan.value = effect.pingPong ? 0.85 : 0

      parts.input.connect(left)
      left.connect(panLeft)
      panLeft.connect(parts.wet)
      if (effect.pingPong) {
        left.connect(right)
        right.connect(panRight)
        panRight.connect(parts.wet)
        right.connect(damp)
      } else {
        left.connect(damp)
      }
      damp.connect(feedback)
      feedback.connect(left)

      const mix = linkMix(context, parts)
      return {
        input: parts.input,
        output: parts.output,
        params: { mix, feedback: feedback.gain, time: left.delayTime },
        dispose: () =>
          [parts.input, left, right, panLeft, panRight, damp, feedback, parts.output].forEach((node) =>
            node.disconnect(),
          ),
      }
    }

    case 'reverb': {
      const parts = wetDry(context, effect.mix)
      const convolver = context.createConvolver()
      convolver.buffer = impulseResponse(context, effect.size, effect.damping)
      parts.input.connect(convolver)
      convolver.connect(parts.wet)
      const mix = linkMix(context, parts)
      return {
        input: parts.input,
        output: parts.output,
        params: { mix },
        dispose: () => [parts.input, convolver, parts.output].forEach((node) => node.disconnect()),
      }
    }

    case 'compressor': {
      const compressor = context.createDynamicsCompressor()
      compressor.threshold.value = clamp(effect.threshold, -100, 0)
      compressor.ratio.value = clamp(effect.ratio, 1, 20)
      compressor.attack.value = clamp(effect.attack, 0, 1)
      compressor.release.value = clamp(effect.release, 0, 1)
      compressor.knee.value = 6
      return {
        input: compressor,
        output: compressor,
        params: {
          threshold: compressor.threshold,
          ratio: compressor.ratio,
          attack: compressor.attack,
          release: compressor.release,
        },
        dispose: () => compressor.disconnect(),
      }
    }

    case 'eq': {
      const low = context.createBiquadFilter()
      low.type = 'lowshelf'
      low.frequency.value = 260
      low.gain.value = clamp(effect.low, -24, 24)
      const mid = context.createBiquadFilter()
      mid.type = 'peaking'
      mid.frequency.value = clamp(effect.middleFrequency, 100, 12000)
      mid.Q.value = 0.9
      mid.gain.value = clamp(effect.mid, -24, 24)
      const high = context.createBiquadFilter()
      high.type = 'highshelf'
      high.frequency.value = 3600
      high.gain.value = clamp(effect.high, -24, 24)
      low.connect(mid)
      mid.connect(high)
      return {
        input: low,
        output: high,
        params: { low: low.gain, mid: mid.gain, middleFrequency: mid.frequency, high: high.gain },
        dispose: () => [low, mid, high].forEach((node) => node.disconnect()),
      }
    }

    case 'crush': {
      const parts = wetDry(context, effect.mix)
      const shaper = context.createWaveShaper()
      shaper.curve = crushCurve(context, effect.bits)
      parts.input.connect(shaper)
      shaper.connect(parts.wet)
      const mix = linkMix(context, parts)
      return {
        input: parts.input,
        output: parts.output,
        params: { mix },
        dispose: () => [parts.input, shaper, parts.output].forEach((node) => node.disconnect()),
      }
    }
  }
}

/** Wires a list of effects into a chain, skipping the disabled ones. */
/**
 * Wires a list of effects into a chain, skipping the disabled ones.
 *
 * `nodes` stays aligned with the input array — a disabled effect leaves a null
 * in its slot — because automation lanes address effects by the position the
 * user sees in the rack. Compacting the array here would silently retarget
 * every lane below a bypassed effect.
 */
export function buildChain(
  context: BaseAudioContext,
  effects: readonly Effect[],
  tempo: number,
): { input: AudioNode; output: AudioNode; nodes: (EffectNode | null)[]; dispose(): void } {
  const passthrough = context.createGain()
  const nodes: (EffectNode | null)[] = []
  let tail: AudioNode = passthrough

  for (const effect of effects) {
    if (!effect.enabled) {
      nodes.push(null)
      continue
    }
    const built = createEffect(context, effect, tempo)
    tail.connect(built.input)
    tail = built.output
    nodes.push(built)
  }

  return {
    input: passthrough,
    output: tail,
    nodes,
    dispose: () => {
      passthrough.disconnect()
      for (const node of nodes) node?.dispose()
    },
  }
}
