import type { PlayerIdentity } from '../../core/domain/user';
import type { PigGameView } from '../../core/services/pig-game.service';
import type { PlayerResponse } from '../dto/auth.dto';
import type { PigGameResponse } from '../dto/pig-game.dto';

/**
 * Domain → wire. Explicit field-by-field, same as the rounds game: `version` is
 * an implementation detail of optimistic locking and never crosses this
 * boundary, and a player is projected without their password hash by
 * construction rather than by remembering to delete it.
 */
export function toPigGameResponse(view: PigGameView): PigGameResponse {
  const { state } = view;

  return {
    players: [toPlayerResponse(view.players[0]), toPlayerResponse(view.players[1])],
    totalScores: [state.totalScores[0], state.totalScores[1]],
    currentTurnScore: state.currentTurnScore,
    activePlayer: state.activePlayer,
    isPlaying: state.isPlaying,
    winner: state.winner,
    lastRoll: state.lastRoll === null ? null : [state.lastRoll[0], state.lastRoll[1]],
    bustedOnLastRoll: state.bustedOnLastRoll,
    targetScore: state.targetScore,
    viewerSeat: view.viewerSeat,
  };
}

export function toPlayerResponse(player: PlayerIdentity): PlayerResponse {
  return { id: player.id, username: player.username, wins: player.wins };
}
