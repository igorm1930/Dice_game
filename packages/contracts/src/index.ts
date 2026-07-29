/**
 * `@dice-game/contracts` — the frozen wire contract between `apps/api` and
 * `apps/web`.
 *
 * Zod schemas are the single source of truth: the API validates requests with
 * them, the client builds forms from them with React Hook Form, and both derive
 * their TypeScript types from the same declarations. A field cannot drift on
 * one side of the wire without failing the build on the other.
 *
 * This package is owned by the orchestrator alone. Changes after the contract
 * freeze are announced to every agent, because they are the one thing that can
 * invalidate work already in progress.
 */

export * from './auth.js';
export * from './commands.js';
export * from './envelope.js';
export * from './errors.js';
export * from './game.js';
export * from './health.js';
export * from './primitives.js';
export * from './routes.js';
export * from './users.js';
