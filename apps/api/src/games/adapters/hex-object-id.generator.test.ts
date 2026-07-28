import { idSchema } from '@dice-game/contracts';
import { describe, expect, it } from 'vitest';

import { HexObjectIdGenerator } from './hex-object-id.generator';

/**
 * The id format is part of the wire contract — `ROUTES.games.byId` puts it
 * straight into a URL the client then validates — so it is asserted against
 * `idSchema` itself rather than against a regex copied next to it.
 */
describe('HexObjectIdGenerator', () => {
  const generator = new HexObjectIdGenerator();

  it('mints ids the contract accepts', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(idSchema.safeParse(generator.nextId())).toMatchObject({ success: true });
    }
  });

  it('does not repeat itself', () => {
    const ids = new Set<string>();

    for (let i = 0; i < 1000; i += 1) {
      ids.add(generator.nextId());
    }

    expect(ids.size).toBe(1000);
  });
});
