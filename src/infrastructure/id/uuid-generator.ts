import { randomUUID } from 'node:crypto';

import type { IdGenerator } from '../../core/ports/id-generator.port';

export class UuidGenerator implements IdGenerator {
  generate(): string {
    return randomUUID();
  }
}
