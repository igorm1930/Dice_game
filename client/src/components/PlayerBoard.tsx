interface PlayerBoardProps {
  /** 0-based player index straight from the server. */
  readonly index: 0 | 1;
  readonly totalScore: number;
  /** The server's currentTurnScore — only shown for the active player. */
  readonly currentTurnScore: number;
  readonly isActive: boolean;
  readonly isWinner: boolean;
  readonly gameOver: boolean;
}

/**
 * One half of the split card. Pure presentation: every number and every state
 * flag on screen is a server value passed down unchanged.
 */
export function PlayerBoard({
  index,
  totalScore,
  currentTurnScore,
  isActive,
  isWinner,
  gameOver,
}: PlayerBoardProps) {
  // Off-white left panel, darker pastel blue right panel; a winner turns gray.
  const surface = isWinner
    ? 'bg-gray-400 text-white'
    : index === 0
      ? 'bg-slate-50/95'
      : 'bg-sky-200/90';

  const emphasis = isActive && !gameOver ? 'font-bold' : 'font-medium';

  return (
    <section
      className={`flex min-h-[30rem] flex-col items-center gap-8 px-4 pb-48 pt-12 transition-colors duration-500 sm:min-h-[34rem] sm:gap-10 sm:px-6 sm:pb-14 sm:pt-16 ${surface}`}
      aria-label={`Player ${String(index + 1)}`}
    >
      <h2 className={`text-2xl uppercase tracking-widest sm:text-4xl ${emphasis}`}>
        {isWinner ? 'Winner!' : `Player ${String(index + 1)}`}
      </h2>

      {isActive && !gameOver && (
        <span className="rounded-full bg-cyan-600 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-white shadow">
          Playing
        </span>
      )}

      <p
        className={`text-5xl tabular-nums sm:text-7xl ${isWinner ? 'text-white' : 'text-cyan-700'} font-light`}
      >
        {totalScore}
      </p>

      <div className="mt-auto w-full max-w-[11rem] rounded-2xl bg-cyan-600/90 px-4 py-4 text-center text-white shadow-lg">
        <p className="text-xs uppercase tracking-widest opacity-80">Current</p>
        <p className="mt-1 text-3xl tabular-nums">{isActive && !gameOver ? currentTurnScore : 0}</p>
      </div>
    </section>
  );
}
