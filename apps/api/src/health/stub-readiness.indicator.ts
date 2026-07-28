import { Injectable } from '@nestjs/common';

import { type ReadinessIndicator, type ReadinessStatus } from './readiness.port';

/**
 * The Phase 3 stand-in: there is no database yet, so nothing can be down.
 *
 * It reports `'up'` unconditionally, which is honest for a build with no
 * persistence and dishonest the moment there is one — so this class is the
 * marker for the seam. Phase 4 binds a real adapter to
 * `MONGO_READINESS_INDICATOR` and deletes this file; nothing else moves.
 */
@Injectable()
export class StubReadinessIndicator implements ReadinessIndicator {
  check(): Promise<ReadinessStatus> {
    return Promise.resolve('up');
  }
}
