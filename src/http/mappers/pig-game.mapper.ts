import type { PigGameState } from '../../core/domain/pig-game';
import type { PigGameResponse } from '../dto/pig-game.dto';

/**
 * Domain → wire. Explicit field-by-field, same as the rounds game: `version`
 * is an implementation detail of optimistic locking and never crosses this
 * boundary.
 */
export function toPigGameResponse(state: PigGameState, targetScore: number): PigGameResponse {
  return {
    totalScores: [state.totalScores[0], state.totalScores[1]],
    currentTurnScore: state.currentTurnScore,
    activePlayer: state.activePlayer,
    isPlaying: state.isPlaying,
    winner: state.winner,
    lastRoll: state.lastRoll,
    targetScore,
  };
}
