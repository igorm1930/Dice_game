import { idSchema } from '@dice-game/contracts';
import { Injectable } from '@nestjs/common';
import { type FilterQuery, type HydratedDocument, type Model, Schema, Types } from 'mongoose';

import { MongoConnection } from '../../persistence/mongo-connection';
import { isDuplicateKeyError } from '../../persistence/mongo-errors';
import { EmailTakenError } from '../auth.errors';
import {
  type ListUsersOptions,
  type NewUser,
  type UserPage,
  type UserRepository,
} from '../ports/user-repository.port';
import { type UserRecord } from '../user.entity';

/**
 * Users in MongoDB.
 *
 * Two things here are security properties rather than plumbing:
 *
 *  - **Uniqueness is a unique index, and the duplicate is reported by the
 *    server.** `create` inserts and maps `E11000` onto `EmailTakenError`. It
 *    never looks the address up first. A find-then-create is a race that two
 *    simultaneous registrations both win — leaving two accounts on one
 *    address — and it is also a timing oracle, because the duplicate path would
 *    answer in microseconds while a fresh address paid for an insert.
 *    `AuthService.register` hashes *before* calling this for the same reason.
 *  - **Every filter is built from explicitly typed fields.** No request object is
 *    ever spread into a query — that spread is the shape a NoSQL operator
 *    injection takes, and it is the one thing that turns `{ "$ne": null }` in a
 *    login body into "log me in as whoever is first in the collection". Three
 *    layers stand in front of it: the contract's `.strict()` Zod schemas reject
 *    a non-string `email` with a 400 at the edge; `toObjectId` validates an id
 *    against `idSchema` before casting, so anything else becomes `null` rather
 *    than a filter; and `sanitizeFilter` on the connection wraps any surviving
 *    `$`-keyed object in an `$eq`, comparing it as a value instead of running it
 *    as an operator.
 *
 * `createdAt` is stamped here, from the wall clock, exactly as
 * `InMemoryUserRepository` does: the auth module has no `Clock` port bound, and
 * the field is written once at registration and never asserted to the
 * millisecond.
 */

export interface UserDocument {
  _id: Types.ObjectId;
  /** Normalised: trimmed and lower-cased. Unique. */
  email: string;
  displayName: string;
  /** An Argon2id PHC string. Never projected onto the wire. */
  passwordHash: string;
  /** Bumped by logout. Survives a restart, which is what makes logout real. */
  tokenVersion: number;
  createdAt: Date;
}

export const USER_COLLECTION = 'users';
export const USER_MODEL_NAME = 'User';

export const userSchema = new Schema<UserDocument>(
  {
    /**
     * Unique, and enforced by the database rather than by this process.
     *
     * The index is built at boot by `MongoConnection`, awaited, before anything
     * is served — a unique index that has not finished building is not a
     * constraint, and the window would open on exactly the cold start where a
     * seeding script and a first registration collide.
     */
    email: { type: String, required: true, unique: true },
    displayName: { type: String, required: true },
    passwordHash: { type: String, required: true },
    tokenVersion: { type: Number, required: true, default: 0, min: 0 },
    createdAt: { type: Date, required: true },
  },
  {
    collection: USER_COLLECTION,
    versionKey: false,
    timestamps: false,
    minimize: false,
  },
);

@Injectable()
export class MongoUserRepository implements UserRepository {
  private readonly model: Model<UserDocument>;

  constructor(mongo: MongoConnection) {
    this.model = modelOn(mongo, USER_MODEL_NAME, userSchema);
  }

  async findById(id: string): Promise<UserRecord | null> {
    const objectId = toObjectId(id);

    // Not an id this store could ever have minted, so nothing can match it.
    // Returning early rather than letting the driver raise a `CastError` keeps
    // "no such user" a `null` at every call site, which is what the port
    // promises and what the guard relies on.
    if (objectId === null) {
      return null;
    }

    const found = await this.model.findOne({ _id: objectId }).exec();

    return found === null ? null : toUserRecord(found);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const filter: FilterQuery<UserDocument> = { email: normaliseEmail(email) };
    const found = await this.model.findOne(filter).exec();

    return found === null ? null : toUserRecord(found);
  }

  /**
   * Inserts, and lets the unique index decide.
   *
   * @throws {EmailTakenError} when the address is already registered — mapped
   * from the server's duplicate-key error, never from a lookup performed here.
   */
  async create(user: NewUser): Promise<UserRecord> {
    try {
      const created = await this.model.create<UserDocument>({
        _id: new Types.ObjectId(),
        email: normaliseEmail(user.email),
        displayName: user.displayName,
        passwordHash: user.passwordHash,
        tokenVersion: 0,
        createdAt: new Date(),
      });

      return toUserRecord(created);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new EmailTakenError();
      }

      throw error;
    }
  }

  /**
   * One atomic `$inc`, and the new value.
   *
   * Read-modify-write here would let two concurrent logouts land on the same
   * version, which would leave one of the two sets of tokens still verifying —
   * a revocation that silently did not revoke.
   */
  async incrementTokenVersion(id: string): Promise<number | null> {
    const objectId = toObjectId(id);

    if (objectId === null) {
      return null;
    }

    const updated = await this.model
      .findOneAndUpdate({ _id: objectId }, { $inc: { tokenVersion: 1 } }, { new: true })
      .exec();

    return updated === null ? null : updated.tokenVersion;
  }

  /**
   * One page, oldest first, tie-broken by id.
   *
   * The order matters more than it looks: without a total one, the same row can
   * appear on two pages and another on none. `createdAt` alone is not total —
   * two accounts registered in the same millisecond are a coin flip — so `_id`
   * breaks the tie, exactly as `InMemoryUserRepository` does.
   *
   * `passwordHash` is fetched and then dropped by `toUserRecord`'s caller
   * (`toUserSummary`); the projection that keeps it off the wire lives there,
   * in one place, rather than being re-decided per query.
   */
  async list({ limit, offset }: ListUsersOptions): Promise<UserPage> {
    const [items, total] = await Promise.all([
      this.model.find({}).sort({ createdAt: 1, _id: 1 }).skip(offset).limit(limit).exec(),
      this.model.countDocuments({}).exec(),
    ]);

    return {
      items: Object.freeze(items.map(toUserRecord)),
      total,
    };
  }
}

/**
 * Compiles the model onto the connection, or returns the one already compiled.
 * See the note on the games repository's copy: this exists for suites that build
 * more than one container over a single connection.
 */
function modelOn(
  mongo: MongoConnection,
  name: string,
  schema: Schema<UserDocument>,
): Model<UserDocument> {
  const existing = mongo.connection.models[name] as Model<UserDocument> | undefined;

  return existing ?? mongo.connection.model<UserDocument>(name, schema);
}

/**
 * A 24-character hex id as an `ObjectId`, or `null` when it is not one.
 *
 * Validated against the contract's `idSchema` rather than `ObjectId.isValid`,
 * which also accepts any 12-byte string and would let `'anystring12'` through as
 * a different id than the one the caller wrote. A non-string — an operator
 * object from a caller that skipped validation — fails the schema and lands on
 * `null`, so it can never reach a filter.
 */
function toObjectId(id: string): Types.ObjectId | null {
  return idSchema.safeParse(id).success ? new Types.ObjectId(id) : null;
}

/**
 * The form both the unique index and the stored record use, so that
 * `Ada@Example.com` and `ada@example.com` are one account rather than two.
 */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The stored document as the rest of the application types a user. */
function toUserRecord(document: HydratedDocument<UserDocument>): UserRecord {
  return Object.freeze({
    id: document._id.toHexString(),
    email: document.email,
    displayName: document.displayName,
    passwordHash: document.passwordHash,
    tokenVersion: document.tokenVersion,
    createdAt: new Date(document.createdAt.getTime()),
  });
}
