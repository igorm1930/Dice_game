'use client';

import { type GameView } from '@dice-game/contracts';
import { type RefObject, useEffect, useRef } from 'react';

import { useSeat, useSeatSessions } from '@/hooks/seat-sessions';
import { type GameCommand, useGameCommand, useGameQuery } from '@/hooks/use-game';
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
 *
 * The view is read only while this seat is *signed in*. A cache entry outlives
 * the `enabled: false` that signing out produces, so without that gate a
 * signed-out panel carries on rendering the departed player's buttons.
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

  const signedIn = seatState.status === 'signed-in';
  const view = signedIn ? query.data : undefined;

  const sectionRef = useRef<HTMLElement>(null);
  const acting = roll.isPending || hold.isPending || newGame.isPending;
  const rememberAction = useReturnFocusAfterActing(sectionRef, acting);

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
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

      {!signedIn && (
        <p className="text-sm text-subtle">
          This seat is signed out. Sign in above to take these controls.
        </p>
      )}

      {signedIn && query.isPending && <LoadingBlock label="Loading this seat’s view…" />}

      {signedIn && query.error !== null && (
        <div className="flex flex-col gap-2">
          <ErrorAlert error={query.error} />
          <Button
            variant="secondary"
            aria-label={`Try again, ${SEAT_LABELS[seat]}`}
            onClick={() => {
              void query.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {view !== undefined && (
        <>
          <TurnHint view={view} />

          <div className="flex flex-wrap gap-2">
            <CommandButton
              seat={seat}
              command={roll}
              revision={view.revision}
              allowed={view.availableActions.canRoll}
              blocked={paused}
              idle="Roll"
              busy="Rolling…"
              onAct={rememberAction}
            />

            <CommandButton
              variant="secondary"
              seat={seat}
              command={hold}
              revision={view.revision}
              allowed={view.availableActions.canHold}
              blocked={paused}
              idle="Hold"
              busy="Holding…"
              onAct={rememberAction}
            />

            <CommandButton
              variant="secondary"
              seat={seat}
              command={newGame}
              revision={view.revision}
              allowed={view.availableActions.canStartNewGame}
              blocked={false}
              idle="New game"
              busy="Starting…"
              onAct={rememberAction}
            />
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
 * One command button.
 *
 * Two kinds of "unavailable" meet here, and they are not the same thing:
 *
 *  - `allowed` is the server's answer and `blocked` is the double-six timer.
 *    Both are a real `disabled` attribute, so assistive technology announces the
 *    control as unavailable rather than the player discovering that nothing
 *    happens.
 *  - "a request is in flight" is `aria-disabled` instead. A `disabled` element
 *    cannot hold focus, so disabling the button the player had just pressed threw
 *    a keyboard user back to the top of the document on every turn. It stays
 *    focusable, still announces itself as unavailable, and the handler drops the
 *    click.
 */
function CommandButton({
  seat,
  command,
  revision,
  allowed,
  blocked,
  idle,
  busy,
  variant = 'primary',
  onAct,
}: {
  seat: SeatId;
  command: GameCommand;
  revision: number;
  allowed: boolean;
  blocked: boolean;
  idle: string;
  busy: string;
  variant?: 'primary' | 'secondary';
  onAct: () => void;
}): React.JSX.Element {
  const label = command.isPending ? busy : idle;

  return (
    <Button
      variant={variant}
      disabled={!allowed || blocked}
      aria-disabled={command.isPending}
      // Six buttons across the two seats otherwise share three accessible names.
      // A section's `aria-label` does not contribute to the accessible name of a
      // button inside it, so a screen-reader rotor would list "Roll, Roll, Hold,
      // Hold". Each one says which seat it belongs to; the visible word stays
      // first, so the accessible name still contains the visible label.
      aria-label={`${label}, ${SEAT_LABELS[seat]}`}
      className={command.isPending ? 'cursor-not-allowed opacity-45' : undefined}
      onClick={() => {
        if (command.isPending) {
          return;
        }

        onAct();
        command.run(revision);
      }}
    >
      {command.isPending && <Spinner />}
      {label}
    </Button>
  );
}

/**
 * Puts focus back in this panel when the control that was just pressed becomes
 * genuinely unavailable.
 *
 * Rolling a double six, or holding, hands the turn to the other player, so the
 * button the keyboard user was standing on is correctly disabled — and a
 * disabled element is not focusable, so a browser drops focus to `<body>`,
 * which is the top of the document.
 *
 * Both endings are handled, because they are not the same ending everywhere: a
 * browser blurs the element it has just disabled, and jsdom leaves focus sitting
 * on it. Either way the keyboard user is stranded, and either way focus comes
 * back to this panel. Only the seat that acted moves, and only when focus really
 * did land somewhere useless.
 */
function useReturnFocusAfterActing(
  sectionRef: RefObject<HTMLElement | null>,
  acting: boolean,
): () => void {
  const pending = useRef(false);

  useEffect(() => {
    if (!pending.current || acting) {
      return;
    }

    pending.current = false;

    const active = document.activeElement;
    const section = sectionRef.current;

    if (section === null) {
      return;
    }

    const droppedToTheTop = active === null || active === document.body;
    const strandedOnADisabledControl =
      active instanceof HTMLButtonElement && active.disabled && section.contains(active);

    if (droppedToTheTop || strandedOnADisabledControl) {
      section.focus();
    }
  });

  return () => {
    pending.current = true;
  };
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
