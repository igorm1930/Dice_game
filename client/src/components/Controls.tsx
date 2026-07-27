import { Die } from './Die';

interface ControlsProps {
  readonly dieValue: number | null;
  /** The spec hides the die once someone has won. */
  readonly showDie: boolean;
  /** ROLL/HOLD are disabled when the game is over or a request is in flight. */
  readonly canAct: boolean;
  readonly busy: boolean;
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
 * The global centre column: NEW GAME on top, the die in the middle, ROLL DICE
 * and HOLD below. Only dispatches callbacks — it holds no game logic at all.
 */
export function Controls({
  dieValue,
  showDie,
  canAct,
  busy,
  onNewGame,
  onRoll,
  onHold,
}: ControlsProps) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between py-8 sm:py-10">
      <PillButton label="🔄 New game" onClick={onNewGame} disabled={busy} />

      <div className="flex flex-col items-center gap-2">
        {showDie ? <Die value={dieValue} /> : <div className="h-20 sm:h-24" aria-hidden="true" />}
      </div>

      <div className="flex flex-col items-center gap-3">
        <PillButton label="🎲 Roll dice" onClick={onRoll} disabled={!canAct} />
        <PillButton label="📥 Hold" onClick={onHold} disabled={!canAct} />
      </div>
    </div>
  );
}
