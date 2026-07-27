import type { DieValue } from '../../src/core/domain/dice';
import {
  PigGameOverError,
  applyHold,
  applyRoll,
  createPigGame,
  type PigGameState,
} from '../../src/core/domain/pig-game';

const TARGET = 20;

function play(state: PigGameState, dice: DieValue[]): PigGameState {
  return dice.reduce((s, die) => applyRoll(s, die), state);
}

describe('createPigGame', () => {
  it('starts with player 0 active, zero scores, and no winner', () => {
    expect(createPigGame()).toEqual({
      totalScores: [0, 0],
      currentTurnScore: 0,
      activePlayer: 0,
      isPlaying: true,
      winner: null,
      lastRoll: null,
      version: 0,
    });
  });
});

describe('applyRoll', () => {
  it('adds 2-6 to the current turn score and records the die', () => {
    const state = applyRoll(createPigGame(), 5);

    expect(state.currentTurnScore).toBe(5);
    expect(state.lastRoll).toBe(5);
    expect(state.activePlayer).toBe(0);
  });

  it('accumulates across consecutive rolls', () => {
    const state = play(createPigGame(), [2, 3, 6]);

    expect(state.currentTurnScore).toBe(11);
    expect(state.lastRoll).toBe(6);
  });

  it('a 1 wipes the turn score and switches the active player', () => {
    const built = play(createPigGame(), [6, 6]);

    const busted = applyRoll(built, 1);

    expect(busted.currentTurnScore).toBe(0);
    expect(busted.activePlayer).toBe(1);
    expect(busted.lastRoll).toBe(1);
    // Banked totals are untouched — only the turn score is lost.
    expect(busted.totalScores).toEqual([0, 0]);
  });

  it('a 1 switches back from player 1 to player 0', () => {
    const p1Turn = applyRoll(createPigGame(), 1); // player 0 busts -> player 1
    const backAgain = applyRoll(p1Turn, 1); // player 1 busts -> player 0

    expect(backAgain.activePlayer).toBe(0);
  });

  it('does not mutate the previous snapshot', () => {
    const before = createPigGame();

    applyRoll(before, 6);

    expect(before.currentTurnScore).toBe(0);
    expect(before.lastRoll).toBeNull();
  });

  it('refuses to roll a finished game', () => {
    const finished = applyHold(play(createPigGame(), [6, 6, 6, 6]), TARGET);

    expect(() => applyRoll(finished, 4)).toThrow(PigGameOverError);
  });
});

describe('applyHold', () => {
  it('banks the turn score and switches the active player', () => {
    const held = applyHold(play(createPigGame(), [6, 4]), TARGET);

    expect(held.totalScores).toEqual([10, 0]);
    expect(held.currentTurnScore).toBe(0);
    expect(held.activePlayer).toBe(1);
    expect(held.isPlaying).toBe(true);
    expect(held.winner).toBeNull();
  });

  it('holding with nothing accrued forfeits the turn without scoring', () => {
    const held = applyHold(createPigGame(), TARGET);

    expect(held.totalScores).toEqual([0, 0]);
    expect(held.activePlayer).toBe(1);
  });

  it('wins the game when the banked total reaches the target exactly', () => {
    const finished = applyHold(play(createPigGame(), [6, 6, 4, 4]), TARGET);

    expect(finished.totalScores).toEqual([20, 0]);
    expect(finished.isPlaying).toBe(false);
    expect(finished.winner).toBe(0);
    // The winner stays the active player so the UI can highlight them.
    expect(finished.activePlayer).toBe(0);
  });

  it('wins when the banked total exceeds the target', () => {
    const finished = applyHold(play(createPigGame(), [6, 6, 6, 6]), TARGET);

    expect(finished.totalScores).toEqual([24, 0]);
    expect(finished.winner).toBe(0);
  });

  it('accumulates across turns before a win', () => {
    // P0 banks 10, P1 banks 10, P0 banks 12 -> P0 wins at 22.
    let state = applyHold(play(createPigGame(), [6, 4]), TARGET);
    state = applyHold(play(state, [4, 6]), TARGET);
    state = applyHold(play(state, [6, 6]), TARGET);

    expect(state.totalScores).toEqual([22, 10]);
    expect(state.winner).toBe(0);
    expect(state.isPlaying).toBe(false);
  });

  it('player 1 can win too', () => {
    const p1sTurn = applyRoll(createPigGame(), 1); // hand play to player 1
    const finished = applyHold(play(p1sTurn, [6, 6, 6, 6]), TARGET);

    expect(finished.totalScores).toEqual([0, 24]);
    expect(finished.winner).toBe(1);
  });

  it('refuses to hold a finished game and reports the winner', () => {
    expect.assertions(2);
    const finished = applyHold(play(createPigGame(), [6, 6, 6, 6]), TARGET);

    try {
      applyHold(finished, TARGET);
    } catch (error) {
      expect(error).toBeInstanceOf(PigGameOverError);
      expect((error as PigGameOverError).details).toEqual({ action: 'hold', winner: 0 });
    }
  });

  it('leaves the version untouched — versioning belongs to the repository', () => {
    const held = applyHold(play(createPigGame(), [3, 4]), TARGET);

    expect(held.version).toBe(0);
  });
});
