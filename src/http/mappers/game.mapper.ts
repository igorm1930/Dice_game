import { remainingRounds, type Game, type Round } from '../../core/domain/game';
import type { GameResponse, LeaderboardEntryResponse, RoundResponse } from '../dto/game.dto';

/**
 * Anti-corruption layer between the domain model and the wire format.
 *
 * Explicit field-by-field mapping is the point. It costs a few lines and buys
 * an API that cannot accidentally leak a newly added internal field — note that
 * `version`, an implementation detail of optimistic locking, never crosses this
 * boundary.
 */
export function toRoundResponse(round: Round): RoundResponse {
  return {
    index: round.index,
    dice: [round.dice.first, round.dice.second],
    pips: round.pips,
    outcome: round.outcome,
    points: round.points,
    scoreAfter: round.scoreAfter,
    rolledAt: round.rolledAt,
  };
}

export function toGameResponse(game: Game): GameResponse {
  return {
    id: game.id,
    playerName: game.playerName,
    status: game.status,
    totalRounds: game.totalRounds,
    roundsPlayed: game.rounds.length,
    roundsRemaining: remainingRounds(game),
    totalScore: game.totalScore,
    rounds: game.rounds.map(toRoundResponse),
    createdAt: game.createdAt,
    completedAt: game.completedAt,
  };
}

export function toLeaderboardResponse(games: readonly Game[]): readonly LeaderboardEntryResponse[] {
  return games.map((game, position) => ({
    rank: position + 1,
    gameId: game.id,
    playerName: game.playerName,
    totalScore: game.totalScore,
    totalRounds: game.totalRounds,
    completedAt: game.completedAt,
  }));
}
