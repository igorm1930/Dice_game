import { type Liveness, type Readiness, ROUTES } from '@dice-game/contracts';
import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';

import { APP_CONFIG } from '../config/config.module';
import { type AppConfig } from '../config/env.schema';
import { Public } from '../common/decorators/public.decorator';
import { SkipRateLimit } from '../common/decorators/rate-limit.decorator';
import { DrainState } from '../common/lifecycle/drain-state';
import { MONGO_READINESS_INDICATOR, type ReadinessIndicator } from './readiness.port';

/**
 * Two probes answering two different questions. Conflating them is how a
 * database blip gets a healthy container killed and restarted into the same
 * blip.
 *
 * Both are `Public()` — they are on the contract's `PUBLIC_ROUTES` allow-list —
 * and both skip rate limiting, because an orchestrator polling every few seconds
 * from one address would otherwise exhaust its own budget and read the 429 as
 * "unhealthy".
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MONGO_READINESS_INDICATOR) private readonly mongo: ReadinessIndicator,
    private readonly drain: DrainState,
  ) {}

  /**
   * `GET /api/health/live` — is the process running?
   *
   * Touches nothing. No database, no cache, no outbound call. A liveness probe
   * that consults a dependency turns an outage in that dependency into a restart
   * loop, which is strictly worse than the outage.
   */
  @Public()
  @SkipRateLimit()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe', operationId: 'live' })
  live(): Liveness {
    return {
      status: 'ok',
      uptime: process.uptime(),
      version: this.config.observability.serviceVersion,
    };
  }

  /**
   * `GET /api/health/ready` — should this instance receive traffic?
   *
   * Reports the MongoDB check, and answers `not_ready` the instant a SIGTERM
   * drain begins — before the listener closes — so the load balancer stops
   * sending work while in-flight requests can still finish.
   *
   * Answers 503 when not ready. The payload is the contract's `readinessSchema`
   * either way; the status is what an orchestrator actually reads.
   */
  @Public()
  @SkipRateLimit()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe', operationId: 'ready' })
  async ready(@Res({ passthrough: true }) response: Response): Promise<Readiness> {
    const mongo = await this.checkMongo();
    const ready = !this.drain.isDraining && mongo === 'up';

    response.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: ready ? 'ready' : 'not_ready',
      checks: { mongo },
    };
  }

  /**
   * A probe must answer, always. An indicator that throws is a dependency that
   * is down, not a 500 — a failing probe that returns no body reads to most
   * orchestrators as a timeout, which is a slower and less specific signal.
   */
  private async checkMongo(): Promise<Readiness['checks']['mongo']> {
    try {
      return await this.mongo.check();
    } catch {
      return 'down';
    }
  }
}

/**
 * The paths this controller must serve, as the contract names them. Read by
 * `health.controller.test`-style assertions and by anyone checking the global
 * prefix still lines up.
 */
export const HEALTH_ROUTES = ROUTES.health;
