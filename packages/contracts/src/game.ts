import { z } from 'zod';

import {
  dicePairSchema,
  displayNameSchema,
  idSchema,
  revisionSchema,
  seatSchema,
  timestampSchema,
  winningScoreSchema,
} from './primitives.js';

/**
 * The identity of the rules a game was played under, persisted on every game
 * document so a match remains readable after the rules evolve. An allow-listed
 * registry resolves this to a policy; nothing executable ever comes from the
 * database or from client input.
 */
export const rulesetRefSchema = z.object({
  id: z.literal('standard'),
  version: z.literal(1),
});

export type RulesetRef = z.infer<typeof rulesetRefSchema>;

export const STANDARD_RULESET: RulesetRef = Object.freeze({ id: 'standard', version: 1 });

export const gameStatusSchema = z.enum(['ACTIVE', 'COMPLETED']);
export type GameStatus = z.infer<typeof gameStatusSchema>;

/**
 * What the last applied action did — the client's entire basis for animating.
 *
 * This exists so the UI never re-decides what a bust is. `DOUBLE_SIX` arrives
 * as a fact from the server alongside the dice that caused it; the client's
 * only job is to play an animation and say whose turn is next.
 *
 * Describes the last action applied to the game, not a persistent condition.
 */
export const gameEffectSchema = z.enum([
  'NORMAL_ROLL',
  'DOUBLE_SIX',
  'HELD',
  'GAME_WON',
  'NEW_GAME',
]);

export type GameEffect = z.infer<typeof gameEffectSchema>;

/** A seated player, as the client sees them. */
export const playerViewSchema = z.object({
  userId: idSchema,
  displayName: displayNameSchema,
  /** Banked score in the current game. */
  globalScore: z.number().int().nonnegative(),
  /** Games won by this player across the whole match series. Survives New Game. */
  winCount: z.number().int().nonnegative(),
});

export type PlayerView = z.infer<typeof playerViewSchema>;

/**
 * What the acting player may legally do right now, decided by the server.
 *
 * The client renders button state from these three booleans and never derives
 * legality itself. That is what makes "no game logic in the frontend" a
 * structural property: a client that wanted to cheat could enable its own
 * buttons, and the server would still refuse the action.
 *
 * These are scoped to the *requesting* user. A player looking at a game where
 * it is not their turn receives all three as false.
 */
export const availableActionsSchema = z.object({
  canRoll: z.boolean(),
  canHold: z.boolean(),
  canStartNewGame: z.boolean(),
});

export type AvailableActions = z.infer<typeof availableActionsSchema>;

/**
 * The authoritative public view of a game. Every field a client renders comes
 * from here; nothing is computed on the client.
 */
export const gameViewSchema = z.object({
  id: idSchema,
  players: z.tuple([playerViewSchema, playerViewSchema]),
  activePlayer: seatSchema,
  /** Points accumulated this turn, lost on a double six, banked on Hold. */
  roundScore: z.number().int().nonnegative(),
  /** The faces last thrown, or null before the first roll of a game. */
  lastDice: dicePairSchema.nullable(),
  winningScore: winningScoreSchema,
  ruleset: rulesetRefSchema,
  /** Increments on every New Game; 1 for the first game between two players. */
  gameNumber: z.number().int().positive(),
  status: gameStatusSchema,
  winner: seatSchema.nullable(),
  revision: revisionSchema,
  availableActions: availableActionsSchema,
  effect: gameEffectSchema.nullable(),
  /** The requesting user's seat, or null when they are only spectating. */
  viewerSeat: seatSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type GameView = z.infer<typeof gameViewSchema>;
