import {
  type CreateGameRequest,
  type GameView,
  type HoldRequest,
  type NewGameRequest,
  type RollRequest,
} from '@dice-game/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { USER_REPOSITORY, type UserRepository } from '../auth/ports/user-repository.port';
import { ApiError } from '../common/errors/api-error';
import { type RequestUser } from '../common/http/request-context';
import { NotAParticipantError } from '../domain/errors';
import {
  applyHold,
  applyRoll,
  createGame,
  type GameState,
  requireTurn,
  seatOf,
  startNewGame,
} from '../domain/game';
import { type GameRules } from '../domain/rules/game-rules';
import { resolveRules } from '../domain/rules/registry';
import { toGameView } from './game.mapper';
import { DICE_GENERATOR, type DiceGenerator } from './ports/dice-generator.port';
import {
  GAME_REPOSITORY,
  type GameRepository,
  type PersistedGame,
} from './ports/game-repository.port';
import { ID_GENERATOR, type IdGenerator } from './ports/id-generator.port';

/**
 * The one lookup the games module performs against the auth module's user store.
 *
 * Narrowed with `Pick` rather than depending on the whole port: the games module
 * has no business knowing that users can be created, or that they carry a token
 * version. It also means a test double here is two lines instead of an
 * implementation of somebody else's interface, and that adding a method to
 * `UserRepository` cannot break this module.
 */
export type UserLookup = Pick<UserRepository, 'findById'>;

/**
 * Orchestration, and deliberately nothing else.
 *
 * Every method here follows the same four steps: load the game, resolve the
 * ruleset from the allow-list, call a **pure** domain transition, persist under
 * the revision guard. What is absent is the point — there is no comparison
 * against a die face, no win check, no turn logic and no dice arithmetic in this
 * file. All of that lives in `src/domain`, where it is tested without a
 * framework, a clock or a database in sight. A rule that appeared here would be
 * a second copy of one that already exists, and the two would drift.
 *
 * The three capabilities the domain refuses to own — randomness, id generation,
 * the clock — arrive through ports. The clock is not injected here at all: the
 * repository stamps timestamps, because it is the thing that writes.
 */
@Injectable()
export class GamesService {
  constructor(
    @Inject(GAME_REPOSITORY) private readonly games: GameRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserLookup,
    @Inject(DICE_GENERATOR) private readonly dice: DiceGenerator,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  /**
   * Seats the caller against the opponent they named and starts game 1.
   *
   * The creator always takes seat 0, which is also the seat that moves first.
   * The opponent is looked up rather than trusted: a client may name any id, and
   * an unknown one is a `USER_NOT_FOUND` rather than a match against a player
   * who does not exist.
   *
   * Naming *yourself* is rejected too — but by `createGame` in the domain, not
   * here. The lookup succeeds in that case (you do exist), and letting the
   * aggregate refuse it keeps the rule in the one place that is tested for it.
   *
   * @throws {ApiError} `USER_NOT_FOUND` if the opponent does not exist.
   * @throws {InvalidOpponentError} if the opponent is the caller.
   * @throws {InvalidTargetScoreError} if the winning score is unplayable.
   */
  async create(actor: RequestUser, request: CreateGameRequest): Promise<GameView> {
    const opponent = await this.users.findById(request.opponentId);

    if (opponent === null) {
      throw new ApiError('USER_NOT_FOUND', 'No user with that id.', {
        userId: request.opponentId,
      });
    }

    const state = createGame({
      id: this.ids.nextId(),
      players: [
        { userId: actor.id, displayName: actor.displayName },
        // The id comes from the validated request rather than from the record,
        // so this module depends on exactly one field of somebody else's schema.
        { userId: request.opponentId, displayName: opponent.displayName },
      ],
      winningScore: request.winningScore,
    });

    return toGameView(await this.games.create(state), actor.id);
  }

  /**
   * The board, as one of the two players sees it.
   *
   * **Members only.** A game is addressed by id, so an authenticated stranger
   * who guessed one would otherwise read a match they are not in — the previous
   * generation permitted exactly that, and had a test asserting it as intended.
   * They get `NOT_A_PARTICIPANT` and no board.
   *
   * The check is `seatOf` from the domain rather than a comparison written here:
   * membership is the aggregate's answer to give, and this is the same function
   * every transition uses to give it.
   *
   * @throws {ApiError} `GAME_NOT_FOUND` if no game has that id.
   * @throws {NotAParticipantError} if the caller is not seated.
   */
  async findForViewer(actor: RequestUser, gameId: string): Promise<GameView> {
    const game = await this.requireGame(gameId);

    if (seatOf(game, actor.id) === null) {
      throw new NotAParticipantError(actor.id);
    }

    return toGameView(game, actor.id);
  }

  /**
   * Throws the pair and applies whatever the ruleset says it did.
   *
   * The dice are generated here — outside the domain, from a port — and handed
   * in. This service never looks at the faces it produced.
   */
  roll(actor: RequestUser, gameId: string, request: RollRequest): Promise<GameView> {
    return this.applyTransition(actor, gameId, request.expectedRevision, (game, rules) => {
      // The turn is checked before the dice are drawn, not after. Passing
      // `this.dice.rollPair()` as an argument would evaluate it first, so a roll
      // that `applyRoll` then refused would still have consumed a throw. Against
      // the CSPRNG that is invisible; against the deterministic generator it
      // silently shifts every subsequent value in the script, which would make
      // an end-to-end test fail somewhere far from the request that broke it.
      //
      // `applyRoll` checks again — it is pure and cannot trust a caller — and
      // the second check costs nothing.
      requireTurn(game, actor.id, 'roll');

      return applyRoll(game, actor.id, this.dice.rollPair(), rules);
    });
  }

  /** Banks the round score. Whether that wins is the domain's call, not ours. */
  hold(actor: RequestUser, gameId: string, request: HoldRequest): Promise<GameView> {
    return this.applyTransition(actor, gameId, request.expectedRevision, (game, rules) =>
      applyHold(game, actor.id, rules),
    );
  }

  /**
   * Starts the next game between the same two players.
   *
   * Legal at any time, including mid-game. `startNewGame` re-resolves the stored
   * ruleset itself — a new game continues the series under the rules it was
   * begun with — so the resolved policy this method is handed goes unused.
   */
  newGame(actor: RequestUser, gameId: string, request: NewGameRequest): Promise<GameView> {
    return this.applyTransition(actor, gameId, request.expectedRevision, (game) =>
      startNewGame(game, actor.id, request.winningScore),
    );
  }

  /**
   * Load, resolve, transition, compare-and-set. Every write goes through here.
   *
   * **`expectedRevision` must be the revision the transition was computed from,
   * and that is checked here.** It guards the compare-and-set below, but the
   * client chooses it and the state being written comes from whatever this
   * method loaded — so letting the two differ lets a client aim a write at a
   * revision that does not exist yet and have it land the moment somebody else
   * creates it, overwriting their move with one computed from before it. A
   * participant could bank a score and have the next request erase it. The
   * compare-and-set cannot catch this: by the time it runs, the document really
   * is at the revision the client named.
   *
   * The check is placed **after** the transition rather than before it, which is
   * what keeps the two things it has to satisfy from fighting:
   *
   *  - Checking the revision first would answer `GAME_REVISION_CONFLICT` to a
   *    non-participant probing a stale id, telling a stranger something about a
   *    table they are not sitting at. Running the transition first means the
   *    domain's own ordering — game over, then membership, then turn — decides
   *    what they are told.
   *  - The compare-and-set stays as well, and is not redundant with this. This
   *    check closes the gap between the client's number and the loaded state;
   *    the compare-and-set closes the gap between the load and the write.
   *
   * Either refusal means somebody wrote between the load and the update. The
   * action is **not** replayed: replaying is how a double-clicked Roll becomes
   * two rolls, which is the exact failure the revision exists to prevent. The
   * client refetches — `GAME_REVISION_CONFLICT` is in the contract's `REFETCH_ON`
   * set precisely because it is a normal outcome of two seats sharing one page,
   * not an error to show a user.
   */
  private async applyTransition(
    actor: RequestUser,
    gameId: string,
    expectedRevision: number,
    transition: (game: GameState, rules: GameRules) => GameState,
  ): Promise<GameView> {
    const current = await this.requireGame(gameId);
    const rules = resolveRules(current.ruleset);
    const next = transition(current, rules);

    if (current.revision !== expectedRevision) {
      throw new ApiError(
        'GAME_REVISION_CONFLICT',
        'This game has moved on since you last saw it. Refetch and try again.',
        { gameId, expectedRevision },
      );
    }

    const stored = await this.games.updateIfRevisionMatches(gameId, expectedRevision, next);

    if (stored === null) {
      throw new ApiError(
        'GAME_REVISION_CONFLICT',
        'This game has moved on since you last saw it. Refetch and try again.',
        { gameId, expectedRevision },
      );
    }

    return toGameView(stored, actor.id);
  }

  private async requireGame(gameId: string): Promise<PersistedGame> {
    const game = await this.games.findById(gameId);

    if (game === null) {
      throw new ApiError('GAME_NOT_FOUND', 'No game with that id.', { gameId });
    }

    return game;
  }
}
