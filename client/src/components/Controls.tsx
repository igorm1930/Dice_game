import { Die } from './Die';

interface ControlsProps {
  readonly dieValue: number | null;
  /** The spec hides the die once someone has won. */
  readonly showDie: boolean;
  /** ROLL/HOLD are disabled when the game is over or a request is in flight. */
  readonly canAct: boolean;
  readonly busy: boolean;
  /** Free-text target for the next match; the server validates it. */
  readonly targetInput: string;
  readonly targetPlaceholder: number;
  readonly onTargetInputChange: (value: string) => void;
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
 * The global centre column: NEW GAME (with the next match's target) on top,
 * the die in the middle, ROLL DICE and HOLD below. Only dispatches callbacks —
 * it holds no game logic at all.
 */
export function Controls({
  dieValue,
  showDie,
  canAct,
  busy,
  targetInput,
  targetPlaceholder,
  onTargetInputChange,
  onNewGame,
  onRoll,
  onHold,
}: ControlsProps) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between py-8 sm:py-10">
      <div className="flex flex-col items-center gap-2">
        <PillButton label="🔄 New game" onClick={onNewGame} disabled={busy} />
        <label className="pointer-events-auto flex items-center gap-2 rounded-full bg-white/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-slate-700 shadow backdrop-blur">
          Play to
          <input
            type="number"
            inputMode="numeric"
            min={2}
            max={1000}
            value={targetInput}
            placeholder={String(targetPlaceholder)}
            onChange={(event) => onTargetInputChange(event.target.value)}
            className="w-16 rounded-md bg-white/90 px-2 py-0.5 text-center text-sm font-bold text-slate-800 outline-none ring-cyan-500 focus:ring-2"
            aria-label="Target score for the next game"
          />
        </label>
      </div>

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
