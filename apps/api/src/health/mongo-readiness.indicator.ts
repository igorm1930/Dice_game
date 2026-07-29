import { Injectable } from '@nestjs/common';

import { MongoConnection } from '../persistence/mongo-connection';
import { type ReadinessIndicator, type ReadinessStatus } from './readiness.port';

/**
 * Readiness, answered by actually asking MongoDB.
 *
 * This replaces the Phase 3 stub, which reported `'up'` unconditionally because
 * there was no database to be down. With one, an unconditional `'up'` is worse
 * than no check at all: the load balancer would keep routing to an instance
 * whose every request 500s, and the probe would be a green light wired to
 * nothing.
 *
 * `MongoConnection.ping` round-trips a real command and never throws, so this
 * cannot block indefinitely (`serverSelectionTimeoutMS` bounds it) and cannot
 * turn a dependency outage into a 500. Liveness is untouched and still consults
 * nothing — a liveness probe that reached the database would convert a Mongo
 * blip into a restart loop, which is strictly worse than the blip.
 */
@Injectable()
export class MongoReadinessIndicator implements ReadinessIndicator {
  constructor(private readonly mongo: MongoConnection) {}

  async check(): Promise<ReadinessStatus> {
    return (await this.mongo.ping()) ? 'up' : 'down';
  }
}
