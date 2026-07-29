import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * The user directory.
 *
 * It owns no store of its own: `AuthModule` exports `USER_REPOSITORY`, and this
 * module reads through that port. One user collection, one adapter, one place
 * for Phase 4 to swap in Mongoose — a second repository here would be a second
 * copy of the same rows that could disagree with the first.
 *
 * The dependency points this way round because identity is authentication's
 * concern: the users module presents a *projection* of user records for the
 * opponent picker, and has no business creating, authenticating or revoking one.
 */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
