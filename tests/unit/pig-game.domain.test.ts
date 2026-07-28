import type { DieValue } from '../../src/core/domain/dice';
import {
  InvalidOpponentError,
  InvalidTargetScoreError,
  NotAParticipantError,
  NotYourTurnError,
  PIG_MAX_TARGET_SCORE,
  PIG_MIN_TARGET_SCORE,
  PigGameOverError,
  applyHold,
  applyRoll,
  createPigGame,
  isBust,
  seatOf,
  type PigGameState,
} from '../../src/core/domain/pig-game';

const ALICE = { id: 'user-alice', username: 'alice' };
const BOB = { id: 'user-bob', username: 'bob' };

function game(targetScore = 100): PigGameState {
  return createPigGame([ALICE, BOB], targetScore);
}

/** Applies a sequence of throws on behalf of whoever is currently active. */
function play(
  state: PigGameState,
  throws: readonly (readonly [DieValue, DieValue])[],
): PigGameState {
  return throws.reduce<PigGameState>(
    (current, dice) => applyRoll(current, current.players[current.activePlayer].id, dice),
    state,
  );
}

describe('Pig domain', () => {
  describe('createPigGame', () => {
    it('seats both players and starts them level', () => {
      expect(game()).toMatchObject({
        players: [ALICE, BOB],
        totalScores: [0, 0],
        currentTurnScore: 0,
        activePlayer: 0,
        isPlaying: true,
        winner: null,
        lastRoll: null,
        bustedOnLastRoll: false,
        targetScore: 100,
        version: 0,
      });
    });

    it('defends its own immutability', () => {
      const state = game();

      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.totalScores)).toBe(true);
      expect(Object.isFrozen(state.players)).toBe(true);
    });

    it.each([
      ['below the minimum', PIG_MIN_TARGET_SCORE - 1],
      ['above the maximum', PIG_MAX_TARGET_SCORE + 1],
      ['fractional', 50.5],
      ['not a number at all', Number.NaN],
    ])('rejects a winning score that is %s', (_label, target) => {
      expect(() => game(target)).toThrow(InvalidTargetScoreError);
    });

    it('accepts the exact bounds', () => {
      expect(game(PIG_MIN_TARGET_SCORE).targetScore).toBe(PIG_MIN_TARGET_SCORE);
      expect(game(PIG_MAX_TARGET_SCORE).targetScore).toBe(PIG_MAX_TARGET_SCORE);
    });

    it('refuses to seat the same identity twice', () => {
      expect(() => createPigGame([ALICE, { ...ALICE, username: 'ALICE' }], 100)).toThrow(
        InvalidOpponentError,
      );
    });
  });

  describe('seatOf', () => {
    it('locates each player and reports a stranger as unseated', () => {
      const state = game();

      expect(seatOf(state, ALICE.id)).toBe(0);
      expect(seatOf(state, BOB.id)).toBe(1);
      expect(seatOf(state, 'user-carol')).toBeNull();
    });
  });

  describe('isBust', () => {
    it('is true only for a double six', () => {
      expect(isBust([6, 6])).toBe(true);
      expect(isBust([6, 5])).toBe(false);
      expect(isBust([5, 6])).toBe(false);
      expect(isBust([1, 1])).toBe(false);
    });
  });

  describe('applyRoll', () => {
    it('adds the sum of both dice to the round score', () => {
      expect(applyRoll(game(), ALICE.id, [4, 3])).toMatchObject({
        currentTurnScore: 7,
        activePlayer: 0,
        lastRoll: [4, 3],
        bustedOnLastRoll: false,
        totalScores: [0, 0],
      });
    });

    it('accumulates across consecutive throws by the same player', () => {
      const state = play(game(), [
        [4, 3],
        [2, 2],
        [1, 5],
      ]);

      expect(state.currentTurnScore).toBe(17);
      expect(state.activePlayer).toBe(0);
    });

    it('treats a single six as an ordinary six', () => {
      const state = play(game(), [
        [6, 1],
        [3, 6],
      ]);

      expect(state.currentTurnScore).toBe(16);
      expect(state.bustedOnLastRoll).toBe(false);
      expect(state.activePlayer).toBe(0);
    });

    it('6 & 6 wipes the round score and passes the turn, leaving totals intact', () => {
      const state = play(game(), [
        [5, 5],
        [4, 4],
        [6, 6],
      ]);

      expect(state).toMatchObject({
        currentTurnScore: 0,
        activePlayer: 1,
        lastRoll: [6, 6],
        bustedOnLastRoll: true,
        totalScores: [0, 0],
      });
    });

    it('clears the bust flag on the next ordinary throw', () => {
      const busted = play(game(), [[6, 6]]);

      expect(applyRoll(busted, BOB.id, [2, 2]).bustedOnLastRoll).toBe(false);
    });

    it('never mutates the state it was given', () => {
      const before = game();
      applyRoll(before, ALICE.id, [3, 3]);

      expect(before.currentTurnScore).toBe(0);
      expect(before.lastRoll).toBeNull();
    });
  });

  describe('turn and participation enforcement', () => {
    it('refuses a roll from the player whose turn it is not', () => {
      expect(() => applyRoll(game(), BOB.id, [3, 3])).toThrow(NotYourTurnError);
    });

    it('refuses a hold from the player whose turn it is not', () => {
      expect(() => applyHold(game(), BOB.id)).toThrow(NotYourTurnError);
    });

    it('refuses any action from someone who is not seated', () => {
      expect(() => applyRoll(game(), 'user-carol', [3, 3])).toThrow(NotAParticipantError);
      expect(() => applyHold(game(), 'user-carol')).toThrow(NotAParticipantError);
    });

    it('names the active seat in the error details so a client can react', () => {
      expect.assertions(2);

      try {
        applyRoll(game(), BOB.id, [3, 3]);
      } catch (error) {
        expect(error).toBeInstanceOf(NotYourTurnError);
        expect((error as NotYourTurnError).details).toEqual({
          action: 'roll',
          actor: 1,
          activePlayer: 0,
        });
      }
    });

    it('genuinely changes hands after a bust', () => {
      const busted = play(game(), [[6, 6]]);

      expect(() => applyRoll(busted, ALICE.id, [1, 1])).toThrow(NotYourTurnError);
      expect(applyRoll(busted, BOB.id, [1, 1]).currentTurnScore).toBe(2);
    });
  });

  describe('applyHold', () => {
    it('banks the round score and passes the turn', () => {
      expect(applyHold(play(game(), [[4, 3]]), ALICE.id)).toMatchObject({
        totalScores: [7, 0],
        currentTurnScore: 0,
        activePlayer: 1,
        isPlaying: true,
        winner: null,
      });
    });

    it('is legal on a zero round score and simply forfeits the turn', () => {
      expect(applyHold(game(), ALICE.id)).toMatchObject({
        totalScores: [0, 0],
        activePlayer: 1,
        isPlaying: true,
      });
    });

    it('wins the moment the total reaches the winning score', () => {
      expect(applyHold(play(game(10), [[5, 5]]), ALICE.id)).toMatchObject({
        totalScores: [10, 0],
        isPlaying: false,
        winner: 0,
        activePlayer: 0,
      });
    });

    it('wins on overshooting it too', () => {
      expect(applyHold(play(game(10), [[6, 5]]), ALICE.id)).toMatchObject({
        totalScores: [11, 0],
        winner: 0,
        isPlaying: false,
      });
    });

    it('accumulates across turns until someone reaches the winning score', () => {
      let state = applyHold(play(game(20), [[5, 5]]), ALICE.id); // alice 10
      state = applyHold(play(state, [[4, 4]]), BOB.id); // bob 8
      state = applyHold(play(state, [[5, 5]]), ALICE.id); // alice 20 → wins

      expect(state).toMatchObject({ totalScores: [20, 8], winner: 0, isPlaying: false });
    });

    it('clears a pending bust flag', () => {
      const busted = play(game(), [[6, 6]]);

      expect(applyHold(busted, BOB.id).bustedOnLastRoll).toBe(false);
    });

    it('lets player 1 win, so seat 0 is not privileged by accident', () => {
      const afterAlice = applyHold(game(10), ALICE.id); // alice holds on 0
      const bobWins = applyHold(play(afterAlice, [[5, 5]]), BOB.id);

      expect(bobWins).toMatchObject({ totalScores: [0, 10], winner: 1, isPlaying: false });
    });
  });

  describe('once the game is over', () => {
    const finished = applyHold(play(game(10), [[5, 5]]), ALICE.id);

    it('rejects further rolls, whoever sends them', () => {
      expect(() => applyRoll(finished, ALICE.id, [1, 1])).toThrow(PigGameOverError);
      expect(() => applyRoll(finished, BOB.id, [1, 1])).toThrow(PigGameOverError);
    });

    it('rejects further holds', () => {
      expect(() => applyHold(finished, ALICE.id)).toThrow(PigGameOverError);
    });

    it('reports game-over ahead of any turn violation', () => {
      // A finished game is finished for everyone; leaking "not your turn" here
      // would describe a match that is no longer in progress.
      expect(() => applyRoll(finished, 'user-carol', [1, 1])).toThrow(PigGameOverError);
    });
  });
});
