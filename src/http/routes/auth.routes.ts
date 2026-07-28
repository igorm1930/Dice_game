import { Router, type RequestHandler } from 'express';

import type { AuthController } from '../controllers/auth.controller';
import { credentialsBodySchema } from '../dto/auth.dto';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate.middleware';

export interface AuthRouterDependencies {
  readonly controller: AuthController;
  /** Resolves the bearer credential for the routes that need one. */
  readonly authenticate: RequestHandler;
  /**
   * Tighter limiter for the credential endpoints. The global API limit is
   * sized for gameplay; leaving login on it would allow thousands of password
   * guesses an hour from one address.
   */
  readonly credentialLimiter: RequestHandler;
}

export function createAuthRouter(deps: AuthRouterDependencies): Router {
  const router = Router();
  const { controller, authenticate: requireAuth, credentialLimiter } = deps;

  router.post(
    '/auth/register',
    credentialLimiter,
    validate({ body: credentialsBodySchema }),
    asyncHandler(controller.register),
  );

  router.post(
    '/auth/login',
    credentialLimiter,
    validate({ body: credentialsBodySchema }),
    asyncHandler(controller.login),
  );

  router.post('/auth/logout', requireAuth, asyncHandler(controller.logout));
  router.get('/auth/me', requireAuth, asyncHandler(controller.me));

  return router;
}
