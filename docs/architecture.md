# Architecture

## The shape

```
apps/web  ──HTTP──▶  apps/api  ──▶  MongoDB
   │                    │
   └──── packages/contracts ────┘
```

Three packages, one dependency edge that matters: both apps derive their types
from the same Zod schemas, so a field cannot change on one side of the wire
without failing the build on the other.

## The backend owns the game

Dice, active player, round score, global scores, winning score, legality,
status, winner, win counts. All of it.

This is not a stylistic preference — it is what makes the client unable to
cheat, and it is enforced at the level of the wire format rather than by
discipline:

- **Roll and Hold carry no dice, no score, no actor.** Only `expectedRevision`.
  A contract test asserts that a body containing `userId`, `dice`, `roundScore`
  or `activePlayer` is rejected.
- **`availableActions` is sent, not derived.** The client renders three booleans
  it was given. A modified client could enable its own buttons; the server would
  still refuse the action.
- **`effect` is sent, not inferred.** The client animates a double six without
  ever holding a definition of one.

The client holds up its end: `apps/web/src` contains no comparison against a die
face, no comparison against the winning score, no arithmetic on any score, and
no `Math.`. Two features were dropped rather than computed — a progress bar
toward the target (division on scores) and naming who threw the double six (not
derivable from a view that arrives with the turn already passed).

## Layers inside the API

```
http        controllers, guards, filters, pipes, interceptors
   │        thin: validate, call, map. No rules.
   ▼
services    orchestration: load, resolve ruleset, draw dice, transition, persist
   │        no rules of their own
   ▼
domain      pure functions over frozen state. The rules live here.
   │
   ▼
ports       interfaces the domain and services depend on
   ▲
adapters    Mongoose, Argon2, JWT, crypto dice, system clock
```

The dependency rule points inward. `domain/` imports nothing but itself: no
NestJS, no Mongoose, no HTTP, no clock, no randomness, no environment. That is
enforced by `no-restricted-imports` patterns in the shared ESLint config and
proven by a CI job that writes a deliberately illegal file and fails if the
linter accepts it — see [decision 4](decisions/0004-guarded-by-the-linter.md).

Everything the domain needs is passed in. Dice arrive as an argument because a
`DiceGenerator` port produced them outside; the ruleset arrives as an argument
because the registry resolved it outside. A domain test needs no fake beyond a
literal.

## Rules are a versioned policy

`GameRules` is an interface with one implementation, `standard@1`, resolved
through an allow-listed registry. `evaluateRoll` returns a discriminated
`RollOutcome` and the engine applies the consequence without inspecting the
dice. The outcome carries its own `effect`, because naming it is a rules
decision.

Every game persists `ruleset: { id, version }`, so a finished match stays
scored by the rules it was played under.

The payoff is measurable: changing the losing combination touches
`rules/standard-v1.ts` and its own test file, and nothing else. Flip `BUST_FACE`
from 6 to 5 and exactly five tests fail, all in that one file, while the 74
engine tests keep passing. Full reasoning and the accepted limits are in
[decision 1](decisions/0001-versioned-rules-policy.md).

## Concurrency

Two players act on one shared game from one page, with no live synchronisation.
Every state-changing request carries `expectedRevision`; the write is a single
`findOneAndUpdate` filtered on `{ _id, revision }` with `$inc`, one round trip,
no preceding read and no transaction. No match means the view was stale:
`GAME_REVISION_CONFLICT`, and the action is **not** replayed.

The repository owns the revision. Domain transitions leave it untouched — a
domain that incremented it would race with the check that depends on it.
[Decision 2](decisions/0002-optimistic-concurrency.md).

## Authorization

Default-deny. A global `APP_GUARD` protects every route; four opt out with
`@Public()`. The allow-list lives in the contract as `PUBLIC_ROUTES`, and a test
asserts the mounted set equals it **by equality** — containment would let a new
public route through.

That test checks two things, because one is not enough. `DiscoveryService` sees
the controllers Nest registers. It does not see anything mounted on the raw
Express adapter — which is where Swagger lives, and where seven unauthenticated,
unthrottled documentation routes were found hiding. The second assertion walks
the real router stack after `init()`.

## Persistence

Repository ports with two implementations each: in-memory and Mongoose. The
in-memory ones are not scaffolding to be deleted — they are what keeps the unit
suite fast and runnable with no database, and they implement the same
compare-and-set contract Mongo honours.

Swapping is a module binding. No service, controller, mapper or domain file
changes.

## What is deliberately absent

- **No caching layer.** Nothing has been profiled, and a cache added in
  anticipation is a second source of truth plus an invalidation problem.
- **No WebSockets.** The brief says live synchronisation between browsers is not
  required. Two seats share one page and one query cache; a second browser sees
  current state on its next fetch.
- **No microservices, no message queue, no Kubernetes.** One deployable, one
  database, proportional to a two-player dice game.
- **No AI opponent.** Optional extras do not compensate for mandatory
  requirements.
