import { UnsupportedRulesetError } from '../errors';
import { type GameRules, type RulesetRef } from './game-rules';
import { STANDARD_RULESET_REF, standardRulesV1 } from './standard-v1';

/** The key a ref is looked up by: `${id}@${version}`. */
export function rulesetKey(ref: RulesetRef): string {
  return `${ref.id}@${ref.version}`;
}

/**
 * The ruleset allow-list.
 *
 * **Nothing executable may ever come from a database or from client input.** A
 * game document stores a `{ id, version }` *ref* — two scalars, nothing more —
 * and this table is the only thing that turns a ref into behaviour. A stored
 * document therefore cannot name a policy that was never compiled in, a client
 * cannot smuggle scoring logic through a request body, and withdrawing a
 * ruleset is a matter of deleting one line here.
 *
 * The table is a frozen module-private literal reached only through
 * `resolveRules`. There is no `register()`, no mutable map and no exported
 * setter: extension happens at build time, in this file, under review — never at
 * runtime. `Object.freeze` is what makes that structural rather than a
 * convention (a module is always strict mode, so an assignment to a frozen
 * object throws rather than failing silently).
 */
const REGISTRY: Readonly<Record<string, GameRules>> = Object.freeze({
  [rulesetKey(STANDARD_RULESET_REF)]: standardRulesV1,
});

/**
 * Resolves a persisted or requested ref to the policy that implements it.
 *
 * @throws {UnsupportedRulesetError} if the ref is not on the allow-list.
 */
export function resolveRules(ref: RulesetRef): GameRules {
  const rules = REGISTRY[rulesetKey(ref)];

  if (rules === undefined) {
    throw new UnsupportedRulesetError(ref);
  }

  return rules;
}

/** The ref new games are created under unless a caller names another. */
export const DEFAULT_RULESET_REF = STANDARD_RULESET_REF;

/**
 * The keys currently on the allow-list. A fresh array, so a caller cannot reach
 * the table through the value it is handed.
 */
export function supportedRulesetKeys(): readonly string[] {
  return Object.freeze(Object.keys(REGISTRY));
}

/**
 * The table itself, exported **only** so a test can assert it is frozen and
 * cannot be extended at runtime. Production code resolves through
 * `resolveRules`.
 */
export const RULESET_ALLOW_LIST: Readonly<Record<string, GameRules>> = REGISTRY;
