import { Router } from 'express';

import type { PigGameController } from '../controllers/pig-game.controller';
import { asyncHandler } from '../middleware/async-handler';

/**
 * Pig game routes.
 *
 * No `validate()` middleware appears here because the action endpoints accept
 * no request body — the backend is the sole source of truth for the rules, so
 * there is nothing a client could legitimately send (see pig-game.dto.ts).
 * Deliberate action verbs rather than resource nouns: this is a singleton
 * state machine, and `POST /pig-game/rolls` would imply an addressable
 * collection that does not exist.
 */
export function createPigGameRouter(controller: PigGameController): Router {
  const router = Router();

  router.get('/pig-game', asyncHandler(controller.getState));
  router.post('/pig-game/roll', asyncHandler(controller.roll));
  router.post('/pig-game/hold', asyncHandler(controller.hold));
  router.post('/pig-game/new-game', asyncHandler(controller.newGame));

  return router;
}
