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
/**
 * Null-prototype on purpose. A plain object literal inherits from
 * `Object.prototype`, so a key of the shape `id@version` planted there by
 * prototype pollution anywhere in the process would be returned as a policy
 * instead of throwing. `Object.freeze` does not protect against that — it
 * guards the table's own properties, not what it inherits.
 */
const REGISTRY: Readonly<Record<string, GameRules>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, GameRules>, {
    [rulesetKey(STANDARD_RULESET_REF)]: standardRulesV1,
  }),
);

/**
 * Resolves a persisted or requested ref to the policy that implements it.
 *
 * @throws {UnsupportedRulesetError} if the ref is not on the allow-list.
 */
export function resolveRules(ref: RulesetRef): GameRules {
  const rules = tryResolveRules(ref);

  if (rules === null) {
    throw new UnsupportedRulesetError(ref);
  }

  return rules;
}

/**
 * The total form of {@link resolveRules}, for callers that need to *ask*
 * whether a ref is supported rather than assert it.
 *
 * `availableActionsFor` is the reason this exists: advertising an action the
 * matching transition would refuse is the one failure mode this design cannot
 * tolerate, because the client trusts those booleans completely.
 */
export function tryResolveRules(ref: RulesetRef): GameRules | null {
  const key = rulesetKey(ref);

  return Object.hasOwn(REGISTRY, key) ? (REGISTRY[key] ?? null) : null;
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
