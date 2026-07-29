import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { type IdGenerator } from '../ports/id-generator.port';

/**
 * Twelve random bytes, hex-encoded — 24 characters, the shape `idSchema` in the
 * contract accepts and the shape a Mongo `ObjectId` serialises to.
 *
 * Not a real `ObjectId`: it carries no timestamp prefix and no machine or
 * counter component, so ids do not sort by creation time. That is fine here and
 * would be fine in Phase 4 too, but if the persistence layer prefers Mongo to
 * mint its own, this binding is the single line that changes — the format the
 * rest of the system depends on is identical either way.
 */
const OBJECT_ID_BYTES = 12;

@Injectable()
export class HexObjectIdGenerator implements IdGenerator {
  nextId(): string {
    return randomBytes(OBJECT_ID_BYTES).toString('hex');
  }
}
