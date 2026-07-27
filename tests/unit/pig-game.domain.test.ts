import type { DieValue } from '../../src/core/domain/dice';
import {
  InvalidTargetScoreError,
  PigGameOverError,
  applyHold,
  applyRoll,
  createPigGame,
  type PigGameState,
} from '../../src/core/domain/pig-game';

/** Small target keeps winning sequences short; the rule is target-agnostic. */
const TARGET = 20;

function play(state: PigGameState, dice: DieValue[]): PigGameState {
  return dice.reduce((s, die) => applyRoll(s, die), state);
}

describe('createPigGame', () => {
  it('starts with player 0 active, zero scores, and no winner', () => {
    expect(createPigGame(TARGET)).toEqual({
      totalScores: [0, 0],
      currentTurnScore: 0,
      activePlayer: 0,
      isPlaying: true,
      winner: null,
      lastRoll: null,
      targetScore: TARGET,
      version: 0,
    });
  });

  it('carries the chosen target score', () => {
    expect(createPigGame(250).targetScore).toBe(250);
  });

  it.each([1, 0, -5, 1001, 2.5, Number.NaN])('rejects unplayable target %s', (target) => {
    expect(() => createPigGame(target)).toThrow(InvalidTargetScoreError);
  });

  it('accepts the boundary targets', () => {
    expect(createPigGame(2).targetScore).toBe(2);
    expect(createPigGame(1000).targetScore).toBe(1000);
  });

  it('reports the offending value and bounds on the error', () => {
    expect.assertions(1);

    try {
      createPigGame(5000);
    } catch (error) {
      expect((error as InvalidTargetScoreError).details).toEqual({
        requested: 5000,
        min: 2,
        max: 1000,
      });
    }
  });
});

describe('applyRoll', () => {
  it('adds 1-5 to the current turn score and records the die', () => {
    const state = applyRoll(createPigGame(TARGET), 5);

    expect(state.currentTurnScore).toBe(5);
    expect(state.lastRoll).toBe(5);
    expect(state.activePlayer).toBe(0);
  });

  it('accumulates across consecutive rolls, including 1s', () => {
    const state = play(createPigGame(TARGET), [2, 1, 5]);

    expect(state.currentTurnScore).toBe(8);
    expect(state.lastRoll).toBe(5);
  });

  it('a 6 busts: wipes the turn score and switches the active player', () => {
    const built = play(createPigGame(TARGET), [5, 5]);

    const busted = applyRoll(built, 6);

    expect(busted.currentTurnScore).toBe(0);
    expect(busted.activePlayer).toBe(1);
    expect(busted.lastRoll).toBe(6);
    // Banked totals are untouched — only the turn score is lost.
    expect(busted.totalScores).toEqual([0, 0]);
  });

  it('a 6 switches back from player 1 to player 0', () => {
    const p1Turn = applyRoll(createPigGame(TARGET), 6); // player 0 busts -> player 1
    const backAgain = applyRoll(p1Turn, 6); // player 1 busts -> player 0

    expect(backAgain.activePlayer).toBe(0);
  });

  it('does not mutate the previous snapshot', () => {
    const before = createPigGame(TARGET);

    applyRoll(before, 4);

    expect(before.currentTurnScore).toBe(0);
    expect(before.lastRoll).toBeNull();
  });

  it('refuses to roll a finished game', () => {
    const finished = applyHold(play(createPigGame(TARGET), [5, 5, 5, 5]));

    expect(() => applyRoll(finished, 4)).toThrow(PigGameOverError);
  });
});

describe('applyHold', () => {
  it('banks the turn score and switches the active player', () => {
    const held = applyHold(play(createPigGame(TARGET), [5, 4]));

    expect(held.totalScores).toEqual([9, 0]);
    expect(held.currentTurnScore).toBe(0);
    expect(held.activePlayer).toBe(1);
    expect(held.isPlaying).toBe(true);
    expect(held.winner).toBeNull();
  });

  it('holding with nothing accrued forfeits the turn without scoring', () => {
    const held = applyHold(createPigGame(TARGET));

    expect(held.totalScores).toEqual([0, 0]);
    expect(held.activePlayer).toBe(1);
  });

  it('wins the game when the banked total reaches the target exactly', () => {
    const finished = applyHold(play(createPigGame(TARGET), [5, 5, 5, 5]));

    expect(finished.totalScores).toEqual([20, 0]);
    expect(finished.isPlaying).toBe(false);
    expect(finished.winner).toBe(0);
    // The winner stays the active player so the UI can highlight them.
    expect(finished.activePlayer).toBe(0);
  });

  it('wins when the banked total exceeds the target', () => {
    const finished = applyHold(play(createPigGame(TARGET), [5, 5, 5, 4, 3]));

    expect(finished.totalScores).toEqual([22, 0]);
    expect(finished.winner).toBe(0);
  });

  it('the win respects the game-specific target, not a global one', () => {
    const smallGame = applyHold(play(createPigGame(5), [3, 2]));
    expect(smallGame.winner).toBe(0);

    const bigGame = applyHold(play(createPigGame(500), [5, 5, 5, 5]));
    expect(bigGame.winner).toBeNull();
    expect(bigGame.isPlaying).toBe(true);
  });

  it('accumulates across turns before a win', () => {
    // P0 banks 9, P1 banks 10, P0 banks 12 -> P0 wins at 21.
    let state = applyHold(play(createPigGame(TARGET), [5, 4]));
    state = applyHold(play(state, [5, 5]));
    state = applyHold(play(state, [4, 4, 4]));

    expect(state.totalScores).toEqual([21, 10]);
    expect(state.winner).toBe(0);
    expect(state.isPlaying).toBe(false);
  });

  it('player 1 can win too', () => {
    const p1sTurn = applyRoll(createPigGame(TARGET), 6); // hand play to player 1
    const finished = applyHold(play(p1sTurn, [5, 5, 5, 5]));

    expect(finished.totalScores).toEqual([0, 20]);
    expect(finished.winner).toBe(1);
  });

  it('refuses to hold a finished game and reports the winner', () => {
    expect.assertions(2);
    const finished = applyHold(play(createPigGame(TARGET), [5, 5, 5, 5]));

    try {
      applyHold(finished);
    } catch (error) {
      expect(error).toBeInstanceOf(PigGameOverError);
      expect((error as PigGameOverError).details).toEqual({ action: 'hold', winner: 0 });
    }
  });

  it('leaves the version untouched — versioning belongs to the repository', () => {
    const held = applyHold(play(createPigGame(TARGET), [3, 4]));

    expect(held.version).toBe(0);
  });
});
