import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { EmailTakenError } from '../auth.errors';
import {
  type ListUsersOptions,
  type NewUser,
  type UserPage,
  type UserRepository,
} from '../ports/user-repository.port';
import { type UserRecord } from '../user.entity';

/**
 * The Phase 3 user store: two maps and no database.
 *
 * It exists so authentication is complete and testable before persistence lands.
 * Phase 4 binds a Mongoose adapter to `USER_REPOSITORY` and deletes this file;
 * nothing that depends on the port moves. Three details are here to make that
 * swap uneventful rather than to make the map work:
 *
 *  - **Ids are 24-character hex**, the shape `idSchema` accepts and MongoDB's
 *    `ObjectId` produces. A `Map` would be happy with `user-1`, and then every
 *    id in every fixture would become invalid the day a real driver arrives.
 *  - **Uniqueness is enforced on write**, mirroring a unique index, so `create`
 *    raises `EmailTakenError` from the same place the real adapter will.
 *  - **Records are frozen and replaced, never mutated.** A caller holding a
 *    record cannot change stored state by writing to it, which is the behaviour
 *    a driver gives for free and an object graph does not.
 *
 * Not concurrency-safe across processes, and not meant to be — it holds state in
 * one process's heap, so it is a single-instance, restart-loses-everything
 * store by construction.
 */
@Injectable()
export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, UserRecord>();

  /** Normalised email to id. The stand-in for the unique index. */
  private readonly idByEmail = new Map<string, string>();

  findById(id: string): Promise<UserRecord | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  findByEmail(email: string): Promise<UserRecord | null> {
    const id = this.idByEmail.get(normaliseEmail(email));

    return Promise.resolve(id === undefined ? null : (this.byId.get(id) ?? null));
  }

  create(user: NewUser): Promise<UserRecord> {
    const email = normaliseEmail(user.email);

    if (this.idByEmail.has(email)) {
      // Rejected rather than thrown, so the failure arrives the way a driver's
      // would: as a rejected promise, not a synchronous throw from the call.
      return Promise.reject(new EmailTakenError());
    }

    const record: UserRecord = Object.freeze({
      id: this.mintId(),
      email,
      displayName: user.displayName,
      passwordHash: user.passwordHash,
      tokenVersion: 0,
      createdAt: new Date(),
    });

    this.byId.set(record.id, record);
    this.idByEmail.set(email, record.id);

    return Promise.resolve(record);
  }

  incrementTokenVersion(id: string): Promise<number | null> {
    const existing = this.byId.get(id);

    if (existing === undefined) {
      return Promise.resolve(null);
    }

    const updated: UserRecord = Object.freeze({
      ...existing,
      tokenVersion: existing.tokenVersion + 1,
    });

    this.byId.set(id, updated);

    return Promise.resolve(updated.tokenVersion);
  }

  list({ limit, offset }: ListUsersOptions): Promise<UserPage> {
    // Oldest first, tie-broken by id. A stable order is what makes paging
    // coherent: without one, the same row can appear on two pages and another on
    // none, and `Map` iteration order is an implementation detail either way.
    const ordered = [...this.byId.values()].sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
    );

    return Promise.resolve({
      items: ordered.slice(offset, offset + limit),
      total: ordered.length,
    });
  }

  /** A fresh 24-character hex id, retried on the (vanishing) chance of a clash. */
  private mintId(): string {
    let id = randomBytes(12).toString('hex');

    while (this.byId.has(id)) {
      id = randomBytes(12).toString('hex');
    }

    return id;
  }
}

/** The form both the lookup index and the stored record use. */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
