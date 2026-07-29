import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { diceGeneratorProvider } from './adapters/dice-generator.provider';
import { MongoGameRepository } from './adapters/mongo-game.repository';
import { GamesController } from './games.controller';
import { GamesModule } from './games.module';
import { GamesService } from './games.service';
import { GAME_REPOSITORY } from './ports/game-repository.port';

/**
 * The composition, asserted at the level of what is bound rather than by booting
 * the whole application.
 *
 * The important one is the dice: `adapters/dice-generator.provider.test.ts`
 * proves the *binding* resolves the CSPRNG outside `NODE_ENV=test`, and this
 * proves the module registers **that** provider rather than a second, laxer copy
 * of the condition. Between them, a scripted die cannot reach production without
 * one of the two failing.
 */

function providers(): readonly unknown[] {
  return (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, GamesModule) ?? []) as readonly unknown[];
}

describe('GamesModule', () => {
  it('registers the audited dice binding itself, not a copy of it', () => {
    expect(providers()).toContain(diceGeneratorProvider);
  });

  /**
   * The binding, not the behaviour — `mongo-game.repository.integration.spec.ts`
   * proves the compare-and-set against a real server. This asserts the module
   * actually reaches for it: binding the in-memory adapter in production would
   * lose every game on restart and make the revision guard process-local, and
   * both failures are silent until there are two instances.
   */
  it('binds the game repository to the Mongo adapter', () => {
    expect(providers()).toContainEqual({
      provide: GAME_REPOSITORY,
      useClass: MongoGameRepository,
    });
  });

  it('provides the service and mounts the controller', () => {
    expect(providers()).toContain(GamesService);
    expect(
      (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, GamesModule) ?? []) as readonly unknown[],
    ).toContain(GamesController);
  });
});
