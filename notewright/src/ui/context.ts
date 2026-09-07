import { createContext } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import type { AudioHost } from '../state/audio'
import type { AppState, Store } from '../state/store'

export interface Workbench {
  store: Store
  audio: AudioHost
}

export const WorkbenchContext = createContext<Workbench | null>(null)

export function useWorkbench(): Workbench {
  const workbench = useContext(WorkbenchContext)
  if (!workbench) throw new Error('useWorkbench used outside the app')
  return workbench
}

export function useAppState(): AppState {
  const { store } = useWorkbench()
  const [state, setState] = useState(store.get())
  useEffect(() => store.subscribe(() => setState(store.get())), [store])
  return state
}

/** Re-renders when the audio engine's status changes — starting, held, or broken. */
export function useAudioStatus(): { status: AudioHost['status']; problem: string | null } {
  const { audio } = useWorkbench()
  const [, bump] = useState(0)
  useEffect(() => audio.subscribe(() => bump((count) => count + 1)), [audio])
  return { status: audio.status, problem: audio.problem }
}
