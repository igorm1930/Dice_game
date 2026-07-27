import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, describeError, fetchState, hold, newGame, roll, type PigGameState } from './api';
import { Controls } from './components/Controls';
import { PlayerBoard } from './components/PlayerBoard';

/**
 * The Pig Game shell.
 *
 * Deliberately "dumb": state arrives from the API, actions go to the API, and
 * a light poll keeps other tabs' moves visible — open the page twice and both
 * windows play the same server-owned match. No score maths happens here.
 */
export default function App() {
  const [game, setGame] = useState<PigGameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Free text on purpose: the server is the validator; the UI only relays.
  const [targetInput, setTargetInput] = useState('');

  // Monotonic action counter. A poll that started before an action must not
  // overwrite the action's fresher result, so each sync records the epoch it
  // began under and discards its response if an action completed in between.
  const actionEpoch = useRef(0);

  const sync = useCallback(async () => {
    const epochAtStart = actionEpoch.current;
    try {
      const state = await fetchState();
      if (actionEpoch.current === epochAtStart) {
        setGame(state);
        setError(null);
      }
    } catch (cause) {
      if (actionEpoch.current === epochAtStart) {
        setError(describeError(cause));
      }
    }
  }, []);

  useEffect(() => {
    void sync();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void sync();
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [sync]);

  const dispatch = useCallback(
    async (action: () => Promise<PigGameState>) => {
      setBusy(true);
      try {
        const state = await action();
        actionEpoch.current += 1;
        setGame(state);
        setError(null);
      } catch (cause) {
        actionEpoch.current += 1;
        if (cause instanceof ApiError && cause.status === 409) {
          // Our view was stale (e.g. another tab already won) — the server is
          // the source of truth, so re-render its truth instead of erroring.
          await sync();
        } else {
          setError(describeError(cause));
        }
      } finally {
        setBusy(false);
      }
    },
    [sync],
  );

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gradient-to-br from-sky-200 via-cyan-300 to-cyan-500 p-4">
      {game ? (
        <>
          <div className="relative grid w-full max-w-4xl grid-cols-2 overflow-hidden rounded-3xl shadow-2xl">
            <PlayerBoard
              index={0}
              totalScore={game.totalScores[0]}
              currentTurnScore={game.currentTurnScore}
              isActive={game.activePlayer === 0}
              isWinner={game.winner === 0}
              gameOver={!game.isPlaying}
            />
            <PlayerBoard
              index={1}
              totalScore={game.totalScores[1]}
              currentTurnScore={game.currentTurnScore}
              isActive={game.activePlayer === 1}
              isWinner={game.winner === 1}
              gameOver={!game.isPlaying}
            />
            <Controls
              dieValue={game.lastRoll}
              showDie={game.isPlaying}
              canAct={game.isPlaying && !busy}
              busy={busy}
              targetInput={targetInput}
              targetPlaceholder={game.targetScore}
              onTargetInputChange={setTargetInput}
              onNewGame={() => {
                const parsed = Number.parseInt(targetInput, 10);
                void dispatch(() => newGame(Number.isNaN(parsed) ? undefined : parsed));
              }}
              onRoll={() => void dispatch(roll)}
              onHold={() => void dispatch(hold)}
            />
          </div>
          <p className="text-sm font-medium text-cyan-900/70">
            First to {game.targetScore} wins · rolling a 6 loses the turn
          </p>
        </>
      ) : (
        <p className="text-lg font-medium text-cyan-950/80">
          {error ?? 'Loading the game from the server…'}
        </p>
      )}

      {game && error && (
        <p
          role="alert"
          className="max-w-xl rounded-xl bg-red-600/90 px-4 py-2 text-center text-sm text-white shadow-lg"
        >
          {error}
        </p>
      )}
    </main>
  );
}
