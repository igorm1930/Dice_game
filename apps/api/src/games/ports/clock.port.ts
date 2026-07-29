/**
 * The wall clock, as a capability.
 *
 * `Date.now()` and `new Date()` are both blocked inside `src/domain/**` by the
 * linter, which is why the aggregate carries no timestamps at all: `createdAt`
 * and `updatedAt` are stamped by the persistence layer, and this is what it
 * stamps them from.
 *
 * Injecting it rather than reading the clock directly is what lets a repository
 * test assert "`create` stamps both timestamps, `update` moves only
 * `updatedAt`" as an equality rather than as a tolerance window.
 */
export interface Clock {
  now(): Date;
}

/** DI token for {@link Clock}. */
export const CLOCK = 'CLOCK';
