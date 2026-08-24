/**
 * Asking the measuring process to change something.
 *
 * The only channel through which this window makes anything happen. Everything else it does is
 * render what arrives — so this file is deliberately small, and everything it can ask for is
 * listed in one place rather than assembled from a string at the call site.
 */

import { isHosted } from './bridge';

export type ControlCommand = 'Ping' | 'GetSettings' | 'SetSetting';

/** Every setting that can be changed. The engine refuses anything not on its own list. */
export type SettingKey =
  | 'retention-days'
  | 'live-window-seconds'
  | 'auto-start'
  | 'keep-measuring'
  | 'simulation';

export interface EngineSettings {
  readonly highResolutionRetentionDays: number;
  readonly autoStartOnGameDetected: boolean;
  readonly keepMeasuringWithWindowClosed: boolean;
  readonly liveWindowSeconds: number;
  readonly simulationMode: boolean;
}

export interface ControlResponse {
  readonly id: number;
  readonly ok: boolean;
  readonly error: string | null;
  readonly settings: EngineSettings | null;
  /** Something true that is not a failure — most usefully, that a value was clamped. */
  readonly note: string | null;
  readonly build: string | null;
}

interface Pending {
  readonly resolve: (response: ControlResponse) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * How long to wait for the engine before giving up on one request.
 *
 * The shell already bounds its own connection attempt; this bounds the case where the shell
 * itself never answers. A control left pending forever is worse than one that reports a failure:
 * the user is looking at a switch that has neither moved nor refused to.
 */
const TIMEOUT_MS = 8000;

let nextId = 1;
const pending = new Map<number, Pending>();
let listening = false;

/** Wires the response listener once, lazily, so an unhosted page never touches the host object. */
function listen(): void {
  if (listening) return;

  const host = window.chrome?.webview;
  if (!host) return;

  host.addEventListener('message', (event: { data: unknown }) => {
    const response = parse(event.data);
    if (!response) return;

    const waiting = pending.get(response.id);
    if (!waiting) return;

    pending.delete(response.id);
    clearTimeout(waiting.timer);
    waiting.resolve(response);
  });

  listening = true;
}

/**
 * Validates an answer from the shell.
 *
 * The shell is ours and the boundary is still a boundary. A response missing its id would be
 * matched against nothing; one claiming success with no settings would leave the screen showing
 * whatever it showed before, as though the change had applied.
 */
function parse(data: unknown): ControlResponse | null {
  if (typeof data !== 'object' || data === null) return null;

  const message = data as Partial<ControlResponse> & { kind?: unknown };

  // Telemetry ticks arrive on the same event. They carry a kind; responses carry an id.
  if (typeof message.id !== 'number' || typeof message.ok !== 'boolean') return null;

  return {
    id: message.id,
    ok: message.ok,
    error: typeof message.error === 'string' ? message.error : null,
    settings: parseSettings(message.settings),
    note: typeof message.note === 'string' ? message.note : null,
    build: typeof message.build === 'string' ? message.build : null,
  };
}

function parseSettings(raw: unknown): EngineSettings | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const s = raw as Partial<EngineSettings>;

  // Every field or none. A partially-read settings object would put an `undefined` behind a
  // number on screen, and the screen would render it as though it were a value.
  if (
    typeof s.highResolutionRetentionDays !== 'number' ||
    typeof s.liveWindowSeconds !== 'number' ||
    typeof s.autoStartOnGameDetected !== 'boolean' ||
    typeof s.keepMeasuringWithWindowClosed !== 'boolean' ||
    typeof s.simulationMode !== 'boolean'
  ) {
    return null;
  }

  return {
    highResolutionRetentionDays: s.highResolutionRetentionDays,
    liveWindowSeconds: s.liveWindowSeconds,
    autoStartOnGameDetected: s.autoStartOnGameDetected,
    keepMeasuringWithWindowClosed: s.keepMeasuringWithWindowClosed,
    simulationMode: s.simulationMode,
  };
}

/**
 * Sends one request and waits for its answer.
 *
 * Resolves rather than rejects when the engine is unreachable: a control that cannot be changed
 * has a reason, and the screen has to show it. A rejected promise would leave the caller
 * choosing between swallowing it and rendering a stack trace.
 */
export function send(
  command: ControlCommand,
  key?: SettingKey,
  value?: string,
): Promise<ControlResponse> {
  const id = nextId++;

  const host = window.chrome?.webview;

  if (!host) {
    return Promise.resolve({
      id,
      ok: false,
      error: 'This window is not connected to a measuring process.',
      settings: null,
      note: null,
      build: null,
    });
  }

  listen();

  return new Promise<ControlResponse>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({
        id,
        ok: false,
        error: 'The measuring process did not answer.',
        settings: null,
        note: null,
        build: null,
      });
    }, TIMEOUT_MS);

    pending.set(id, { resolve, timer });

    host.postMessage({ id, command, key: key ?? null, value: value ?? null });
  });
}

/** Whether settings can be changed from here at all. */
export function canControl(): boolean {
  return isHosted();
}

/** Reads every setting from the engine. */
export function getSettings(): Promise<ControlResponse> {
  return send('GetSettings');
}

/** Changes one setting, and returns what was actually stored. */
export function setSetting(key: SettingKey, value: string): Promise<ControlResponse> {
  return send('SetSetting', key, value);
}
