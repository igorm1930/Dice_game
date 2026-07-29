import { type GameEffect, type GameView, type Seat } from '@dice-game/contracts';

/**
 * What just happened, in words — for the live region a screen-reader user hears
 * and for the status line everyone else reads.
 *
 * Every sentence is built from fields the server sent. Nothing here decides
 * anything:
 *
 *  - that a double six happened is `effect`, not a comparison against a face;
 *  - whose turn it is now is `activePlayer`, not a rule about turns;
 *  - who won is `winner`, not a comparison against the winning score.
 *
 * Note what `DOUBLE_SIX` does *not* say: who threw it. The view that arrives has
 * already passed the turn, and the API does not send the previous active seat —
 * so the client would have to work it out, which is exactly the kind of small
 * inference this app refuses to make. If naming the busted player mattered, the
 * field to add is on the API.
 */
function nameOf(view: GameView, seat: Seat): string {
  return view.players[seat].displayName;
}

const NARRATION: Readonly<Record<GameEffect, (view: GameView) => string>> = Object.freeze({
  NORMAL_ROLL: (view) => {
    const dice = view.lastDice;
    const thrown = dice === null ? 'the dice' : `${dice[0]} and ${dice[1]}`;

    return `${nameOf(view, view.activePlayer)} rolled ${thrown}. Round score ${view.roundScore}.`;
  },

  DOUBLE_SIX: (view) =>
    `Double six. The round score is lost and the dice pass to ${nameOf(view, view.activePlayer)}.`,

  HELD: (view) =>
    `Round score banked. It is now ${nameOf(view, view.activePlayer)}’s turn to roll.`,

  GAME_WON: (view) =>
    view.winner === null
      ? 'The game is over.'
      : `${nameOf(view, view.winner)} wins game ${view.gameNumber}.`,

  NEW_GAME: (view) => `New game started. It is ${nameOf(view, view.activePlayer)}’s turn to roll.`,
});

/** The sentence for the view as it stands, or `null` before anything has happened. */
export function narrate(view: GameView | undefined): string | null {
  if (view === undefined) {
    return null;
  }

  if (view.effect === null) {
    return `Waiting for ${nameOf(view, view.activePlayer)} to roll.`;
  }

  return NARRATION[view.effect](view);
}

/** A short badge for the same fact — never load-bearing, always cosmetic. */
export const EFFECT_LABELS: Readonly<Record<GameEffect, string>> = Object.freeze({
  NORMAL_ROLL: 'Rolled',
  DOUBLE_SIX: 'Double six',
  HELD: 'Held',
  GAME_WON: 'Game won',
  NEW_GAME: 'New game',
});
