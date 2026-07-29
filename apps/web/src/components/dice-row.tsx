import { type DicePair } from '@dice-game/contracts';

import { cx } from '@/lib/cx';

/**
 * The pair of dice, exactly as the server last threw them.
 *
 * **This file contains no rule.** `PIP_LAYOUT` is a rendering table — which of
 * the nine cells in a die's grid are filled for a given face — and nothing reads
 * a face to decide anything. That a throw was a double six is `effect` arriving
 * from the API, never a comparison performed here.
 */
const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

const PIP_LAYOUT: Readonly<Record<number, readonly number[]>> = Object.freeze({
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
});

function Die({
  face,
  tumbling,
  bust,
}: {
  face: number | null;
  tumbling: boolean;
  bust: boolean;
}): React.JSX.Element {
  const pips = face === null ? [] : (PIP_LAYOUT[face] ?? []);

  return (
    <span
      role="img"
      aria-label={face === null ? 'No die thrown yet' : `Die showing ${face}`}
      className={cx(
        'grid size-16 grid-cols-3 grid-rows-3 gap-1 rounded-2xl border p-2.5 sm:size-20',
        face === null
          ? 'border-dashed border-line bg-canvas/40'
          : 'border-line bg-gradient-to-br from-white to-slate-300 shadow-lg shadow-black/40',
        tumbling && 'die-tumbling',
        bust && 'bust-flashing',
      )}
    >
      {CELLS.map((cell) => (
        <span
          key={cell}
          aria-hidden="true"
          className={cx(
            'block size-full rounded-full',
            pips.includes(cell) ? 'bg-slate-900' : 'bg-transparent',
          )}
        />
      ))}
    </span>
  );
}

export function DiceRow({
  dice,
  tumbling,
  bust,
}: {
  dice: DicePair | null;
  tumbling: boolean;
  bust: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-center gap-3">
      <Die face={dice === null ? null : dice[0]} tumbling={tumbling} bust={bust} />
      <Die face={dice === null ? null : dice[1]} tumbling={tumbling} bust={bust} />
    </div>
  );
}
