/**
 * A die face drawn from server state.
 *
 * Rendered with CSS pips rather than image assets so the client ships zero
 * binary files and the strict CSP (img-src 'self' data:) needs no widening.
 * The value comes from the backend's `lastRoll` — the client never invents it.
 */
const PIP_CELLS: Record<1 | 2 | 3 | 4 | 5 | 6, readonly number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 3, 6, 2, 5, 8],
};

interface DieProps {
  readonly value: number | null;
}

export function Die({ value }: DieProps) {
  if (value === null || value < 1 || value > 6) {
    return (
      <div
        className="h-20 w-20 rounded-2xl border-4 border-dashed border-white/70 sm:h-24 sm:w-24"
        aria-label="No roll yet"
      />
    );
  }

  const pips = PIP_CELLS[value as 1 | 2 | 3 | 4 | 5 | 6];

  return (
    <div
      role="img"
      aria-label={`Die showing ${String(value)}`}
      className="grid h-20 w-20 grid-cols-3 grid-rows-3 place-items-center rounded-2xl bg-white p-2.5 shadow-xl sm:h-24 sm:w-24"
    >
      {Array.from({ length: 9 }, (_, cell) => (
        <span
          key={cell}
          className={
            pips.includes(cell) ? 'h-3 w-3 rounded-full bg-slate-800 sm:h-3.5 sm:w-3.5' : 'h-3 w-3'
          }
        />
      ))}
    </div>
  );
}
