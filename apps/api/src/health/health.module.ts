import { Module } from '@nestjs/common';

import { DrainState } from '../common/lifecycle/drain-state';
import { HealthController } from './health.controller';
import { MONGO_READINESS_INDICATOR } from './readiness.port';
import { StubReadinessIndicator } from './stub-readiness.indicator';

/**
 * The probes, and the seam Phase 4 grows into.
 *
 * `MONGO_READINESS_INDICATOR` is bound to a stub that always reports `'up'`
 * because there is no database yet. When persistence lands, this binding is the
 * only line that changes — the controller depends on the port, not the adapter.
 *
 * `DrainState` is provided (and exported) here because readiness is the thing
 * that consumes it, but `main.ts` resolves it too: the SIGTERM handler flips it
 * before closing the server.
 */
@Module({
  controllers: [HealthController],
  providers: [
    DrainState,
    {
      provide: MONGO_READINESS_INDICATOR,
      useClass: StubReadinessIndicator,
    },
  ],
  exports: [DrainState],
})
export class HealthModule {}
