/**
 * Mints the id a new game is addressed by.
 *
 * A port rather than a call to the driver, for the usual reason: the service
 * stays free of `node:crypto` and a test can hand it a counter instead of
 * asserting on a value it cannot predict.
 *
 * **The format is part of the contract.** `idSchema` in
 * `@dice-game/contracts` is `/^[a-f\d]{24}$/i` — a Mongo ObjectId as it appears
 * on the wire — and `ROUTES.games.byId` interpolates the result straight into a
 * URL the client then validates. An implementation that returned a UUID would
 * mint games no client could address, and the failure would surface as a
 * validation error on a response rather than anywhere near this file.
 */
export interface IdGenerator {
  /** A fresh 24-character hex id. */
  nextId(): string;
}

/** DI token for {@link IdGenerator}. */
export const ID_GENERATOR = 'ID_GENERATOR';
