import { type DicePair } from './dice';
import {
  GameOverError,
  InvalidOpponentError,
  InvalidTargetScoreError,
  NotAParticipantError,
  NotYourTurnError,
} from './errors';
import { type GameRules, type RulesetRef } from './rules/game-rules';
import { resolveRules } from './rules/registry';
import { otherSeat, type Seat } from './seat';

/**
 * The game aggregate: the whole of the server-authoritative state, and every
 * legal transition over it.
 *
 * Three properties hold throughout this file, and each is load-bearing:
 *
 *  1. **Every transition is pure.** No clock, no randomness, no I/O. Dice arrive
 *     as an argument because a `DiceGenerator` port produced them outside; the
 *     ruleset arrives as an argument because the registry resolved it outside.
 *     A test needs no fake beyond a literal.
 *  2. **Nothing mutates its input.** Transitions return a new frozen snapshot.
 *     The previous generation shared one mutable match object between requests,
 *     and a third player starting a game silently destroyed a match in progress.
 *  3. **No timestamps, and no `revision` arithmetic.** `createdAt`/`updatedAt`
 *     are stamped by the persistence layer, which owns the clock, and Mongo
 *     increments `revision` atomically on write — a domain that incremented it
 *     would race with the optimistic-concurrency check that depends on it.
 */

export type GameStatus = 'ACTIVE' | 'COMPLETED';

/**
 * What the last applied action did — the client's entire basis for animating.
 *
 * This exists so the UI never re-decides what a bust is. `DOUBLE_SIX` arrives as
 * a fact from the server alongside the dice that caused it; the client's only
 * job is to play an animation and say whose turn is next.
 *
 * Describes the last action applied, not a persistent condition.
 */
export type GameEffect = 'NORMAL_ROLL' | 'DOUBLE_SIX' | 'HELD' | 'GAME_WON' | 'NEW_GAME';

/**
 * A seated player, denormalised with the display name they had when the match
 * began. The name is a snapshot on purpose — a scoreboard should still read
 * correctly if a player renames later.
 */
export interface GamePlayer {
  readonly userId: string;
  readonly displayName: string;
  /** Banked score in the current game. Reset by New Game. */
  readonly globalScore: number;
  /** Games won across the whole series between these two. Survives New Game. */
  readonly winCount: number;
}

export interface GameState {
  readonly id: string;
  /** The two identities seated at this match. Index-aligned with `Seat`. */
  readonly players: readonly [GamePlayer, GamePlayer];
  readonly activePlayer: Seat;
  /** Points accumulated this turn: lost on a double six, banked on Hold. */
  readonly roundScore: number;
  /** The faces last thrown, or `null` before the first roll of a game. */
  readonly lastDice: DicePair | null;
  readonly winningScore: number;
  readonly ruleset: RulesetRef;
  /** Increments on every New Game; 1 for the first game between two players. */
  readonly gameNumber: number;
  readonly status: GameStatus;
  readonly winner: Seat | null;
  /** Optimistic-concurrency token. Owned by the persistence layer, not by us. */
  readonly revision: number;
  readonly effect: GameEffect | null;
}

/** What the acting user may legally do right now, decided here and nowhere else. */
export interface AvailableActions {
  readonly canRoll: boolean;
  readonly canHold: boolean;
  readonly canStartNewGame: boolean;
}

/** An identity taking a seat. Scores start at zero and are not the caller's to set. */
export interface SeatAssignment {
  readonly userId: string;
  readonly displayName: string;
}

export interface CreateGameParams {
  readonly id: string;
  readonly players: readonly [SeatAssignment, SeatAssignment];
  /** Resolved from the allow-list by the caller; never built from client input. */
  readonly rules: GameRules;
  /** Omitted means the ruleset's default. Frozen for the match once set. */
  readonly winningScore?: number | undefined;
}

/**
 * Returns a new snapshot with every nested structure frozen.
 *
 * Freezing the tuples and the seated players, not just the top level, is what
 * makes "the state you were handed cannot change under you" true rather than
 * shallowly true.
 */
function freeze(state: GameState): GameState {
  const players: readonly [GamePlayer, GamePlayer] = [
    Object.freeze({ ...state.players[0] }),
    Object.freeze({ ...state.players[1] }),
  ];

  const lastDice: DicePair | null =
    state.lastDice === null ? null : [state.lastDice[0], state.lastDice[1]];

  if (lastDice !== null) {
    Object.freeze(lastDice);
  }

  return Object.freeze({
    ...state,
    players: Object.freeze(players),
    ruleset: Object.freeze({ ...state.ruleset }),
    lastDice,
  });
}

/**
 * @throws {InvalidTargetScoreError} if the score is outside the ruleset's bounds
 * or is not an integer.
 */
function assertPlayableWinningScore(value: number, rules: GameRules): void {
  if (
    !Number.isInteger(value) ||
    value < rules.minimumWinningScore ||
    value > rules.maximumWinningScore
  ) {
    throw new InvalidTargetScoreError(value, rules.minimumWinningScore, rules.maximumWinningScore);
  }
}

/** Returns the seat this user occupies, or `null` if they are a spectator. */
export function seatOf(state: GameState, userId: string): Seat | null {
  if (state.players[0].userId === userId) {
    return 0;
  }
  if (state.players[1].userId === userId) {
    return 1;
  }
  return null;
}

/**
 * Seats two players and starts game 1.
 *
 * @throws {InvalidTargetScoreError} if the winning score is not playable.
 * @throws {InvalidOpponentError} if both seats hold the same identity.
 */
export function createGame(params: CreateGameParams): GameState {
  const { rules } = params;
  const winningScore = params.winningScore ?? rules.defaultWinningScore;

  assertPlayableWinningScore(winningScore, rules);

  if (params.players[0].userId === params.players[1].userId) {
    throw new InvalidOpponentError(params.players[0].userId);
  }

  return freeze({
    id: params.id,
    players: [
      { ...params.players[0], globalScore: 0, winCount: 0 },
      { ...params.players[1], globalScore: 0, winCount: 0 },
    ],
    activePlayer: 0,
    roundScore: 0,
    lastDice: null,
    winningScore,
    ruleset: { id: rules.id, version: rules.version },
    gameNumber: 1,
    status: 'ACTIVE',
    winner: null,
    revision: 0,
    effect: null,
  });
}

/**
 * Guards that `userId` may act on this state at all, returning their seat.
 *
 * **The order of these three checks is deliberate and is asserted by a test.**
 * A finished game is finished for everyone, so game-over is reported ahead of
 * any turn or membership violation — answering "not your turn" for a decided
 * match would describe a game that is no longer in progress, and would tell a
 * stranger something about a table they are not sitting at. Membership is
 * checked before turn order for the same reason: "it is player 0's turn" is
 * information about a match, and a non-participant is owed only "you are not in
 * this game".
 *
 * @throws {GameOverError} if the match is already decided.
 * @throws {NotAParticipantError} if the caller is not seated.
 * @throws {NotYourTurnError} if it is the other player's turn.
 */
export function requireTurn(state: GameState, userId: string, action: string): Seat {
  if (state.status !== 'ACTIVE') {
    throw new GameOverError(action, state.winner);
  }

  const seat = seatOf(state, userId);
  if (seat === null) {
    throw new NotAParticipantError(userId);
  }

  if (seat !== state.activePlayer) {
    throw new NotYourTurnError(action, seat, state.activePlayer);
  }

  return seat;
}

/**
 * Applies one throw of the pair on behalf of `userId`.
 *
 * The engine does not look at the dice. It asks the ruleset what the throw did
 * and applies the consequence:
 *
 *  - `ADD_TO_ROUND` — the points join the round score and the **same** player
 *    keeps the turn, free to roll again or to hold.
 *  - `LOSE_ROUND_AND_PASS` — the round score is wiped and the turn passes.
 *    Global scores are untouched: only unbanked points are at risk.
 *
 * `lastDice` is set either way, because the client renders the faces it was
 * dealt without computing anything from them.
 *
 * @throws {GameOverError | NotAParticipantError | NotYourTurnError}
 */
export function applyRoll(
  state: GameState,
  userId: string,
  dice: DicePair,
  rules: GameRules,
): GameState {
  requireTurn(state, userId, 'roll');

  const outcome = rules.evaluateRoll(dice);

  if (outcome.type === 'LOSE_ROUND_AND_PASS') {
    return freeze({
      ...state,
      roundScore: 0,
      activePlayer: otherSeat(state.activePlayer),
      lastDice: dice,
      // `DOUBLE_SIX` is the only losing combination `standard@1` defines, and
      // the wire contract names the effect after it. A future ruleset that lost
      // a round some other way would need a new effect in the contract first.
      effect: 'DOUBLE_SIX',
    });
  }

  return freeze({
    ...state,
    roundScore: state.roundScore + outcome.points,
    lastDice: dice,
    effect: 'NORMAL_ROLL',
  });
}

/**
 * Banks the round score into the active player's global score.
 *
 * Reaching *or exceeding* the winning score wins immediately — this is the only
 * place a win is decided, because it is the only place a global score changes.
 * The winner keeps the seat marked active so the final board reads as theirs;
 * every action is refused from that point on regardless.
 *
 * Holding on a zero round score is legal and simply forfeits the turn. See
 * `standardRulesV1.canHold` for why that is a decision rather than an omission.
 *
 * @throws {GameOverError | NotAParticipantError | NotYourTurnError}
 */
export function applyHold(state: GameState, userId: string, rules: GameRules): GameState {
  const seat = requireTurn(state, userId, 'hold');

  const player = state.players[seat];
  const banked = player.globalScore + state.roundScore;
  const won = rules.hasWon(banked, state.winningScore);

  const updated: GamePlayer = {
    ...player,
    globalScore: banked,
    winCount: won ? player.winCount + 1 : player.winCount,
  };

  const players: readonly [GamePlayer, GamePlayer] =
    seat === 0 ? [updated, state.players[1]] : [state.players[0], updated];

  return freeze({
    ...state,
    players,
    // Banked either way, so there is nothing left in the round in either branch.
    roundScore: 0,
    activePlayer: won ? seat : otherSeat(seat),
    status: won ? 'COMPLETED' : 'ACTIVE',
    winner: won ? seat : null,
    effect: won ? 'GAME_WON' : 'HELD',
  });
}

/**
 * Starts the next game between the same two players.
 *
 * Legal at **any** time, including mid-game — the brief requires it, and a
 * player who wants out of a match should not have to finish it first. Preserves
 * both identities and both win counts; resets global scores, round score, last
 * dice and winner; hands the first turn back to seat 0 and increments the game
 * number. May raise or lower the winning score for the new game only.
 *
 * The bounds are the ones belonging to the ruleset this match is already played
 * under, resolved through the allow-list from the ref stored on the state — a
 * New Game continues the series, it does not change its rules.
 *
 * @throws {NotAParticipantError} if the caller is not seated. Note the absence
 * of a game-over check: restarting a finished game is the *expected* path.
 * @throws {InvalidTargetScoreError} if the requested winning score is unplayable.
 * @throws {UnsupportedRulesetError} if the stored ruleset ref is not allow-listed.
 */
export function startNewGame(state: GameState, userId: string, winningScore?: number): GameState {
  const seat = seatOf(state, userId);
  if (seat === null) {
    throw new NotAParticipantError(userId);
  }

  const rules = resolveRules(state.ruleset);
  const nextWinningScore = winningScore ?? state.winningScore;
  assertPlayableWinningScore(nextWinningScore, rules);

  return freeze({
    ...state,
    players: [
      { ...state.players[0], globalScore: 0 },
      { ...state.players[1], globalScore: 0 },
    ],
    activePlayer: 0,
    roundScore: 0,
    lastDice: null,
    winningScore: nextWinningScore,
    gameNumber: state.gameNumber + 1,
    status: 'ACTIVE',
    winner: null,
    effect: 'NEW_GAME',
  });
}

/**
 * What `userId` may do right now.
 *
 * The client renders its buttons from these three booleans and never derives
 * legality itself. That is what makes "no game logic in the frontend" a
 * structural property rather than a promise: a modified client could enable its
 * own buttons, and the server would still refuse the action.
 *
 * All three are false for a non-participant — a spectator is told nothing about
 * whose turn it is by the shape of their own affordances.
 *
 * `rules` is optional because the answer under `standard@1` is fully determined
 * by turn and status. Pass the resolved policy and a future ruleset that
 * restricts holding is honoured here too, with no change at the call site.
 */
export function availableActionsFor(
  state: GameState,
  userId: string,
  rules?: GameRules,
): AvailableActions {
  const seat = seatOf(state, userId);

  if (seat === null) {
    return Object.freeze({ canRoll: false, canHold: false, canStartNewGame: false });
  }

  const isMyTurn = state.status === 'ACTIVE' && seat === state.activePlayer;

  return Object.freeze({
    canRoll: isMyTurn,
    canHold: isMyTurn && (rules?.canHold(state) ?? true),
    // A player may abandon a match in progress, and must be able to start
    // another once one is decided. Both are the same affordance.
    canStartNewGame: true,
  });
}
