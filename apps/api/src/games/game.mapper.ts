import {
  type AvailableActions,
  type GameView,
  type PlayerView,
  type RulesetRef as ContractRulesetRef,
  STANDARD_RULESET,
} from '@dice-game/contracts';

import { UnsupportedRulesetError } from '../domain/errors';
import { availableActionsFor, type GamePlayer, seatOf } from '../domain/game';
import { type RulesetRef } from '../domain/rules/game-rules';
import { tryResolveRules } from '../domain/rules/registry';
import { type PersistedGame } from './ports/game-repository.port';

/**
 * The boundary between the aggregate and the wire.
 *
 * Two things are added here and nowhere else, and both are **relative to the
 * user asking**:
 *
 *  - `availableActions` — what this caller may do right now. The client renders
 *    its buttons from these three booleans and never derives legality itself,
 *    which is what makes "no game logic in the frontend" structural rather than
 *    a promise. They come from `availableActionsFor` in the domain; nothing is
 *    recomputed here.
 *  - `viewerSeat` — which chair they are sitting in, or `null` when they are
 *    only watching.
 *
 * Everything else is a rename or a serialisation. There is no arithmetic in
 * this file and there must not be: a mapper that decided anything would be a
 * second, quieter copy of the rules.
 */

/**
 * What a caller may do when the ruleset their game was recorded under can no
 * longer be resolved. Nothing, which is the only safe answer — see below.
 */
const NO_ACTIONS: AvailableActions = Object.freeze({
  canRoll: false,
  canHold: false,
  canStartNewGame: false,
});

/**
 * Renders `game` as the requesting user sees it.
 *
 * @throws {UnsupportedRulesetError} if the stored ruleset is one the contract
 * cannot express. Reachable only for a document written by a future version.
 */
export function toGameView(game: PersistedGame, viewerId: string): GameView {
  /**
   * `tryResolveRules`, not `resolveRules`. A game whose ruleset was withdrawn
   * is still readable — the board, the scores and the winner are all facts —
   * and answering "all three actions are unavailable" is both true and the safe
   * direction. Refusing the read outright would be a 422 on a GET for a match
   * the player can plainly see in their history.
   */
  const rules = tryResolveRules(game.ruleset);

  return {
    id: game.id,
    players: [toPlayerView(game.players[0]), toPlayerView(game.players[1])],
    activePlayer: game.activePlayer,
    roundScore: game.roundScore,
    // Copied rather than passed through: the stored tuple is frozen, and the
    // response should not hand a caller a reference into the store.
    lastDice: game.lastDice === null ? null : [game.lastDice[0], game.lastDice[1]],
    winningScore: game.winningScore,
    ruleset: toContractRuleset(game.ruleset),
    gameNumber: game.gameNumber,
    status: game.status,
    winner: game.winner,
    revision: game.revision,
    availableActions:
      rules === null ? { ...NO_ACTIONS } : { ...availableActionsFor(game, viewerId, rules) },
    effect: game.effect,
    viewerSeat: seatOf(game, viewerId),
    createdAt: game.createdAt.toISOString(),
    updatedAt: game.updatedAt.toISOString(),
  };
}

/** The seated player, minus the fields the wire has no business carrying. */
function toPlayerView(player: GamePlayer): PlayerView {
  return {
    userId: player.userId,
    displayName: player.displayName,
    globalScore: player.globalScore,
    winCount: player.winCount,
  };
}

/**
 * Narrows the domain's open `{ id: string; version: number }` to the literal
 * pair the contract declares.
 *
 * The two types are deliberately different. The domain's ref is open because a
 * second ruleset is a build-time addition to the registry; the contract's is a
 * literal because a client has to be able to exhaustively switch on it. This is
 * the one place the two meet, so this is where the narrowing happens rather
 * than behind a cast at a dozen call sites.
 */
function toContractRuleset(ref: RulesetRef): ContractRulesetRef {
  if (ref.id !== STANDARD_RULESET.id || ref.version !== STANDARD_RULESET.version) {
    throw new UnsupportedRulesetError(ref);
  }

  return STANDARD_RULESET;
}
