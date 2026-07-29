import { Inject, Injectable } from '@nestjs/common';
import { type FilterQuery, type HydratedDocument, type Model, Schema } from 'mongoose';

import { type DicePair, isDieValue } from '../../domain/dice';
import {
  type GameEffect,
  type GamePlayer,
  type GameState,
  type GameStatus,
} from '../../domain/game';
import { type Seat } from '../../domain/seat';
import { MongoConnection } from '../../persistence/mongo-connection';
import { CLOCK, type Clock } from '../ports/clock.port';
import {
  type GameRepository,
  INITIAL_REVISION,
  type PersistedGame,
} from '../ports/game-repository.port';

/**
 * Games in MongoDB, and the compare-and-set the whole optimistic-concurrency
 * design rests on.
 *
 * `updateIfRevisionMatches` is **one** `findOneAndUpdate` filtered on
 * `{ _id, revision }` with `$inc: { revision: 1 }` — one round trip, no read
 * beforehand, no session and no transaction. That is not an optimisation: a
 * read-then-write pair here would reopen the exact race the revision exists to
 * close, and a transaction would serialise writes that the conditional update
 * already orders correctly. A `null` result means the filter matched nothing,
 * which the service maps to `GAME_REVISION_CONFLICT`; it does not retry and it
 * does not replay, because replaying a stale Roll spends a turn the player did
 * not knowingly take.
 *
 * The revision is incremented **by the server, inside the same statement that
 * matched on it**. Nothing here reads it, adds one and writes it back, and
 * `$set` deliberately cannot carry it — see `toMutableFields`.
 *
 * `createdAt`/`updatedAt` are stamped from the injected `Clock`, exactly as
 * `InMemoryGameRepository` does. The domain is clock-free by construction, so
 * the layer that writes is the layer that timestamps.
 */

/** A seated player, as stored. Flat, and with no `_id` of its own. */
interface GamePlayerDocument {
  userId: string;
  displayName: string;
  globalScore: number;
  winCount: number;
}

/** A game, as stored. */
export interface GameDocument {
  /**
   * The id the `ID_GENERATOR` port minted, stored verbatim as a string rather
   * than cast to an `ObjectId`.
   *
   * `HexObjectIdGenerator` produces 24 random hex characters that are *not* a
   * real ObjectId — no timestamp prefix, no machine or counter component — and
   * storing them as an ObjectId would silently claim otherwise. Users go the
   * other way (Mongo mints their `_id`) because there the store owns the id;
   * here a port already does.
   */
  _id: string;
  players: GamePlayerDocument[];
  activePlayer: number;
  roundScore: number;
  /** `null` before the first roll of a game; a pair of faces afterwards. */
  lastDice: number[] | null;
  winningScore: number;
  ruleset: { id: string; version: number };
  gameNumber: number;
  status: string;
  winner: number | null;
  /** Owned by this layer alone. Incremented by `$inc`, never by the domain. */
  revision: number;
  effect: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const GAME_COLLECTION = 'games';
export const GAME_MODEL_NAME = 'Game';

const playerSchema = new Schema<GamePlayerDocument>(
  {
    userId: { type: String, required: true },
    displayName: { type: String, required: true },
    globalScore: { type: Number, required: true, min: 0 },
    winCount: { type: Number, required: true, min: 0 },
  },
  { _id: false, versionKey: false },
);

export const gameSchema = new Schema<GameDocument>(
  {
    _id: { type: String, required: true },
    players: { type: [playerSchema], required: true },
    activePlayer: { type: Number, required: true, enum: [0, 1] },
    roundScore: { type: Number, required: true, min: 0 },
    lastDice: { type: [Number], default: null },
    winningScore: { type: Number, required: true },
    ruleset: {
      _id: false,
      id: { type: String, required: true },
      version: { type: Number, required: true },
    },
    gameNumber: { type: Number, required: true, min: 1 },
    status: { type: String, required: true },
    winner: { type: Number, default: null, enum: [0, 1, null] },
    revision: { type: Number, required: true, min: 0 },
    effect: { type: String, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  {
    collection: GAME_COLLECTION,
    /**
     * Mongoose stamps its own `__v` and its own `createdAt`/`updatedAt` unless
     * told not to. Both are off: `revision` is the one version this system has —
     * two would be two answers to the same question — and the timestamps come
     * from the injected clock so a test can assert them as equalities rather
     * than as tolerance windows.
     */
    versionKey: false,
    timestamps: false,
    minimize: false,
  },
);

@Injectable()
export class MongoGameRepository implements GameRepository {
  private readonly model: Model<GameDocument>;

  constructor(
    mongo: MongoConnection,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.model = modelOn(mongo, GAME_MODEL_NAME, gameSchema);
  }

  async findById(gameId: string): Promise<PersistedGame | null> {
    const found = await this.model.findOne(byId(gameId)).exec();

    return found === null ? null : toPersistedGame(found);
  }

  async create(state: GameState): Promise<PersistedGame> {
    const now = this.clock.now();

    const created = await this.model.create<GameDocument>({
      _id: state.id,
      ...toMutableFields(state),
      // Set here, not taken from the argument: this layer owns the revision, so
      // a caller handing in a state that claims revision 41 gets revision 0.
      revision: INITIAL_REVISION,
      createdAt: now,
      updatedAt: now,
    });

    return toPersistedGame(created);
  }

  /**
   * The compare-and-set. One statement, one round trip, no retry.
   *
   * The filter names both halves of the guard, so an absent game and a game that
   * moved on are the same outcome — `null` — and the caller cannot tell them
   * apart. It does not need to: either way its view is stale.
   *
   * `createdAt` is absent from the update, so it is written once and never
   * again; a document that reset it on every write would make "when did this
   * match start" unanswerable.
   */
  async updateIfRevisionMatches(
    gameId: string,
    expectedRevision: number,
    next: GameState,
  ): Promise<PersistedGame | null> {
    const updated = await this.model
      .findOneAndUpdate(
        { ...byId(gameId), revision: expectedRevision },
        {
          $set: { ...toMutableFields(next), updatedAt: this.clock.now() },
          $inc: { revision: 1 },
        },
        // `new: true` returns the document *after* the increment, so the caller
        // sees the revision it must quote next.
        { new: true },
      )
      .exec();

    return updated === null ? null : toPersistedGame(updated);
  }
}

/**
 * Compiles the model onto the connection, or returns the one already compiled.
 *
 * Mongoose throws `OverwriteModelError` if the same name is registered twice on
 * one connection. That never happens in a running application — the repository
 * is a singleton — but it happens readily in an integration suite that builds
 * more than one container over the same connection, and a crash there would be
 * an artefact of the test harness rather than a fact about the code.
 */
function modelOn(
  mongo: MongoConnection,
  name: string,
  schema: Schema<GameDocument>,
): Model<GameDocument> {
  const existing = mongo.connection.models[name] as Model<GameDocument> | undefined;

  return existing ?? mongo.connection.model<GameDocument>(name, schema);
}

/**
 * The `_id` half of every filter in this file.
 *
 * Built from a declared, typed parameter — never by spreading a request object
 * into a query, which is the shape a NoSQL operator injection takes. The id a
 * caller supplies has already been through the contract's `gameIdParamSchema`,
 * which accepts 24 hex characters and nothing else, so `{ "$ne": null }` is a
 * 400 long before it could reach here. `sanitizeFilter` on the connection is the
 * backstop for any filter that is ever built without that validation in front of
 * it — see `MongoConnection`.
 */
function byId(gameId: string): FilterQuery<GameDocument> {
  return { _id: gameId };
}

/**
 * Everything a write may change, and deliberately nothing else.
 *
 * `_id`, `createdAt` and — above all — `revision` are absent. Naming `revision`
 * in `$set` alongside `$inc` is not merely redundant: Mongo rejects the whole
 * update as a conflicting path, so the guard would fail closed on every write.
 * Written as an explicit literal rather than a spread of `state`, so a field
 * added to `GameState` later has to be handled here on purpose.
 */
function toMutableFields(
  state: GameState,
): Omit<GameDocument, '_id' | 'revision' | 'createdAt' | 'updatedAt'> {
  return {
    players: [toPlayerDocument(state.players[0]), toPlayerDocument(state.players[1])],
    activePlayer: state.activePlayer,
    roundScore: state.roundScore,
    lastDice: state.lastDice === null ? null : [state.lastDice[0], state.lastDice[1]],
    winningScore: state.winningScore,
    ruleset: { id: state.ruleset.id, version: state.ruleset.version },
    gameNumber: state.gameNumber,
    status: state.status,
    winner: state.winner,
    effect: state.effect,
  };
}

function toPlayerDocument(player: GamePlayer): GamePlayerDocument {
  return {
    userId: player.userId,
    displayName: player.displayName,
    globalScore: player.globalScore,
    winCount: player.winCount,
  };
}

/**
 * Raised when a stored document cannot be read back as a game.
 *
 * Reachable only for a document this application did not write — a hand-edited
 * record, or one from a future version with a value this one has no meaning for.
 * Failing loudly beats substituting a plausible default: a game silently read
 * back with `activePlayer: 0` because the stored value was unrecognised is a
 * turn handed to the wrong player.
 */
export class CorruptGameDocumentError extends Error {
  constructor(gameId: string, detail: string) {
    super(`Stored game ${gameId} cannot be read: ${detail}.`);
    this.name = 'CorruptGameDocumentError';
  }
}

/**
 * The status and effect vocabularies, derived from the domain's own unions.
 *
 * `satisfies Record<…, true>` is what makes these exhaustive: adding a variant
 * to `GameStatus` or `GameEffect` without listing it here is a compile error,
 * rather than a value that reads back from the database as corrupt.
 */
const GAME_STATUSES = Object.keys({
  ACTIVE: true,
  COMPLETED: true,
} satisfies Record<GameStatus, true>) as readonly GameStatus[];

const GAME_EFFECTS = Object.keys({
  NORMAL_ROLL: true,
  DOUBLE_SIX: true,
  HELD: true,
  GAME_WON: true,
  NEW_GAME: true,
} satisfies Record<GameEffect, true>) as readonly GameEffect[];

/** The stored document, as the port promises it: frozen, and domain-typed. */
function toPersistedGame(document: HydratedDocument<GameDocument>): PersistedGame {
  const id = document._id;
  const players = document.players;

  if (players.length !== 2) {
    throw new CorruptGameDocumentError(id, `expected two seated players, found ${players.length}`);
  }

  const [first, second] = players as [GamePlayerDocument, GamePlayerDocument];

  // Annotated rather than asserted: the tuple-ness is the contextual type, so
  // an array of the wrong length is a compile error here instead of a widening
  // that only fails where `PersistedGame` is assigned.
  const seated: readonly [GamePlayer, GamePlayer] = [toGamePlayer(first), toGamePlayer(second)];

  return Object.freeze({
    id,
    players: Object.freeze(seated),
    activePlayer: readSeat(id, 'activePlayer', document.activePlayer),
    roundScore: document.roundScore,
    lastDice: readDicePair(id, document.lastDice),
    winningScore: document.winningScore,
    ruleset: Object.freeze({ id: document.ruleset.id, version: document.ruleset.version }),
    gameNumber: document.gameNumber,
    status: readMember(id, 'status', document.status, GAME_STATUSES),
    winner: document.winner === null ? null : readSeat(id, 'winner', document.winner),
    revision: document.revision,
    effect:
      document.effect === null ? null : readMember(id, 'effect', document.effect, GAME_EFFECTS),
    createdAt: new Date(document.createdAt.getTime()),
    updatedAt: new Date(document.updatedAt.getTime()),
  });
}

function toGamePlayer(player: GamePlayerDocument): GamePlayer {
  return Object.freeze({
    userId: player.userId,
    displayName: player.displayName,
    globalScore: player.globalScore,
    winCount: player.winCount,
  });
}

function readSeat(gameId: string, field: string, value: number): Seat {
  if (value !== 0 && value !== 1) {
    throw new CorruptGameDocumentError(gameId, `${field} is ${value}, which is not a seat`);
  }

  return value;
}

/**
 * Narrows a stored array to the domain's pair.
 *
 * `isDieValue` is the domain's own guard, used here rather than a second copy of
 * the bound — its docblock names a database document as exactly the case it
 * exists for.
 */
function readDicePair(gameId: string, value: number[] | null): DicePair | null {
  if (value === null || value.length === 0) {
    return null;
  }

  const [first, second] = value;

  if (value.length !== 2 || !isDieValue(first) || !isDieValue(second)) {
    throw new CorruptGameDocumentError(gameId, `lastDice ${JSON.stringify(value)} is not a pair`);
  }

  const pair: DicePair = [first, second];

  return Object.freeze(pair);
}

function readMember<T extends string>(
  gameId: string,
  field: string,
  value: string,
  allowed: readonly T[],
): T {
  const match = allowed.find((candidate) => candidate === value);

  if (match === undefined) {
    throw new CorruptGameDocumentError(
      gameId,
      `${field} "${value}" is not one of ${allowed.join(', ')}`,
    );
  }

  return match;
}
