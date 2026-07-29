import { Module } from '@nestjs/common';

import { AppConfigModule } from '../config/config.module';
import { MongoConnection } from './mongo-connection';

/**
 * The MongoDB connection, and nothing else.
 *
 * Deliberately **not** `@Global()`. Configuration is global because every layer
 * legitimately reads it; a database connection is not — exactly three modules
 * touch storage (auth, games, health), and each one says so by importing this.
 * A global connection would make "which parts of this application talk to the
 * database?" a question you answer by grepping rather than by reading a module.
 *
 * The adapters themselves live beside the ports they implement, in the modules
 * that own them, so this module exports the connection rather than the
 * repositories: the games module binds `GAME_REPOSITORY`, the auth module binds
 * `USER_REPOSITORY`, and neither learns anything about the other's schema.
 */
@Module({
  imports: [AppConfigModule],
  providers: [MongoConnection],
  exports: [MongoConnection],
})
export class PersistenceModule {}
