import type { Player } from '../api';

interface PlayerBoardProps {
  /** 0-based seat index straight from the server. */
  readonly seat: 0 | 1;
  readonly player: Player;
  readonly totalScore: number;
  /** The server's currentTurnScore — only shown for the active player. */
  readonly currentTurnScore: number;
  readonly isActive: boolean;
  readonly isWinner: boolean;
  readonly gameOver: boolean;
  /** True when this seat's credential is held on this page. */
  readonly isSignedIn: boolean;
}

/**
 * One half of the split card. Pure presentation: every number and every state
 * flag on screen is a server value passed down unchanged.
 */
export function PlayerBoard({
  seat,
  player,
  totalScore,
  currentTurnScore,
  isActive,
  isWinner,
  gameOver,
  isSignedIn,
}: PlayerBoardProps) {
  // Off-white left panel, darker pastel blue right panel; a winner turns gray.
  const surface = isWinner
    ? 'bg-gray-400 text-white'
    : seat === 0
      ? 'bg-slate-50/95'
      : 'bg-sky-200/90';

  const emphasis = isActive && !gameOver ? 'font-bold' : 'font-medium';

  return (
    <section
      className={`flex min-h-[30rem] flex-col items-center gap-6 px-4 pb-48 pt-12 transition-colors duration-500 sm:min-h-[34rem] sm:gap-8 sm:px-6 sm:pb-14 sm:pt-16 ${surface}`}
      aria-label={`Player ${String(seat + 1)}: ${player.username}`}
    >
      <h2 className={`text-xl uppercase tracking-widest sm:text-3xl ${emphasis}`}>
        {isWinner ? '🏆 Winner!' : player.username}
      </h2>

      <p className="text-[0.65rem] font-semibold uppercase tracking-widest opacity-60">
        {player.wins} {player.wins === 1 ? 'win' : 'wins'}
        {isSignedIn ? '' : ' · not signed in here'}
      </p>

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
