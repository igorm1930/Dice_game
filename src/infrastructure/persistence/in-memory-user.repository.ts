import { UsernameTakenError, usernameKeyOf, type User } from '../../core/domain/user';
import type { UserRepository } from '../../core/ports/user-repository.port';

/**
 * In-memory adapter for {@link UserRepository}.
 *
 * Two maps rather than one: `byId` is the primary store and `byUsernameKey` is
 * the unique index that makes registration collisions a store-level guarantee
 * instead of a check-then-write race in the service.
 *
 * Same snapshot-isolation discipline as the other repositories — callers never
 * receive a reference they could mutate into the store (ADR-0001).
 */
export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, User>();
  private readonly byUsernameKey = new Map<string, string>();

  create(user: User): Promise<User> {
    if (this.byUsernameKey.has(user.usernameKey)) {
      return Promise.reject(new UsernameTakenError(user.username));
    }

    const stored: User = { ...user };
    this.byId.set(stored.id, stored);
    this.byUsernameKey.set(stored.usernameKey, stored.id);

    return Promise.resolve({ ...stored });
  }

  findByUsername(username: string): Promise<User | null> {
    const id = this.byUsernameKey.get(usernameKeyOf(username));
    return Promise.resolve(id === undefined ? null : this.snapshot(id));
  }

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.snapshot(id));
  }

  recordWin(userId: string): Promise<User | null> {
    const existing = this.byId.get(userId);
    if (!existing) {
      return Promise.resolve(null);
    }

    const updated: User = { ...existing, wins: existing.wins + 1 };
    this.byId.set(userId, updated);

    return Promise.resolve({ ...updated });
  }

  private snapshot(id: string): User | null {
    const found = this.byId.get(id);
    return found ? { ...found } : null;
  }
}
