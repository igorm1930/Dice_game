import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  describeError,
  fetchState,
  hold,
  login,
  logout,
  me,
  newGame,
  register,
  roll,
  type PigGameState,
  type Session,
} from './api';
import { AuthPanel } from './components/AuthPanel';
import { Controls } from './components/Controls';
import { PlayerBoard } from './components/PlayerBoard';
import { EMPTY_SESSIONS, loadSessions, saveSessions, type SeatSessions } from './sessions';

/** How long the board stays frozen on a double six so the message can be read. */
const BUST_PAUSE_MS = 1500;

/**
 * The Pig Game shell.
 *
 * Deliberately "dumb": state arrives from the API, actions go to the API, and a
 * light poll keeps the other seat's moves visible. No score maths, no turn
 * logic, and no rule decisions happen here — not even "was that a bust", which
 * arrives from the server as `bustedOnLastRoll`.
 *
 * Both players are simulated on the same page, as the brief asks: two
 * independent sign-in cards, two independent tokens, and every action sent with
 * the token of the seat it belongs to.
 */
export default function App() {
  const [sessions, setSessions] = useState<SeatSessions>(EMPTY_SESSIONS);
  const [game, setGame] = useState<PigGameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bustPause, setBustPause] = useState(false);
  // Free text on purpose: the server is the validator; the UI only relays.
  const [targetInput, setTargetInput] = useState('');

  // Monotonic action counter. A poll that started before an action must not
  // overwrite the action's fresher result, so each sync records the epoch it
  // began under and discards its response if an action completed in between.
  const actionEpoch = useRef(0);

  const updateSessions = useCallback((next: SeatSessions) => {
    setSessions(next);
    saveSessions(next);
  }, []);

  // Restore stored credentials, discarding any the server no longer honours.
  useEffect(() => {
    const stored = loadSessions();
    if (stored[0] === null && stored[1] === null) {
      return;
    }

    void Promise.all(
      stored.map(async (session) => {
        if (!session) {
          return null;
        }
        try {
          return { token: session.token, player: await me(session.token) };
        } catch {
          return null;
        }
      }),
    ).then(([first, second]) => {
      updateSessions([first ?? null, second ?? null]);
    });
  }, [updateSessions]);

  /** Any credential will do to *read* the shared table. */
  const readToken = sessions[0]?.token ?? sessions[1]?.token ?? null;

  const sync = useCallback(async () => {
    if (readToken === null) {
      return;
    }

    const epochAtStart = actionEpoch.current;
    try {
      const state = await fetchState(readToken);
      if (actionEpoch.current === epochAtStart) {
        setGame(state);
        setError(null);
      }
    } catch (cause) {
      if (actionEpoch.current !== epochAtStart) {
        return;
      }
      if (cause instanceof ApiError && cause.code === 'PIG_GAME_NOT_FOUND') {
        // Nobody has started a match yet — that is a lobby, not an error.
        setGame(null);
        setError(null);
      } else {
        setError(describeError(cause));
      }
    }
  }, [readToken]);

  useEffect(() => {
    void sync();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void sync();
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [sync]);

  // Freeze the controls briefly after a double six so the message is readable
  // (Extra #4). Purely cosmetic — the server has already applied the bust.
  useEffect(() => {
    if (!game?.bustedOnLastRoll) {
      setBustPause(false);
      return;
    }

    setBustPause(true);
    const timer = window.setTimeout(() => setBustPause(false), BUST_PAUSE_MS);
    return () => window.clearTimeout(timer);
    // activePlayer is in the deps so back-to-back busts by the two players each
    // get their own pause rather than sharing the first one's timer.
  }, [game?.bustedOnLastRoll, game?.activePlayer]);

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
        if (cause instanceof ApiError && (cause.status === 409 || cause.status === 403)) {
          // Our view was stale (the other seat already moved, or won) — the
          // server is the source of truth, so re-render its truth.
          setError(describeError(cause));
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

  const authenticateSeat = useCallback(
    async (seat: 0 | 1, mode: 'login' | 'register', username: string, password: string) => {
      try {
        const session = await (mode === 'register' ? register : login)(username, password);
        const next: SeatSessions = seat === 0 ? [session, sessions[1]] : [sessions[0], session];
        updateSessions(next);
        setError(null);
      } catch (cause) {
        setError(describeError(cause));
      }
    },
    [sessions, updateSessions],
  );

  const signOutSeat = useCallback(
    (seat: 0 | 1) => {
      const session = sessions[seat];
      if (session) {
        void logout(session.token).catch(() => undefined);
      }
      updateSessions(seat === 0 ? [null, sessions[1]] : [sessions[0], null]);
    },
    [sessions, updateSessions],
  );

  /** The local credential for whichever seat the server says is active. */
  const activeSession: Session | null =
    game === null
      ? null
      : (sessions.find((session) => session?.player.id === game.players[game.activePlayer].id) ??
        null);

  const bothSignedIn = sessions[0] !== null && sessions[1] !== null;

  const startGame = () => {
    const creator = sessions[0];
    const opponent = sessions[1];
    if (!creator || !opponent) {
      setError('Both players must sign in before a game can start.');
      return;
    }

    const parsed = Number.parseInt(targetInput, 10);
    void dispatch(() =>
      newGame(creator.token, opponent.player.username, Number.isNaN(parsed) ? undefined : parsed),
    );
  };

  const canAct = game !== null && game.isPlaying && activeSession !== null && !busy && !bustPause;

  const hint =
    game === null || !game.isPlaying
      ? null
      : activeSession === null
        ? `Sign in as ${game.players[game.activePlayer].username} to take this turn.`
        : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-br from-sky-200 via-cyan-300 to-cyan-500 p-4">
      {game ? (
        <>
          <div className="relative grid w-full max-w-4xl grid-cols-2 overflow-hidden rounded-3xl shadow-2xl">
            {([0, 1] as const).map((seat) => (
              <PlayerBoard
                key={seat}
                seat={seat}
                player={game.players[seat]}
                totalScore={game.totalScores[seat]}
                currentTurnScore={game.currentTurnScore}
                isActive={game.activePlayer === seat}
                isWinner={game.winner === seat}
                gameOver={!game.isPlaying}
                isSignedIn={sessions.some((s) => s?.player.id === game.players[seat].id)}
              />
            ))}
            <Controls
              roll={game.lastRoll}
              busted={game.bustedOnLastRoll}
              showDice={game.isPlaying}
              canAct={canAct}
              busy={busy}
              hint={hint}
              onNewGame={startGame}
              onRoll={() => {
                if (activeSession) {
                  void dispatch(() => roll(activeSession.token));
                }
              }}
              onHold={() => {
                if (activeSession) {
                  void dispatch(() => hold(activeSession.token));
                }
              }}
            />
          </div>
          <p className="text-sm font-medium text-cyan-900/70">
            First to {game.targetScore} wins · rolling 6 &amp; 6 loses the round score
          </p>
        </>
      ) : (
        <div className="flex max-w-2xl flex-col items-center gap-3 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-cyan-950">🎲 Pig</h1>
          <p className="text-sm font-medium text-cyan-950/70">
            Two players, two dice. Roll to build a round score, hold to bank it — but 6 &amp; 6
            wipes the round and passes the turn. Both players sign in below.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-center gap-4">
        {([0, 1] as const).map((seat) => (
          <AuthPanel
            key={seat}
            seat={seat}
            session={sessions[seat]}
            onAuthenticate={(mode, username, password) =>
              authenticateSeat(seat, mode, username, password)
            }
            onSignOut={() => signOutSeat(seat)}
            disabled={busy}
          />
        ))}
      </div>

      {game === null && (
        <div className="flex flex-col items-center gap-3">
          <label className="flex items-center gap-2 rounded-full bg-white/80 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-slate-700 shadow backdrop-blur">
            Play to
            <input
              type="number"
              inputMode="numeric"
              min={2}
              max={1000}
              value={targetInput}
              placeholder="100"
              onChange={(event) => setTargetInput(event.target.value)}
              className="w-16 rounded-md bg-white px-2 py-0.5 text-center text-sm font-bold text-slate-800 outline-none ring-cyan-500 focus:ring-2"
              aria-label="Winning score for the new game"
            />
          </label>
          <button
            type="button"
            onClick={startGame}
            disabled={!bothSignedIn || busy}
            className="rounded-full bg-white/90 px-8 py-2.5 text-sm font-semibold uppercase tracking-widest text-slate-800 shadow-lg transition hover:bg-white disabled:opacity-40"
          >
            🔄 New game
          </button>
          {!bothSignedIn && (
            <p className="text-xs font-medium text-cyan-950/70">
              Both seats need a signed-in player before a game can start.
            </p>
          )}
        </div>
      )}

      {error && (
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
