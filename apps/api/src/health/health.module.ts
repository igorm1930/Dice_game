import { Module } from '@nestjs/common';

import { DrainState } from '../common/lifecycle/drain-state';
import { PersistenceModule } from '../persistence/persistence.module';
import { HealthController } from './health.controller';
import { MongoReadinessIndicator } from './mongo-readiness.indicator';
import { MONGO_READINESS_INDICATOR } from './readiness.port';

/**
 * The probes.
 *
 * `MONGO_READINESS_INDICATOR` is bound to an adapter that pings MongoDB. This
 * binding is the only line that changed when persistence landed — the
 * controller depends on the port, not on the adapter, and knows nothing about a
 * driver.
 *
 * `DrainState` is provided (and exported) here because readiness is the thing
 * that consumes it, but `main.ts` resolves it too: the SIGTERM handler flips it
 * before closing the server.
 */
@Module({
  imports: [PersistenceModule],
  controllers: [HealthController],
  providers: [
    DrainState,
    {
      provide: MONGO_READINESS_INDICATOR,
      useClass: MongoReadinessIndicator,
    },
  ],
  exports: [DrainState],
})
export class HealthModule {}
