import type { Request, Response } from 'express';

import type { GameService } from '../../core/services/game.service';
import type { PaginatedData, SuccessResponse } from '../dto/api-response';
import type {
  CreateGameBody,
  GameIdParams,
  GameResponse,
  LeaderboardEntryResponse,
  LeaderboardQuery,
  ListGamesQuery,
  RollResponse,
} from '../dto/game.dto';
import { toGameResponse, toLeaderboardResponse, toRoundResponse } from '../mappers/game.mapper';
import { validated } from '../middleware/validate.middleware';

/**
 * HTTP adapter for the game use cases.
 *
 * Strictly translation: read validated input, call the service, map the result,
 * choose a status code. There is no branching on business state here — a
 * controller that decides whether a game is finished is a controller that has
 * absorbed the domain.
 *
 * Errors are not caught. They propagate to the global error middleware, which
 * owns the code→status mapping. A try/catch in every controller is duplicated
 * policy that inevitably drifts.
 *
 * Handlers are arrow-function properties so they stay bound when passed as
 * bare references to the router.
 */
export class GameController {
  constructor(private readonly gameService: GameService) {}

  createGame = async (req: Request, res: Response): Promise<void> => {
    const body = validated<CreateGameBody>(req, 'body');

    const game = await this.gameService.createGame({
      playerName: body.playerName,
      rounds: body.rounds,
    });

    res
      .status(201)
      .location(`/api/v1/games/${game.id}`)
      .json(this.ok<GameResponse>(req, toGameResponse(game)));
  };

  getGame = async (req: Request, res: Response): Promise<void> => {
    const { gameId } = validated<GameIdParams>(req, 'params');

    const game = await this.gameService.getGame(gameId);

    res.status(200).json(this.ok<GameResponse>(req, toGameResponse(game)));
  };

  rollDice = async (req: Request, res: Response): Promise<void> => {
    const { gameId } = validated<GameIdParams>(req, 'params');

    const { game, round } = await this.gameService.rollDice(gameId);

    // 201: a roll creates a round, which is a new addressable sub-resource.
    res.status(201).json(
      this.ok<RollResponse>(req, {
        round: toRoundResponse(round),
        game: toGameResponse(game),
      }),
    );
  };

  listGames = async (req: Request, res: Response): Promise<void> => {
    const { limit, offset } = validated<ListGamesQuery>(req, 'query');

    const page = await this.gameService.listGames({ limit, offset });

    res.status(200).json(
      this.ok<PaginatedData<GameResponse>>(req, {
        items: page.items.map(toGameResponse),
        pagination: {
          total: page.total,
          limit: page.limit,
          offset: page.offset,
          hasMore: page.offset + page.items.length < page.total,
        },
      }),
    );
  };

  getLeaderboard = async (req: Request, res: Response): Promise<void> => {
    const { limit } = validated<LeaderboardQuery>(req, 'query');

    const games = await this.gameService.getLeaderboard(limit);

    res
      .status(200)
      .json(this.ok<readonly LeaderboardEntryResponse[]>(req, toLeaderboardResponse(games)));
  };

  private ok<T>(req: Request, data: T): SuccessResponse<T> {
    return {
      data,
      meta: {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
