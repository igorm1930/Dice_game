import { describe, expect, it } from 'vitest';

import { type DicePair } from './dice';
import {
  GameOverError,
  InvalidOpponentError,
  InvalidTargetScoreError,
  NotAParticipantError,
  NotYourTurnError,
  UnsupportedRulesetError,
} from './errors';
import {
  applyHold,
  applyRoll,
  availableActionsFor,
  createGame,
  requireTurn,
  seatOf,
  startNewGame,
  type GameState,
} from './game';
import { type GameRules, type RollOutcome } from './rules/game-rules';
import { standardRulesV1 } from './rules/standard-v1';

/**
 * Engine tests. These assert what the aggregate *does* with an outcome, never
 * what produces one — "LOSE_ROUND_AND_PASS clears the round score and switches
 * player" lives here, "6 and 6 produces LOSE_ROUND_AND_PASS" lives in
 * `rules/standard-v1.test.ts`. Where the consequence is the subject, the trigger
 * is a hand-written stand-in ruleset rather than a real double six.
 */

const GAME_ID = 'game-0001';
const ALICE = { userId: 'user-alice', displayName: 'alice' };
const BOB = { userId: 'user-bob', displayName: 'bob' };
const CAROL_ID = 'user-carol';

function game(winningScore?: number): GameState {
  return createGame({
    id: GAME_ID,
    players: [ALICE, BOB],
    rules: standardRulesV1,
    winningScore,
  });
}

/** Applies a sequence of throws on behalf of whoever is currently active. */
function play(state: GameState, throws: readonly DicePair[]): GameState {
  return throws.reduce<GameState>(
    (current, dice) =>
      applyRoll(current, current.players[current.activePlayer].userId, dice, standardRulesV1),
    state,
  );
}

/**
 * A stand-in ruleset, hand-written — the suite uses no mocking framework.
 *
 * It keeps `standard@1`'s id and version so states it produces still resolve
 * through the allow-list; only the behaviour under test is swapped.
 */
function rulesWhere(overrides: Partial<GameRules>): GameRules {
  return {
    id: standardRulesV1.id,
    version: standardRulesV1.version,
    defaultWinningScore: standardRulesV1.defaultWinningScore,
    minimumWinningScore: standardRulesV1.minimumWinningScore,
    maximumWinningScore: standardRulesV1.maximumWinningScore,
    evaluateRoll: (dice) => standardRulesV1.evaluateRoll(dice),
    canHold: (state) => standardRulesV1.canHold(state),
    hasWon: (globalScore, winningScore) => standardRulesV1.hasWon(globalScore, winningScore),
    ...overrides,
  };
}

function alwaysProducing(outcome: RollOutcome): GameRules {
  return rulesWhere({ evaluateRoll: () => outcome });
}

describe('createGame', () => {
  it('seats both players and starts them level', () => {
    expect(game()).toMatchObject({
      id: GAME_ID,
      players: [
        { userId: ALICE.userId, displayName: 'alice', globalScore: 0, winCount: 0 },
        { userId: BOB.userId, displayName: 'bob', globalScore: 0, winCount: 0 },
      ],
      activePlayer: 0,
      roundScore: 0,
      lastDice: null,
      ruleset: { id: 'standard', version: 1 },
      gameNumber: 1,
      status: 'ACTIVE',
      winner: null,
      revision: 0,
      effect: null,
    });
  });

  it('uses the ruleset default winning score when none is given', () => {
    expect(game().winningScore).toBe(100);
    expect(game().winningScore).toBe(standardRulesV1.defaultWinningScore);
  });

  it('accepts a custom winning score', () => {
    expect(game(42).winningScore).toBe(42);
  });

  it('accepts the exact bounds', () => {
    expect(game(standardRulesV1.minimumWinningScore).winningScore).toBe(2);
    expect(game(standardRulesV1.maximumWinningScore).winningScore).toBe(1000);
  });

  it.each([
    ['below the minimum', 1],
    ['above the maximum', 1001],
    ['fractional', 50.5],
    ['not a number at all', Number.NaN],
    ['negative', -10],
    ['zero', 0],
  ])('rejects a winning score that is %s', (_label, winningScore) => {
    expect(() => game(winningScore)).toThrow(InvalidTargetScoreError);
  });

  it('names the bounds in the error details', () => {
    expect.assertions(2);

    try {
      game(1);
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTargetScoreError);
      expect((error as InvalidTargetScoreError).details).toEqual({
        requested: 1,
        minimum: 2,
        maximum: 1000,
      });
    }
  });

  it('refuses to seat the same identity twice', () => {
    expect(() =>
      createGame({
        id: GAME_ID,
        players: [ALICE, { userId: ALICE.userId, displayName: 'ALICE' }],
        rules: standardRulesV1,
      }),
    ).toThrow(InvalidOpponentError);
  });

  it('records the ruleset it was created under', () => {
    expect(game().ruleset).toEqual({ id: standardRulesV1.id, version: standardRulesV1.version });
  });

  it('defends its own immutability, all the way down', () => {
    const state = game();

    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.players)).toBe(true);
    expect(Object.isFrozen(state.players[0])).toBe(true);
    expect(Object.isFrozen(state.players[1])).toBe(true);
    expect(Object.isFrozen(state.ruleset)).toBe(true);
  });
});

describe('seatOf', () => {
  it('locates each player and reports a stranger as unseated', () => {
    const state = game();

    expect(seatOf(state, ALICE.userId)).toBe(0);
    expect(seatOf(state, BOB.userId)).toBe(1);
    expect(seatOf(state, CAROL_ID)).toBeNull();
  });
});

describe('requireTurn check order', () => {
  const finished = applyHold(play(game(10), [[5, 5]]), ALICE.userId, standardRulesV1);

  it('reports game-over ahead of a membership violation', () => {
    // A finished game is finished for everyone. Answering "not a participant"
    // first would describe a table that is no longer in play.
    expect(() => requireTurn(finished, CAROL_ID, 'roll')).toThrow(GameOverError);
  });

  it('reports game-over ahead of a turn violation', () => {
    expect(() => requireTurn(finished, BOB.userId, 'roll')).toThrow(GameOverError);
  });

  it('reports a membership violation ahead of a turn violation', () => {
    // Carol is not seated *and* it is not her turn. She is owed the first
    // answer only: whose turn it is, is information about a match she is not in.
    expect(() => requireTurn(game(), CAROL_ID, 'roll')).toThrow(NotAParticipantError);
  });

  it('reports a turn violation for a seated player acting out of turn', () => {
    expect(() => requireTurn(game(), BOB.userId, 'roll')).toThrow(NotYourTurnError);
  });

  it('returns the seat when the action is legal', () => {
    expect(requireTurn(game(), ALICE.userId, 'roll')).toBe(0);
  });
});

describe('applyRoll — ADD_TO_ROUND', () => {
  it('adds the points to the round score and leaves the turn where it is', () => {
    const state = applyRoll(
      game(),
      ALICE.userId,
      [1, 1],
      alwaysProducing({ type: 'ADD_TO_ROUND', points: 9 }),
    );

    expect(state).toMatchObject({
      roundScore: 9,
      activePlayer: 0,
      lastDice: [1, 1],
      effect: 'NORMAL_ROLL',
      players: [{ globalScore: 0 }, { globalScore: 0 }],
    });
  });

  it('adds the sum of both dice under standard@1', () => {
    expect(applyRoll(game(), ALICE.userId, [4, 3], standardRulesV1)).toMatchObject({
      roundScore: 7,
      activePlayer: 0,
      lastDice: [4, 3],
      effect: 'NORMAL_ROLL',
    });
  });

  it('accumulates across consecutive throws by the same player', () => {
    const state = play(game(), [
      [4, 3],
      [2, 2],
      [1, 5],
    ]);

    expect(state.roundScore).toBe(17);
    expect(state.activePlayer).toBe(0);
    expect(state.players[0].globalScore).toBe(0);
  });

  it('leaves a single six as an ordinary scoring roll', () => {
    const state = play(game(), [
      [6, 1],
      [3, 6],
    ]);

    expect(state.roundScore).toBe(16);
    expect(state.effect).toBe('NORMAL_ROLL');
    expect(state.activePlayer).toBe(0);
  });
});

describe('applyRoll — LOSE_ROUND_AND_PASS', () => {
  it('clears the round score and switches player', () => {
    // The engine consequence, tested independently of what triggered it: the
    // dice here are a harmless [1, 1] and the stand-in ruleset supplies the
    // outcome. Changing what busts must not break this test.
    const withPoints = applyRoll(
      game(),
      ALICE.userId,
      [1, 1],
      alwaysProducing({ type: 'ADD_TO_ROUND', points: 20 }),
    );

    const lost = applyRoll(
      withPoints,
      ALICE.userId,
      [1, 1],
      alwaysProducing({ type: 'LOSE_ROUND_AND_PASS' }),
    );

    expect(lost).toMatchObject({
      roundScore: 0,
      activePlayer: 1,
      lastDice: [1, 1],
      effect: 'DOUBLE_SIX',
    });
  });

  it('never touches a banked global score — only unbanked points are at risk', () => {
    const banked = applyHold(play(game(), [[5, 5]]), ALICE.userId, standardRulesV1);
    const lost = applyRoll(
      banked,
      BOB.userId,
      [2, 2],
      alwaysProducing({ type: 'LOSE_ROUND_AND_PASS' }),
    );

    expect(lost.players[0].globalScore).toBe(10);
    expect(lost.players[1].globalScore).toBe(0);
    expect(lost.roundScore).toBe(0);
  });

  it('is what a double six produces under standard@1, and the turn genuinely changes hands', () => {
    const state = play(game(), [
      [5, 5],
      [4, 4],
      [6, 6],
    ]);

    expect(state).toMatchObject({
      roundScore: 0,
      activePlayer: 1,
      lastDice: [6, 6],
      effect: 'DOUBLE_SIX',
      players: [{ globalScore: 0 }, { globalScore: 0 }],
    });

    expect(() => applyRoll(state, ALICE.userId, [1, 1], standardRulesV1)).toThrow(NotYourTurnError);
    expect(applyRoll(state, BOB.userId, [1, 1], standardRulesV1).roundScore).toBe(2);
  });

  it('clears the effect on the next ordinary throw', () => {
    const lost = play(game(), [[6, 6]]);

    expect(applyRoll(lost, BOB.userId, [2, 2], standardRulesV1).effect).toBe('NORMAL_ROLL');
  });
});

describe('applyRoll — guards', () => {
  it('refuses a roll from the player whose turn it is not', () => {
    expect(() => applyRoll(game(), BOB.userId, [3, 3], standardRulesV1)).toThrow(NotYourTurnError);
  });

  it('refuses a roll from someone who is not seated', () => {
    expect(() => applyRoll(game(), CAROL_ID, [3, 3], standardRulesV1)).toThrow(
      NotAParticipantError,
    );
  });

  it('names the active seat in the error details so a client can react', () => {
    expect.assertions(3);

    try {
      applyRoll(game(), BOB.userId, [3, 3], standardRulesV1);
    } catch (error) {
      expect(error).toBeInstanceOf(NotYourTurnError);
      expect((error as NotYourTurnError).code).toBe('NOT_YOUR_TURN');
      expect((error as NotYourTurnError).details).toEqual({
        action: 'roll',
        actor: 1,
        activePlayer: 0,
      });
    }
  });
});

describe('applyHold', () => {
  it('banks the round score and passes the turn', () => {
    expect(applyHold(play(game(), [[4, 3]]), ALICE.userId, standardRulesV1)).toMatchObject({
      players: [{ globalScore: 7, winCount: 0 }, { globalScore: 0 }],
      roundScore: 0,
      activePlayer: 1,
      status: 'ACTIVE',
      winner: null,
      effect: 'HELD',
    });
  });

  it('accepts a hold on a zero round score, banking zero and forfeiting the turn', () => {
    expect(applyHold(game(), ALICE.userId, standardRulesV1)).toMatchObject({
      players: [{ globalScore: 0 }, { globalScore: 0 }],
      roundScore: 0,
      activePlayer: 1,
      status: 'ACTIVE',
      effect: 'HELD',
    });
  });

  it('refuses a hold from the player whose turn it is not', () => {
    expect(() => applyHold(game(), BOB.userId, standardRulesV1)).toThrow(NotYourTurnError);
  });

  it('refuses a hold from someone who is not seated', () => {
    expect(() => applyHold(game(), CAROL_ID, standardRulesV1)).toThrow(NotAParticipantError);
  });

  it('accumulates across turns until someone reaches the winning score', () => {
    let state = applyHold(play(game(20), [[5, 5]]), ALICE.userId, standardRulesV1);
    state = applyHold(play(state, [[4, 4]]), BOB.userId, standardRulesV1);
    state = applyHold(play(state, [[5, 5]]), ALICE.userId, standardRulesV1);

    expect(state).toMatchObject({
      players: [{ globalScore: 20 }, { globalScore: 8 }],
      winner: 0,
      status: 'COMPLETED',
    });
  });
});

describe('applyHold — winning', () => {
  it('wins the moment the total reaches the winning score', () => {
    expect(applyHold(play(game(10), [[5, 5]]), ALICE.userId, standardRulesV1)).toMatchObject({
      players: [
        { globalScore: 10, winCount: 1 },
        { globalScore: 0, winCount: 0 },
      ],
      roundScore: 0,
      status: 'COMPLETED',
      winner: 0,
      activePlayer: 0,
      effect: 'GAME_WON',
    });
  });

  it('wins on overshooting it too', () => {
    expect(applyHold(play(game(10), [[6, 5]]), ALICE.userId, standardRulesV1)).toMatchObject({
      players: [
        { globalScore: 11, winCount: 1 },
        { globalScore: 0, winCount: 0 },
      ],
      status: 'COMPLETED',
      winner: 0,
    });
  });

  it('does not win one under the winning score', () => {
    expect(applyHold(play(game(11), [[5, 5]]), ALICE.userId, standardRulesV1)).toMatchObject({
      players: [
        { globalScore: 10, winCount: 0 },
        { globalScore: 0, winCount: 0 },
      ],
      status: 'ACTIVE',
      winner: null,
      activePlayer: 1,
      effect: 'HELD',
    });
  });

  it('leaves the winner as the active player so the final board reads as theirs', () => {
    const won = applyHold(play(game(10), [[5, 5]]), ALICE.userId, standardRulesV1);

    expect(won.activePlayer).toBe(0);
    expect(won.winner).toBe(0);
  });

  it('increments only the winner’s win count', () => {
    const won = applyHold(play(game(10), [[5, 5]]), ALICE.userId, standardRulesV1);

    expect(won.players[0].winCount).toBe(1);
    expect(won.players[1].winCount).toBe(0);
  });

  it('lets seat 1 win, so seat 0 is not privileged by accident', () => {
    const afterAlice = applyHold(game(10), ALICE.userId, standardRulesV1);
    const bobWins = applyHold(play(afterAlice, [[5, 5]]), BOB.userId, standardRulesV1);

    expect(bobWins).toMatchObject({
      players: [
        { globalScore: 0, winCount: 0 },
        { globalScore: 10, winCount: 1 },
      ],
      winner: 1,
      status: 'COMPLETED',
      activePlayer: 1,
      effect: 'GAME_WON',
    });
  });

  it('asks the ruleset whether a total wins, rather than comparing itself', () => {
    const neverWins = rulesWhere({ hasWon: () => false });
    const state = applyHold(play(game(2), [[6, 6]]), BOB.userId, neverWins);

    expect(state.status).toBe('ACTIVE');
    expect(state.winner).toBeNull();
  });
});

describe('once the game is over', () => {
  const finished = applyHold(play(game(10), [[5, 5]]), ALICE.userId, standardRulesV1);

  it('rejects further rolls, whoever sends them', () => {
    expect(() => applyRoll(finished, ALICE.userId, [1, 1], standardRulesV1)).toThrow(GameOverError);
    expect(() => applyRoll(finished, BOB.userId, [1, 1], standardRulesV1)).toThrow(GameOverError);
  });

  it('rejects further holds', () => {
    expect(() => applyHold(finished, ALICE.userId, standardRulesV1)).toThrow(GameOverError);
    expect(() => applyHold(finished, BOB.userId, standardRulesV1)).toThrow(GameOverError);
  });

  it('names the winner in the error details', () => {
    expect.assertions(2);

    try {
      applyHold(finished, ALICE.userId, standardRulesV1);
    } catch (error) {
      expect((error as GameOverError).code).toBe('GAME_OVER');
      expect((error as GameOverError).details).toEqual({ action: 'hold', winner: 0 });
    }
  });
});

describe('startNewGame', () => {
  const finished = applyHold(play(game(10), [[5, 5]]), ALICE.userId, standardRulesV1);

  it('starts the next game after a completed one, preserving win counts', () => {
    const next = startNewGame(finished, ALICE.userId);

    expect(next).toMatchObject({
      id: GAME_ID,
      players: [
        { userId: ALICE.userId, displayName: 'alice', globalScore: 0, winCount: 1 },
        { userId: BOB.userId, displayName: 'bob', globalScore: 0, winCount: 0 },
      ],
      activePlayer: 0,
      roundScore: 0,
      lastDice: null,
      gameNumber: 2,
      status: 'ACTIVE',
      winner: null,
      effect: 'NEW_GAME',
    });
  });

  it('is legal during an active game, and discards the match in progress', () => {
    const midGame = play(game(), [
      [5, 5],
      [4, 4],
    ]);
    const held = applyHold(midGame, ALICE.userId, standardRulesV1);
    const next = startNewGame(held, BOB.userId);

    expect(held.players[0].globalScore).toBe(18);
    expect(next).toMatchObject({
      players: [
        { globalScore: 0, winCount: 0 },
        { globalScore: 0, winCount: 0 },
      ],
      roundScore: 0,
      lastDice: null,
      activePlayer: 0,
      gameNumber: 2,
      status: 'ACTIVE',
      effect: 'NEW_GAME',
    });
  });

  it('resets both global scores while preserving both win counts', () => {
    // Game 1 went to Alice. Alice passes on zero in game 2 and Bob banks the
    // ten he needs, so both seats end the series on one win apiece.
    const second = startNewGame(finished, BOB.userId);
    const alicePasses = applyHold(second, ALICE.userId, standardRulesV1);
    const bobsWin = applyHold(play(alicePasses, [[5, 5]]), BOB.userId, standardRulesV1);
    const third = startNewGame(bobsWin, ALICE.userId);

    expect(third.players[0]).toMatchObject({ globalScore: 0, winCount: 1 });
    expect(third.players[1]).toMatchObject({ globalScore: 0, winCount: 1 });
    expect(third.gameNumber).toBe(3);
  });

  it('keeps the winning score when none is given', () => {
    expect(startNewGame(finished, ALICE.userId).winningScore).toBe(10);
  });

  it('may set a new winning score for the new game only', () => {
    expect(startNewGame(finished, ALICE.userId, 250).winningScore).toBe(250);
    expect(finished.winningScore).toBe(10);
  });

  it('rejects an unplayable new winning score', () => {
    expect(() => startNewGame(finished, ALICE.userId, 1)).toThrow(InvalidTargetScoreError);
    expect(() => startNewGame(finished, ALICE.userId, 1001)).toThrow(InvalidTargetScoreError);
    expect(() => startNewGame(finished, ALICE.userId, 12.5)).toThrow(InvalidTargetScoreError);
  });

  it('may be started by either player', () => {
    expect(startNewGame(finished, ALICE.userId).gameNumber).toBe(2);
    expect(startNewGame(finished, BOB.userId).gameNumber).toBe(2);
  });

  it('refuses a non-participant', () => {
    expect(() => startNewGame(finished, CAROL_ID)).toThrow(NotAParticipantError);
    expect(() => startNewGame(game(), CAROL_ID)).toThrow(NotAParticipantError);
  });

  it('preserves the ruleset and the game id', () => {
    const next = startNewGame(finished, ALICE.userId);

    expect(next.ruleset).toEqual({ id: 'standard', version: 1 });
    expect(next.id).toBe(GAME_ID);
  });

  it('refuses a game whose stored ruleset is no longer allow-listed', () => {
    const withdrawn: GameState = { ...game(), ruleset: { id: 'standard', version: 2 } };

    expect(() => startNewGame(withdrawn, ALICE.userId)).toThrow(UnsupportedRulesetError);
  });
});

describe('availableActionsFor', () => {
  it('offers roll, hold and new game to the active player', () => {
    expect(availableActionsFor(game(), ALICE.userId)).toEqual({
      canRoll: true,
      canHold: true,
      canStartNewGame: true,
    });
  });

  it('offers only new game to the seated player who is waiting', () => {
    expect(availableActionsFor(game(), BOB.userId)).toEqual({
      canRoll: false,
      canHold: false,
      canStartNewGame: true,
    });
  });

  it('offers nothing at all to a non-participant', () => {
    expect(availableActionsFor(game(), CAROL_ID)).toEqual({
      canRoll: false,
      canHold: false,
      canStartNewGame: false,
    });
  });

  it('offers only new game once the match is decided, to both players', () => {
    const finished = applyHold(play(game(10), [[5, 5]]), ALICE.userId, standardRulesV1);

    for (const userId of [ALICE.userId, BOB.userId]) {
      expect(availableActionsFor(finished, userId)).toEqual({
        canRoll: false,
        canHold: false,
        canStartNewGame: true,
      });
    }
  });

  it('offers hold on a zero round score — the decision that lets a player pass', () => {
    expect(availableActionsFor(game(), ALICE.userId).canHold).toBe(true);
  });

  it('honours a ruleset that restricts holding, when one is supplied', () => {
    const noHolding = rulesWhere({ canHold: () => false });

    expect(availableActionsFor(game(), ALICE.userId, noHolding)).toEqual({
      canRoll: true,
      canHold: false,
      canStartNewGame: true,
    });
  });

  it('agrees with standard@1 when the policy is supplied explicitly', () => {
    expect(availableActionsFor(game(), ALICE.userId, standardRulesV1)).toEqual(
      availableActionsFor(game(), ALICE.userId),
    );
  });
});

describe('immutability', () => {
  it('never mutates the state applyRoll was given', () => {
    const before = game();
    const snapshot = JSON.stringify(before);

    applyRoll(before, ALICE.userId, [3, 3], standardRulesV1);

    expect(before.roundScore).toBe(0);
    expect(before.lastDice).toBeNull();
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('never mutates the state applyHold was given', () => {
    const before = play(game(), [[4, 4]]);
    const snapshot = JSON.stringify(before);

    applyHold(before, ALICE.userId, standardRulesV1);

    expect(before.players[0].globalScore).toBe(0);
    expect(before.roundScore).toBe(8);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('never mutates the state startNewGame was given', () => {
    const before = applyHold(play(game(10), [[5, 5]]), ALICE.userId, standardRulesV1);
    const snapshot = JSON.stringify(before);

    startNewGame(before, BOB.userId, 500);

    expect(before.gameNumber).toBe(1);
    expect(before.winningScore).toBe(10);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('freezes every snapshot a transition returns, all the way down', () => {
    const rolled = applyRoll(game(), ALICE.userId, [2, 5], standardRulesV1);

    expect(Object.isFrozen(rolled)).toBe(true);
    expect(Object.isFrozen(rolled.players)).toBe(true);
    expect(Object.isFrozen(rolled.players[0])).toBe(true);
    expect(Object.isFrozen(rolled.lastDice)).toBe(true);
    expect(Object.isFrozen(rolled.ruleset)).toBe(true);
  });

  it('leaves revision alone — the persistence layer owns it', () => {
    const rolled = applyRoll(game(), ALICE.userId, [2, 5], standardRulesV1);
    const held = applyHold(rolled, ALICE.userId, standardRulesV1);
    const next = startNewGame(held, BOB.userId);

    expect(rolled.revision).toBe(0);
    expect(held.revision).toBe(0);
    expect(next.revision).toBe(0);
  });

  it('carries no timestamp — the persistence layer stamps those', () => {
    expect(game()).not.toHaveProperty('createdAt');
    expect(game()).not.toHaveProperty('updatedAt');
  });
});
