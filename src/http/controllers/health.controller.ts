import type { Request, Response } from 'express';

import type { Clock } from '../../core/ports/clock.port';

export interface HealthControllerDependencies {
  readonly clock: Clock;
  readonly version: string;
  readonly serviceName: string;
  /** Reports whether the process is accepting new work (false while draining). */
  readonly isReady: () => boolean;
}

/**
 * Liveness and readiness are answered separately and mean different things.
 *
 * - `/healthz` (liveness): "is this process wedged?" It must not depend on any
 *   downstream, or a dependency outage triggers a restart storm that turns a
 *   partial degradation into a full outage.
 * - `/readyz` (readiness): "should traffic be routed here right now?" It flips
 *   to 503 the instant SIGTERM arrives, so the load balancer drains this
 *   instance *before* the server stops accepting connections. Collapsing these
 *   two into one endpoint is the most common cause of dropped requests during
 *   a rolling deploy.
 */
export class HealthController {
  constructor(private readonly deps: HealthControllerDependencies) {}

  live = (_req: Request, res: Response): void => {
    res.status(200).json({
      status: 'ok',
      service: this.deps.serviceName,
      version: this.deps.version,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: this.deps.clock.now().toISOString(),
    });
  };

  ready = (_req: Request, res: Response): void => {
    const ready = this.deps.isReady();

    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'draining',
      service: this.deps.serviceName,
      timestamp: this.deps.clock.now().toISOString(),
    });
  };
}
