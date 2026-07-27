import { Router } from 'express';

import type { HealthController } from '../controllers/health.controller';

/**
 * Probe routes.
 *
 * Mounted at the root, outside `/api/v1`, and deliberately not rate limited or
 * versioned: probes are infrastructure contract, not application API, and must
 * keep answering when the API itself is shedding load.
 */
export function createHealthRouter(controller: HealthController): Router {
  const router = Router();

  router.get('/healthz', controller.live);
  router.get('/readyz', controller.ready);

  return router;
}
