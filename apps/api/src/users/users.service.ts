import { paginated, type PaginationQuery, userSummarySchema } from '@dice-game/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { type z } from 'zod';

import { USER_REPOSITORY, type UserRepository } from '../auth/ports/user-repository.port';
import { toUserSummary } from '../auth/user.entity';

/**
 * The paginated user list, built from the contract's own helpers.
 *
 * Composed rather than re-declared: `paginated()` and `userSummarySchema` come
 * from `@dice-game/contracts`, so a field added to either side of the wire
 * changes this type too, and a mismatch fails the build instead of the request.
 */
export const userListSchema = paginated(userSummarySchema);

export type UserList = z.infer<typeof userListSchema>;

/**
 * The opponent picker's data source.
 *
 * The projection is the whole of the security story here. `toUserSummary` emits
 * two fields — id and display name — and nothing reaches this layer that could
 * emit more, because the repository returns `UserRecord`s and only the projection
 * ever converts one for the wire. No email, no timestamps, no counts. An
 * authenticated, paginated list that happens to include email addresses is still
 * an address-harvesting endpoint.
 */
@Injectable()
export class UsersService {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  /**
   * One page of users.
   *
   * `limit` and `offset` arrive already validated and defaulted by
   * `paginationQuerySchema` (1–100, defaulting to 25), so there is no path
   * through here that reads the whole collection — which is what keeps this from
   * being a bulk-enumeration endpoint. `hasMore` is derived from what was
   * actually returned rather than from `offset + limit`, so the last page is not
   * reported as having a successor.
   */
  async list(query: PaginationQuery): Promise<UserList> {
    const { items, total } = await this.users.list(query);

    return {
      items: items.map(toUserSummary),
      total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + items.length < total,
    };
  }
}
