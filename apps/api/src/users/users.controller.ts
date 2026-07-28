import { type PaginationQuery, paginationQuerySchema, ROUTES } from '@dice-game/contracts';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodQuery } from '../common/pipes/zod-validation.pipe';
import { type UserList, UsersService } from './users.service';

/**
 * `GET /api/users` — the list the opponent picker renders, and the only route
 * this module mounts.
 *
 * **It carries no `@Public()`**, which is what protects it: the global
 * `JwtAuthGuard` denies by default, and the contract's `PUBLIC_ROUTES` names
 * only register, login and the two health probes. An unauthenticated user list
 * is a user-enumeration endpoint however innocuous the two fields look, and an
 * unbounded one is the same endpoint with a faster download.
 *
 * The query is the contract's `paginationQuerySchema`, which is `.strict()` and
 * bounded: `limit` is 1–100 with a default of 25, `offset` is non-negative, and
 * an unrecognised parameter is a `VALIDATION_ERROR` rather than something
 * quietly ignored.
 */
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List users to pick an opponent from',
    description: 'Authenticated and paginated. Returns id and display name only — never an email.',
    operationId: 'listUsers',
  })
  list(@ZodQuery(paginationQuerySchema) query: PaginationQuery): Promise<UserList> {
    return this.users.list(query);
  }
}

/** The path this controller must serve, as the contract names it. */
export const USERS_ROUTES = ROUTES.users;
