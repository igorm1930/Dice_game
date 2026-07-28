import { Router, type RequestHandler } from 'express';

import type { PigGameController } from '../controllers/pig-game.controller';
import { newPigGameBodySchema } from '../dto/pig-game.dto';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate.middleware';

export interface PigGameRouterDependencies {
  readonly controller: PigGameController;
  readonly authenticate: RequestHandler;
}

/**
 * Pig game routes.
 *
 * Every route is authenticated — "only authenticated users can create and play
 * games" is a routing fact here, not a check a handler might forget.
 *
 * Roll and hold carry no `validate()` because they accept no request body: the
 * in-match rules live server-side and the actor is the bearer of the
 * credential. NEW GAME is the one exception — game setup names the opponent and
 * may name the winning score, validated at the edge and again by the domain.
 *
 * Deliberate action verbs rather than resource nouns: this is a single shared
 * state machine, and `POST /pig-game/rolls` would imply an addressable
 * collection that does not exist.
 */
export function createPigGameRouter(deps: PigGameRouterDependencies): Router {
  const router = Router();
  const { controller, authenticate: requireAuth } = deps;

  router.get('/pig-game', requireAuth, asyncHandler(controller.getState));
  router.post('/pig-game/roll', requireAuth, asyncHandler(controller.roll));
  router.post('/pig-game/hold', requireAuth, asyncHandler(controller.hold));
  router.post(
    '/pig-game/new-game',
    requireAuth,
    validate({ body: newPigGameBodySchema }),
    asyncHandler(controller.newGame),
  );

  return router;
}
