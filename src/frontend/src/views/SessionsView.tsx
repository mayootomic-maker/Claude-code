import { useEffect, useState, type JSX } from 'react';
import { BaselineTrend } from '../components/BaselineTrend';
import { loadBaselineHistory, type BaselineSession } from '../telemetry/baseline';
import {
  loadSessions,
  sessionStartedAt,
  type StoredSessionSummary,
} from '../telemetry/sessions';

/**
 * Recorded sessions, newest first.
 *
 * A history screen earns its place only if it supports a comparison, so every column here is one
 * a comparison needs: when, what, how long, how many stutters, and — the one most tools omit —
 * how small a stutter that session could have detected at all. Two rows both reading "0
 * stutters" mean different things when one could resolve 3 ms and the other 30 ms, and without
 * the floor a user would read the second as a clean session.
 */
export function SessionsView(): JSX.Element {
  const [sessions, setSessions] = useState<StoredSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The baseline history is loaded separately and is allowed to be missing. A machine that has
  // never built one is the normal early state, and it must not take the session list down with
  // it — the list is useful on its own.
  const [history, setHistory] = useState<readonly BaselineSession[]>([]);

  useEffect(() => {
    loadSessions()
      .then(setSessions)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

    loadBaselineHistory()
      .then(setHistory)
      .catch(() => setHistory([]));
  }, []);

  if (error) {
    return (
      <div className="sessions sessions--empty">
        <p className="t-body">Could not read the session history. {error}</p>
      </div>
    );
  }

  if (!sessions) return <div className="app__loading t-body">Reading session history…</div>;

  if (sessions.length === 0) {
    return (
      <div className="sessions sessions--empty">
        <h1 className="t-title">No sessions recorded yet</h1>
        <p className="t-body">
          A session is recorded when a capture finishes. Nothing is uploaded and nothing is kept
          anywhere but this machine.
        </p>
      </div>
    );
  }

  const excluded = sessions.filter((s) => !s.baselineEligible).length;

  return (
    <div className="sessions">
      <header className="sessions__head">
        <h1 className="t-title">Recorded sessions</h1>
        <p className="t-body sessions__lede">
          {sessions.length} session{sessions.length === 1 ? '' : 's'} on this machine.
          {/*
            States the fact, not a cause. The data carries a boolean and no reason for it, and
            the previous copy asserted "a measurement problem" for every excluded session —
            including one with no stutters, 12,964 frames and a 3.5 ms floor, which plainly had
            none. Inventing the reason for a flag is the same failure as inventing a diagnosis.
          */}
          {excluded > 0 ? (
            <>
              {' '}
              {excluded} cannot seed a baseline. A session is excluded when something about how it
              was measured would make it a poor reference — a dropped frame, a degraded source, or
              a capture that was simulated rather than measured.
            </>
          ) : null}
        </p>
      </header>

      <BaselineTrend history={history} />

      <div className="sessions__table-wrap">
        <table className="sessions__table">
          <thead>
            <tr className="t-label">
              <th scope="col">Started</th>
              <th scope="col">Game</th>
              <th scope="col" className="num">
                Duration
              </th>
              <th scope="col" className="num">
                Frames
              </th>
              <th scope="col" className="num">
                Stutters
              </th>
              <th scope="col" className="num">
                Smallest detectable
              </th>
              <th scope="col">Baseline</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * One session.
 *
 * Not interactive, and deliberately not styled as though it were. Opening a stored session needs
 * a reader for the segment files, which is not built; a row that highlights on hover and does
 * nothing when clicked is a dead end with an affordance on it.
 */
function SessionRow({ session }: { readonly session: StoredSessionSummary }): JSX.Element {
  const started = sessionStartedAt(session);
  const minutes = session.durationMs / 60_000;

  return (
    <tr>
      <td className="t-mono-sm">
        {started.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
        {started.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </td>

      <th scope="row" className="t-body sessions__game">
        {session.game}
        {/*
          A session that never finalized is marked rather than hidden. Its numbers are real up to
          the point it stopped, and a user looking for a session they remember running needs to
          find it and be told why it looks short.
        */}
        {session.state !== 'Finalized' ? (
          <span className="sessions__state t-mono-sm">{session.state.toLowerCase()}</span>
        ) : null}
      </th>

      <td className="t-mono-sm num">
        {minutes >= 1 ? `${minutes.toFixed(1)} min` : `${(session.durationMs / 1000).toFixed(0)} s`}
      </td>

      <td className="t-mono-sm num">{session.frameCount.toLocaleString()}</td>

      <td className="t-mono-sm num" data-clean={session.stutterCount === 0 || undefined}>
        {session.stutterCount}
      </td>

      <td className="t-mono-sm num sessions__floor">
        {/*
          Never rendered as zero when unknown. A floor of 0 ms would read as a session that could
          detect anything, which is the most flattering possible misreading.
        */}
        {session.sensitivityFloorMs !== null
          ? `${session.sensitivityFloorMs.toFixed(1)} ms`
          : 'unknown'}
      </td>

      <td>
        {session.baselineEligible ? (
          <span className="t-body-sm sessions__eligible">eligible</span>
        ) : (
          <span
            className="t-body-sm sessions__excluded"
            title="This session will not be used as a reference for detecting regressions"
          >
            excluded
          </span>
        )}
      </td>
    </tr>
  );
}
