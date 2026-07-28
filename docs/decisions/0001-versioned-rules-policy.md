# 1. Scoring lives in a versioned rules policy, not in the aggregate

Status: accepted (Phase 2)

## Context

The brief asks for one specific ruleset: two dice, both added to the round
score, 6 and 6 wipes it. It also invites the question of how expensive a rules
change would be — which combination loses, what the penalty is, how many dice.

The obvious implementation inlines the rule in the aggregate: `if (d1 === 6 &&
d2 === 6)`. It is shorter, and it makes changing the rule a change to the engine.
The opposite failure is a plugin platform that loads rules from configuration,
which is a large amount of machinery in service of a requirement nobody has.

## Decision

Scoring is a `GameRules` interface with one implementation, `standard@1`,
resolved through an allow-listed registry. `evaluateRoll` returns a
discriminated `RollOutcome` — `ADD_TO_ROUND` with points, or
`LOSE_ROUND_AND_PASS` — and the engine applies the consequence without ever
inspecting the dice.

Every game persists the ruleset identity it was created under
(`ruleset: { id, version }`), so a finished match stays readable after the rules
evolve. The registry is a frozen, null-prototype table; nothing executable is
ever loaded from the database or from client input.

The outcome carries its own `effect`. Naming the effect is a rules decision, not
an engine one — `standard@1` calls a lost round `DOUBLE_SIX` because under
`standard@1` that is what causes it.

## Consequences

Changing the losing combination touches `rules/standard-v1.ts` and
`rules/standard-v1.test.ts`, and nothing else. This is verified rather than
asserted: flipping `BUST_FACE` from 6 to 5 fails exactly five tests, all in that
one file, while the 74 engine tests keep passing.

That property is fragile in a specific way, and the fragility is in the tests
rather than the code. An engine fixture that reaches a banked total by throwing
`[5, 5]` is silently asserting that 5 and 5 does not lose. Engine tests
therefore drive transitions through stand-in rulesets — `score()`, `bust()` and
`bank()` — and never name a die face. Deliberate end-to-end tests of
`standard@1` live beside the rule they depend on.

What the abstraction does **not** buy: `RollOutcome` offers two consequences, so
a ruleset that subtracted from the global score would need a new variant and an
engine branch. Seat count and dice count are not on the policy at all. Those are
accepted limits, not oversights — widening the outcome to a generic effect list
would be speculative until a second ruleset exists.

## Revisit when

A second ruleset is actually required. At that point, decide between adding a
`RollOutcome` variant and generalising the outcome to `{ roundDelta,
globalDelta, passesTurn, effect }`.
