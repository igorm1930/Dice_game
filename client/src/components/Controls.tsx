import { Dice } from './Dice';

interface ControlsProps {
  /** Both faces of the last throw, straight from the server. */
  readonly roll: readonly [number, number] | null;
  /** The server's verdict on that throw. */
  readonly busted: boolean;
  /** The die pair is hidden once someone has won. */
  readonly showDice: boolean;
  /** ROLL/HOLD are enabled only when the server says this seat may act. */
  readonly canAct: boolean;
  readonly busy: boolean;
  /** Why the buttons are disabled, when they are. Server-derived, not invented. */
  readonly hint: string | null;
  readonly onNewGame: () => void;
  readonly onRoll: () => void;
  readonly onHold: () => void;
}

function PillButton({
  label,
  onClick,
  disabled,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="pointer-events-auto w-44 rounded-full bg-white/90 px-8 py-2.5 text-sm font-semibold uppercase tracking-widest text-slate-800 shadow-lg backdrop-blur transition hover:bg-white hover:shadow-xl active:scale-95 disabled:pointer-events-none disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/**
 * The centre column: NEW GAME on top, the two dice in the middle, ROLL DICE and
 * HOLD below. Only dispatches callbacks — it holds no game logic at all.
 */
export function Controls({
  roll,
  busted,
  showDice,
  canAct,
  busy,
  hint,
  onNewGame,
  onRoll,
  onHold,
}: ControlsProps) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between py-8 sm:py-10">
      <PillButton label="🔄 New game" onClick={onNewGame} disabled={busy} />

      <div className="flex flex-col items-center gap-3">
        {showDice ? (
          <Dice roll={roll} busted={busted} />
        ) : (
          <div className="h-16 sm:h-20" aria-hidden="true" />
        )}
        {busted && showDice && (
          <p
            role="status"
            className="animate-pulse rounded-full bg-red-600 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-white shadow-lg"
          >
            💥 Double six — round lost
          </p>
        )}
      </div>

      <div className="flex flex-col items-center gap-3">
        <PillButton label="🎲 Roll dice" onClick={onRoll} disabled={!canAct} />
        <PillButton label="📥 Hold" onClick={onHold} disabled={!canAct} />
        {hint && (
          <p className="pointer-events-none max-w-xs text-center text-xs font-medium text-slate-700/80">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
