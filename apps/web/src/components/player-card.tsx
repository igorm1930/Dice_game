import { type GameStatus, type PlayerView, type Seat } from '@dice-game/contracts';

import { cx } from '@/lib/cx';
import { SEAT_LABELS, type SeatId } from '@/lib/seats';

/**
 * One of the two players, as the server describes them.
 *
 * Everything on this card is a field: `displayName`, `globalScore`, `winCount`.
 * There is no progress bar towards the winning score, because drawing one would
 * mean dividing a score by the target — arithmetic on scores, in the client, to
 * imply how close somebody is to winning. Who has won is `winner`, and it
 * arrives when it arrives.
 *
 * `isActive` and `isWinner` are passed in already decided by the board from
 * `activePlayer` and `winner`; this component compares nothing.
 */
export const CHAIR_LABELS: Readonly<Record<Seat, string>> = Object.freeze({
  0: 'First chair',
  1: 'Second chair',
});

export function PlayerCard({
  player,
  chair,
  isActive,
  isWinner,
  status,
  occupiedBy,
}: {
  player: PlayerView;
  chair: Seat;
  isActive: boolean;
  isWinner: boolean;
  status: GameStatus;
  occupiedBy: SeatId | null;
}): React.JSX.Element {
  const live = isActive && status === 'ACTIVE';

  return (
    <article
      aria-label={`${player.displayName}, ${CHAIR_LABELS[chair]}`}
      className={cx(
        'relative flex flex-col gap-3 rounded-2xl border p-5 transition',
        isWinner
          ? 'border-gold bg-gold/10 shadow-lg shadow-gold/10'
          : live
            ? 'border-active bg-active/5 shadow-lg shadow-active/10'
            : 'border-line bg-surface/70',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-ink">{player.displayName}</p>
          <p className="text-[11px] uppercase tracking-wider text-subtle">
            {CHAIR_LABELS[chair]}
            {occupiedBy !== null && ` · ${SEAT_LABELS[occupiedBy]}`}
          </p>
        </div>

        {/* The active-player indicator. Not colour alone: it carries a word, so
            it survives a colour-blind reader and a screen reader alike. */}
        {live && (
          <span className="shrink-0 rounded-full border border-active/50 bg-active/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-active">
            Their turn
          </span>
        )}

        {isWinner && (
          <span className="shrink-0 rounded-full border border-gold/60 bg-gold/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-gold">
            Winner
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line/70 bg-canvas/40 p-3">
          <dt className="text-[11px] uppercase tracking-wider text-subtle">Score</dt>
          <dd className="mt-0.5 text-3xl font-black tabular-nums text-ink">{player.globalScore}</dd>
        </div>

        <div className="rounded-xl border border-line/70 bg-canvas/40 p-3">
          <dt className="text-[11px] uppercase tracking-wider text-subtle">Games won</dt>
          <dd className="mt-0.5 text-3xl font-black tabular-nums text-ink">{player.winCount}</dd>
        </div>
      </dl>
    </article>
  );
}
