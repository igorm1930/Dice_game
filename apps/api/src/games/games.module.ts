import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { diceGeneratorProvider } from './adapters/dice-generator.provider';
import { HexObjectIdGenerator } from './adapters/hex-object-id.generator';
import { MongoGameRepository } from './adapters/mongo-game.repository';
import { SystemClock } from './adapters/system-clock';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { CLOCK } from './ports/clock.port';
import { GAME_REPOSITORY } from './ports/game-repository.port';
import { ID_GENERATOR } from './ports/id-generator.port';

/**
 * Gameplay: the five commands, and the four capabilities the domain refuses to
 * own.
 *
 * Every provider below is a port bound to an adapter, so the whole seam is
 * visible from this one file:
 *
 *  - `GAME_REPOSITORY` → Mongoose. The compare-and-set is a single
 *    `findOneAndUpdate` matched on `{ _id, revision }`; nothing above this line
 *    moved when it replaced the `Map`, because the port already had the shape
 *    optimistic concurrency needs. `InMemoryGameRepository` stays beside it —
 *    every service test uses it, and requiring a database to test a transition
 *    would be a worse trade than keeping two adapters.
 *  - `DICE_GENERATOR` → `node:crypto`, except under `NODE_ENV=test`. See
 *    `adapters/dice-generator.provider.ts` and the test beside it; a scripted
 *    die that shipped would hand the outcome of every match to anyone who read
 *    this repository.
 *  - `ID_GENERATOR` → 24 hex characters, the shape the contract's `idSchema`
 *    accepts and a Mongo `ObjectId` serialises to.
 *  - `CLOCK` → the wall clock, read in exactly one place.
 *
 * `AuthModule` is imported for `USER_REPOSITORY` alone: creating a game means
 * resolving the named opponent, and the user store belongs to that module. The
 * games module imports the token and the interface, never a copy of either.
 */
@Module({
  imports: [AuthModule, PersistenceModule],
  controllers: [GamesController],
  providers: [
    GamesService,
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: HexObjectIdGenerator },
    { provide: GAME_REPOSITORY, useClass: MongoGameRepository },
    diceGeneratorProvider,
  ],
})
export class GamesModule {}
