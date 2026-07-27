import { Router } from 'express';

import type { GameController } from '../controllers/game.controller';
import {
  createGameBodySchema,
  gameIdParamsSchema,
  leaderboardQuerySchema,
  listGamesQuerySchema,
} from '../dto/game.dto';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate.middleware';

/**
 * Game routes.
 *
 * Every handler is wrapped in `asyncHandler` — without it a rejected promise
 * silently hangs the request in Express 4. Every route declares its schemas up
 * front, so the contract is readable without opening the controller.
 */
export function createGameRouter(controller: GameController): Router {
  const router = Router();

  router.post(
    '/games',
    validate({ body: createGameBodySchema }),
    asyncHandler(controller.createGame),
  );

  router.get(
    '/games',
    validate({ query: listGamesQuerySchema }),
    asyncHandler(controller.listGames),
  );

  router.get(
    '/games/:gameId',
    validate({ params: gameIdParamsSchema }),
    asyncHandler(controller.getGame),
  );

  router.post(
    '/games/:gameId/rolls',
    validate({ params: gameIdParamsSchema }),
    asyncHandler(controller.rollDice),
  );

  router.get(
    '/leaderboard',
    validate({ query: leaderboardQuerySchema }),
    asyncHandler(controller.getLeaderboard),
  );

  return router;
}
