import { Router } from 'express';

import type { PigGameController } from '../controllers/pig-game.controller';
import { newPigGameBodySchema } from '../dto/pig-game.dto';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate.middleware';

/**
 * Pig game routes.
 *
 * Roll and hold carry no `validate()` because they accept no request body —
 * the in-match rules live server-side, so there is nothing a client could
 * legitimately send (see pig-game.dto.ts). NEW GAME is the one exception:
 * game setup may name a target score, validated at the edge and again by the
 * domain. Deliberate action verbs rather than resource nouns: this is a
 * singleton state machine, and `POST /pig-game/rolls` would imply an
 * addressable collection that does not exist.
 */
export function createPigGameRouter(controller: PigGameController): Router {
  const router = Router();

  router.get('/pig-game', asyncHandler(controller.getState));
  router.post('/pig-game/roll', asyncHandler(controller.roll));
  router.post('/pig-game/hold', asyncHandler(controller.hold));
  router.post(
    '/pig-game/new-game',
    validate({ body: newPigGameBodySchema }),
    asyncHandler(controller.newGame),
  );

  return router;
}
