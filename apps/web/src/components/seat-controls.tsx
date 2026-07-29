'use client';

import { type GameView } from '@dice-game/contracts';
import { useEffect } from 'react';

import { useSeat, useSeatSessions } from '@/hooks/seat-sessions';
import { useGameCommand, useGameQuery } from '@/hooks/use-game';
import { ApiError } from '@/lib/api-client';
import { SEAT_LABELS, type SeatId } from '@/lib/seats';

import { ErrorAlert } from './ui/alert';
import { Button } from './ui/button';
import { LoadingBlock, Spinner } from './ui/spinner';

/**
 * One seat's controls.
 *
 * **Every button's enabled state is a boolean the server sent.** `canRoll`,
 * `canHold` and `canStartNewGame` arrive in `availableActions`, scoped to the
 * token that asked, and are rendered as-is. Nothing here consults the round
 * score, the winning score, the dice, or whose turn it is to decide whether a
 * click is allowed — and it could not usefully do so, because the server refuses
 * the action either way.
 *
 * The one extra condition on Roll and Hold is `paused`, the double-six
 * animation, which is a local timer and is documented as such in
 * `use-double-six-pause.ts`.
 */
export function SeatControls({
  seat,
  gameId,
  paused,
}: {
  seat: SeatId;
  gameId: string;
  paused: boolean;
}): React.JSX.Element {
  const seatState = useSeat(seat);
  const query = useGameQuery(gameId, seat);
  const roll = useGameCommand('roll', gameId, seat);
  const hold = useGameCommand('hold', gameId, seat);
  const newGame = useGameCommand('newGame', gameId, seat);

  useExpireOnUnauthenticated(seat, query.error);

  return (
    <section
      aria-label={`${SEAT_LABELS[seat]} controls`}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface/70 p-4"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-accent">
          {SEAT_LABELS[seat]}
        </h3>
        {seatState.status === 'signed-in' && (
          <p className="truncate text-xs text-subtle">{seatState.session.user.displayName}</p>
        )}
      </header>

      {seatState.status !== 'signed-in' && (
        <p className="text-sm text-subtle">
          This seat is signed out. Sign in above to take these controls.
        </p>
      )}

      {seatState.status === 'signed-in' && query.isPending && (
        <LoadingBlock label="Loading this seat’s view…" />
      )}

      {query.error !== null && (
        <div className="flex flex-col gap-2">
          <ErrorAlert error={query.error} />
          <Button
            variant="secondary"
            onClick={() => {
              void query.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {query.data !== undefined && (
        <>
          <TurnHint view={query.data} />

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!query.data.availableActions.canRoll || paused || roll.isPending}
              onClick={() => {
                roll.run(query.data.revision);
              }}
            >
              {roll.isPending && <Spinner />}
              {roll.isPending ? 'Rolling…' : 'Roll'}
            </Button>

            <Button
              variant="secondary"
              disabled={!query.data.availableActions.canHold || paused || hold.isPending}
              onClick={() => {
                hold.run(query.data.revision);
              }}
            >
              {hold.isPending && <Spinner />}
              {hold.isPending ? 'Holding…' : 'Hold'}
            </Button>

            <Button
              variant="secondary"
              disabled={!query.data.availableActions.canStartNewGame || newGame.isPending}
              onClick={() => {
                newGame.run(query.data.revision);
              }}
            >
              {newGame.isPending && <Spinner />}
              {newGame.isPending ? 'Starting…' : 'New game'}
            </Button>
          </div>

          {roll.error !== null && <ErrorAlert error={roll.error} />}
          {hold.error !== null && <ErrorAlert error={hold.error} />}
          {newGame.error !== null && <ErrorAlert error={newGame.error} />}
        </>
      )}
    </section>
  );
}

/**
 * Whose turn it is, from this seat's point of view.
 *
 * Both halves are server fields: `viewerSeat` is the chair this token occupies,
 * `activePlayer` is the chair holding the dice. Comparing two seat indices to
 * choose a sentence is not a rule — it does not decide what anyone may do, which
 * is what `availableActions` above is for.
 */
function TurnHint({ view }: { view: GameView }): React.JSX.Element {
  if (view.viewerSeat === null) {
    return <p className="text-sm text-subtle">Watching — this seat is not seated in this match.</p>;
  }

  if (view.viewerSeat === view.activePlayer) {
    return <p className="text-sm font-semibold text-active">Your turn.</p>;
  }

  return (
    <p className="text-sm text-subtle">
      Waiting for {view.players[view.activePlayer].displayName}.
    </p>
  );
}

/**
 * A token the server has stopped honouring — expired, or revoked because its
 * user signed out — is not an error to display forever. The seat is dropped
 * locally so its panel offers a sign-in form again. No logout call is made:
 * the token is already dead.
 */
function useExpireOnUnauthenticated(seat: SeatId, error: unknown): void {
  const { expireSeat } = useSeatSessions();
  const unauthenticated = error instanceof ApiError && error.code === 'UNAUTHENTICATED';

  useEffect(() => {
    if (unauthenticated) {
      expireSeat(seat);
    }
  }, [unauthenticated, seat, expireSeat]);
}
