/**
 * The pair of dice, drawn from server state.
 *
 * Rendered with CSS pips rather than image assets so the client ships zero
 * binary files and the strict CSP (img-src 'self' data:) needs no widening.
 * The values come from the backend's `lastRoll` — the client never invents,
 * re-rolls, or re-interprets them.
 */
const PIP_CELLS: Record<1 | 2 | 3 | 4 | 5 | 6, readonly number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 3, 6, 2, 5, 8],
};

function Die({ value, busted }: { readonly value: number; readonly busted: boolean }) {
  const pips = PIP_CELLS[value as 1 | 2 | 3 | 4 | 5 | 6] ?? [];

  return (
    <div
      role="img"
      aria-label={`Die showing ${String(value)}`}
      className={`grid h-16 w-16 grid-cols-3 grid-rows-3 place-items-center rounded-2xl p-2 shadow-xl transition-colors duration-300 sm:h-20 sm:w-20 sm:p-2.5 ${
        busted ? 'bg-red-500' : 'bg-white'
      }`}
    >
      {Array.from({ length: 9 }, (_, cell) => (
        <span
          key={cell}
          className={
            pips.includes(cell)
              ? `h-2.5 w-2.5 rounded-full sm:h-3 sm:w-3 ${busted ? 'bg-white' : 'bg-slate-800'}`
              : 'h-2.5 w-2.5 sm:h-3 sm:w-3'
          }
        />
      ))}
    </div>
  );
}

interface DiceProps {
  /** Both faces of the last throw, straight from the server. */
  readonly roll: readonly [number, number] | null;
  /** The server's verdict on that throw — not recomputed here. */
  readonly busted: boolean;
}

export function Dice({ roll, busted }: DiceProps) {
  if (roll === null) {
    return (
      <div className="flex gap-3" aria-label="No roll yet">
        <div className="h-16 w-16 rounded-2xl border-4 border-dashed border-white/70 sm:h-20 sm:w-20" />
        <div className="h-16 w-16 rounded-2xl border-4 border-dashed border-white/70 sm:h-20 sm:w-20" />
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <Die value={roll[0]} busted={busted} />
      <Die value={roll[1]} busted={busted} />
    </div>
  );
}
