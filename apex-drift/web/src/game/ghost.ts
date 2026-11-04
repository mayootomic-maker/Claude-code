/**
 * Your best run on a stage, replayed as a translucent car to race against.
 * Recorded at 10 Hz (x, y, z, heading) and stored as base64 Float32 data;
 * only the most recent few stages are kept so saves stay small.
 */
const KEY = 'apexdrift.ghosts.v1'
const KEEP = 6
const HZ = 10

export interface Ghost {
  car: string
  livery: string
  time: number
  frames: Float32Array
}

export class GhostRecorder {
  private data: number[] = []
  private next = 0

  record(t: number, x: number, y: number, z: number, heading: number): void {
    if (t < this.next) return
    this.next = t + 1 / HZ
    this.data.push(x, y, z, heading)
  }

  frames(): Float32Array {
    return new Float32Array(this.data)
  }
}

/** Interpolated pose at time t, or null before the start or after the end. */
export function ghostPose(g: Ghost, t: number): { x: number; y: number; z: number; heading: number } | null {
  const n = g.frames.length / 4
  const f = t * HZ
  const i = Math.floor(f)
  if (i < 0 || i >= n - 1) return null
  const a = i * 4, b = a + 4, u = f - i
  let dh = g.frames[b + 3] - g.frames[a + 3]
  while (dh > Math.PI) dh -= 2 * Math.PI
  while (dh < -Math.PI) dh += 2 * Math.PI
  return {
    x: g.frames[a] + (g.frames[b] - g.frames[a]) * u,
    y: g.frames[a + 1] + (g.frames[b + 1] - g.frames[a + 1]) * u,
    z: g.frames[a + 2] + (g.frames[b + 2] - g.frames[a + 2]) * u,
    heading: g.frames[a + 3] + dh * u,
  }
}

type Stored = Record<string, { car: string; livery: string; time: number; at: number; data: string }>

function read(storage: Storage | null): Stored {
  try {
    const raw = storage?.getItem(KEY)
    const v = raw ? JSON.parse(raw) : {}
    return v && typeof v === 'object' ? (v as Stored) : {}
  } catch {
    return {}
  }
}

const toB64 = (f: Float32Array): string => {
  const bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const fromB64 = (s: string): Float32Array => {
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Float32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
}

export function loadGhost(storage: Storage | null, stageKey: string): Ghost | null {
  const e = read(storage)[stageKey]
  if (!e || typeof e.data !== 'string' || typeof e.time !== 'number') return null
  try {
    const frames = fromB64(e.data)
    return frames.length >= 8 ? { car: e.car, livery: e.livery, time: e.time, frames } : null
  } catch {
    return null
  }
}

/** Keeps the ghost if it beats the stored one. Returns true when saved. */
export function saveGhost(storage: Storage | null, stageKey: string, g: Ghost): boolean {
  if (!storage) return false
  const all = read(storage)
  const old = all[stageKey]
  if (old && old.time <= g.time) return false
  all[stageKey] = { car: g.car, livery: g.livery, time: g.time, at: Date.now(), data: toB64(g.frames) }
  const keys = Object.keys(all).sort((a, b) => (all[b].at ?? 0) - (all[a].at ?? 0))
  for (const k of keys.slice(KEEP)) delete all[k]
  try {
    storage.setItem(KEY, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}
