'use client';

import { type GameView, type Seat } from '@dice-game/contracts';
import { useEffect, useState } from 'react';

import { useSeatSessions } from '@/hooks/seat-sessions';
import { useDoubleSixPause } from '@/hooks/use-double-six-pause';
import { useGameQuery } from '@/hooks/use-game';
import { cx } from '@/lib/cx';
import { EFFECT_LABELS, narrate } from '@/lib/effect-messages';
import { SEAT_IDS, type SeatId } from '@/lib/seats';

import { DiceRow } from './dice-row';
import { PlayerCard } from './player-card';
import { SeatControls } from './seat-controls';
import { Alert } from './ui/alert';
import { Button } from './ui/button';
import { LoadingBlock } from './ui/spinner';

/**
 * The board.
 *
 * Two queries, one per seat, because the answer is viewer-relative: the players,
 * the dice and the scores are the same in both, but `availableActions` and
 * `viewerSeat` are not. The shared fields are read from whichever view is
 * available — they cannot disagree, because they come from the same document.
 *
 * Nothing on this screen is computed. The active player is `activePlayer`, the
 * winner is `winner`, the round score is `roundScore`, what just happened is
 * `effect`. There is no comparison against a die face and no arithmetic on a
 * score anywhere in this component.
 */
export function GameBoard({
  gameId,
  onLeave,
}: {
  gameId: string;
  onLeave: () => void;
}): React.JSX.Element {
  const seatA = useGameQuery(gameId, 'A');
  const seatB = useGameQuery(gameId, 'B');
  const { seats } = useSeatSessions();

  const views: Readonly<Record<SeatId, GameView | undefined>> = {
    A: seatA.data,
    B: seatB.data,
  };

  const view = views.A ?? views.B;
  const paused = useDoubleSixPause(view);
  const announcement = useAnnouncement(narrate(view) ?? '', view?.revision ?? null);

  /**
   * Why `fetchStatus` and not `isPending`.
   *
   * A TanStack query with `enabled: false` is *permanently* `status: 'pending'`
   * — it has no data and it is not going to get any. Gating the spinner on
   * `isPending` therefore spins forever the moment neither seat holds a token,
   * which is reachable on a plain refresh: the stored game id outlives the two
   * tokens, so once they have expired the page comes back to a board with
   * nothing to fetch it with. `fetchStatus === 'fetching'` is the honest
   * question — is a request actually in the air — and the signed-out case gets
   * a branch of its own that says what to do about it.
   */
  const fetching = seatA.fetchStatus === 'fetching' || seatB.fetchStatus === 'fetching';
  const restoring = seats.A.status === 'restoring' || seats.B.status === 'restoring';
  const anySeatSignedIn = seats.A.status === 'signed-in' || seats.B.status === 'signed-in';

  return (
    <section
      aria-labelledby="match-heading"
      className="flex flex-col gap-5 rounded-3xl border border-line bg-surface/60 p-5 shadow-2xl shadow-black/30 backdrop-blur sm:p-6"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="match-heading" className="text-xl font-black tracking-tight text-ink">
            {view === undefined ? 'Match' : `Game ${view.gameNumber}`}
          </h2>
          {view !== undefined && (
            <p className="mt-1 text-xs uppercase tracking-wider text-subtle">
              First to {view.winningScore} · rules {view.ruleset.id}@{view.ruleset.version} ·
              revision {view.revision}
            </p>
          )}
        </div>

        <Button variant="quiet" onClick={onLeave}>
          Leave this match
        </Button>
      </header>

      {/* ------------------------------------------------------------------ *
       * What just happened.
       *
       * A polite live region, so a screen-reader user is told about a bust
       * rather than having to go looking for the dice. The sentence is built
       * from `effect`, `activePlayer` and `winner` — see effect-messages.ts.
       *
       * The element is always here and it always starts empty; the sentence is
       * written into it afterwards, by `useAnnouncement`. See that hook for why
       * both halves of that matter.
       * ------------------------------------------------------------------ */}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="min-h-6 text-sm font-medium text-ink"
      >
        {announcement}
      </p>

      {view === undefined && (restoring || fetching) && <LoadingBlock label="Loading the board…" />}

      {view === undefined && !restoring && !fetching && !anySeatSignedIn && (
        <Alert tone="info">
          Both seats are signed out, so there is no token to load this match with. Sign in above to
          bring the board back, or leave the match to start a new one.
        </Alert>
      )}

      {view === undefined && !restoring && !fetching && anySeatSignedIn && (
        <Alert tone="error">
          Neither seat could load this match. The details are on each seat’s controls below.
        </Alert>
      )}

      {view !== undefined && (
        <>
          {view.status === 'COMPLETED' && view.winner !== null && (
            <p
              className="rounded-2xl border border-gold/60 bg-gold/10 px-4 py-3 text-center text-lg font-black text-gold"
              data-testid="winner-banner"
            >
              {/* Decoration. Announced, it is "trophy" in the middle of a
                  sentence that already says who won. */}
              <span aria-hidden="true">🏆 </span>
              {view.players[view.winner].displayName} wins game {view.gameNumber}
            </p>
          )}

          <div className="grid items-start gap-4 lg:grid-cols-[1fr_minmax(16rem,20rem)_1fr]">
            <PlayerCardSlot chair={0} view={view} views={views} />

            <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-canvas/40 p-5">
              <DiceRow
                dice={view.lastDice}
                tumbling={paused}
                bust={view.effect === 'DOUBLE_SIX' && paused}
              />

              <div className="flex flex-col items-center gap-1">
                <p className="text-[11px] uppercase tracking-[0.2em] text-subtle">Round score</p>
                <p className="text-4xl font-black tabular-nums text-ink" data-testid="round-score">
                  {view.roundScore}
                </p>
                {view.effect !== null && (
                  <span
                    className={cx(
                      'rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider',
                      view.effect === 'DOUBLE_SIX'
                        ? 'border-danger/50 bg-danger/10 text-danger'
                        : 'border-line bg-raised/60 text-subtle',
                    )}
                  >
                    {EFFECT_LABELS[view.effect]}
                  </span>
                )}
              </div>

              {/* The double-six moment. The words come from the effect the server
                sent and from `activePlayer`; the pause that keeps Roll and Hold
                disabled while this is on screen is the local timer. */}
              {view.effect === 'DOUBLE_SIX' && (
                <p
                  data-testid="double-six-callout"
                  className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-2 text-center text-sm font-semibold text-danger"
                >
                  Double six — the round score was lost. Next to roll:{' '}
                  {view.players[view.activePlayer].displayName}.
                </p>
              )}
            </div>

            <PlayerCardSlot chair={1} view={view} views={views} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {SEAT_IDS.map((seat) => (
              <SeatControls key={seat} seat={seat} gameId={gameId} paused={paused} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The narration, as the live region actually publishes it.
 *
 * Two separate defects live here, and both are about *when* the DOM changes
 * rather than about what it says.
 *
 *  1. A live region that mounts with its first sentence already inside it is
 *     silent. Screen readers announce mutations to a region that was already in
 *     the accessibility tree; content that arrived with the region is just
 *     content. So the region renders empty and the sentence is written a tick
 *     later, on every mount — which means the first message of every match is
 *     announced rather than only the second.
 *
 *  2. Two identical consecutive sentences are silent for the same reason. Only
 *     `email` is unique, so two players may share a display name, and two
 *     `HELD` sentences in a row are then byte-identical: React writes the same
 *     string, the DOM does not change, and nothing is announced. Clearing first
 *     makes the second one a real mutation, and `revision` is what tells the two
 *     apart — the same key `use-double-six-pause.ts` uses one file over.
 */
function useAnnouncement(sentence: string, revision: number | null): string {
  const [announced, setAnnounced] = useState('');

  useEffect(() => {
    setAnnounced('');

    const timer = setTimeout(() => {
      setAnnounced(sentence);
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [revision, sentence]);

  return announced;
}

/** A player card, plus which local seat — if either — is sitting in that chair. */
function PlayerCardSlot({
  chair,
  view,
  views,
}: {
  chair: Seat;
  view: GameView;
  views: Readonly<Record<SeatId, GameView | undefined>>;
}): React.JSX.Element {
  // `viewerSeat` is the server's answer to "which chair is this token in", so
  // the mapping from a browser seat to a game chair is read, never inferred.
  const occupiedBy = SEAT_IDS.find((seat) => views[seat]?.viewerSeat === chair) ?? null;

  return (
    <PlayerCard
      player={view.players[chair]}
      chair={chair}
      isActive={view.activePlayer === chair}
      isWinner={view.winner === chair}
      status={view.status}
      occupiedBy={occupiedBy}
    />
  );
}
