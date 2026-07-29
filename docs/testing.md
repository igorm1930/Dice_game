# Testing

## Shape and counts

| Suite                        | Command                 | Count | Needs   |
| ---------------------------- | ----------------------- | ----- | ------- |
| Domain, services, components | `pnpm test`             | 460   | nothing |
| API against a real database  | `pnpm test:integration` | 64    | MongoDB |
| Browser end-to-end           | `pnpm test:e2e`         | 5     | MongoDB |

460 = 374 api + 71 web + 15 contracts.

The unit suite installs and runs with no database, no browser and no network.
That is a deliberate property: a suite you can only run after standing something
up is a suite people stop running.

## The convention that matters most

**Test doubles are hand-written fakes implementing the port interfaces.** There
is no mocking framework anywhere — no `vi.fn`, no `vi.mock`, no
`toHaveBeenCalled`. Where a counter is useful (`dice.throwCount`,
`findByIdCalls`) it is paired with a state assertion rather than standing alone.

Asserting that a function was called is asserting that code ran. Asserting what
the state became is asserting that it was right.

## Rules tests and engine tests are separate, and stay separate

A rules test asserts _"6 and 6 produces `LOSE_ROUND_AND_PASS`"_. An engine test
asserts _"`LOSE_ROUND_AND_PASS` clears the round score and switches player"_.
Conflating them means changing a rule breaks tests about the engine.

Keeping them apart is not achieved by putting them in different files. It is
achieved by **engine fixtures never naming a die face**: `score()`, `bust()` and
`bank()` drive transitions through stand-in rulesets. A fixture that reaches a
banked total by throwing `[5, 5]` is silently asserting that 5 and 5 is not the
losing combination.

This is verifiable rather than aspirational. Flip `BUST_FACE` in
`rules/standard-v1.ts` from 6 to 5:

```
Test Files  1 failed | 3 passed (4)
     Tests  5 failed | 110 passed (115)
```

All five failures in `rules/standard-v1.test.ts`. The 74 engine tests pass
untouched. Before the fixtures were decoupled, the same change stopped
`game.test.ts` from _loading at all_, taking every engine test with it.

Deliberate end-to-end tests of `standard@1` live beside the rule they depend on,
not in the engine suite.

## Mutation testing is how these tests earned trust

Every phase was reviewed by agents that did not write the code, and the most
valuable thing they did was mutate the implementation and check whether the
suite noticed. What that found, in order of severity:

- Adding `@Public()` to `GET /api/users` — an unauthenticated user-enumeration
  endpoint — left all 329 tests green. So did removing `@Public()` from `login`,
  a total authentication outage. Only one of four controllers had a reflection
  test.
- Deleting `startNewGame`'s `roundScore: 0` left the suite green, because every
  fixture arrived through a hold that had already zeroed it.
- The one test asserting that `applyHold` delegates the win decision was
  vacuous: it banked a _busted_ round, so the stub was asked `hasWon(0, 2)` and
  answered exactly what a hardcoded comparison would.
- The immutability tests only ever passed already-frozen states, so
  `Object.freeze` was doing the work the assertion claimed.

On the client, later, the same shape again: the only `GAME_WON` fixture gave the
winner the higher score too, so `nameOf(view, view.winner)` could be replaced
with a score comparison — client-side winner detection — undetected. The fixture
is now adversarial: the server names a winner who is _not_ leading on the number
the client can see.

Each is now covered by a test that fails against the mutant that survived it.
When adding a test for something that matters, the question is not "does it
pass?" but "what would I have to break for it to fail?".

The habit generalises. Writing the fix for these findings, the agent's own first
attempt at the live-region test was vacuous — the board normally mounts before
its data arrives, so the region was empty either way and the mutant survived.
It noticed because it re-applied the mutant rather than trusting the green.

## Integration tests

Against a real `mongo:7.0`, the same image `compose.yaml` gives a contributor,
so CI and a laptop cannot disagree about server behaviour. They create their own
fixtures — none depend on `db:seed`, because a test asserting against data it
did not create passes or fails for reasons in another file.

The concurrency tests are the point. `BarrierGameRepository` holds every reader
until both have arrived, so both observe the same revision and both run the
transition before either writes. Exactly one write survives; the other gets
`GAME_REVISION_CONFLICT`. It asserts three ways that no replay occurred: both
transitions genuinely ran, the stored revision moved by one, and the stored
round score reflects one roll.

That test was itself verified by removing `revision` from the compare-and-set
filter — both simultaneous rolls then returned 200 instead of 200/409.

There are four such tests, plus one spanning two separate connections.

## Frontend tests

React Testing Library over jsdom. The load-bearing assertion is that Roll is
disabled **because the server said `canRoll: false`**, not because the test
computed whose turn it is.

That claim was false when it was first written, and the way it failed is the
most instructive thing in this repository. Every fixture in the original suite
satisfied `canRoll === canHold === (viewerSeat === activePlayer)`, so a client
that derived legality locally was indistinguishable from one that read the
server's answer. Replacing `availableActions.canRoll` with
`viewerSeat === activePlayer` passed all 44 tests — including the test named
_"disables Roll because the server said canRoll is false — not because the
client decided"_.

The suite now contains a `disagree` block: positions where the server's answer
and whose-turn-it-is come apart. A completed game where it is still nominally
your turn. One seat with `canRoll: true` and `canHold: false`. `canStartNewGame`
true while the game is `ACTIVE`. Those fixtures are what make the assertion
mean what its name says, and all three mutants now die.

Also covered: independent sign-in per seat with token separation asserted on the
`Authorization` header of individual requests, restoration of a stored session
and discard of a revoked one, the double-six message, the winner screen, and a
`GAME_REVISION_CONFLICT` producing a refetch and _no_ visible error.

## Browser end-to-end

Five Playwright scenarios, run against a production build of both apps on ports
3100/3101 and a database of their own. They cover the two-player match played
out to a win with the win count surviving the next game, a double six, a
refresh with two seats signed in, keyboard-only operation, and turn enforcement.

Two things make them deterministic rather than hopeful:

- **The dice are scripted.** `NODE_ENV=test` binds `DeterministicDiceGenerator`,
  so `roundScoreAfter(0)` in a spec is a number derived from the script rather
  than a literal somebody tuned until it passed. The generator is a singleton
  with one cursor shared by every game, which is why `workers: 1` and why every
  test winds the cursor to a known point before it starts — otherwise each
  scenario would silently depend on the roll count of the one before it.
- **`reuseExistingServer: false`.** A run that attached itself to a developer's
  `pnpm dev` would be playing in the development database with real dice and
  reporting the result as a pass.

The one worth reading is `turn-enforcement.spec.ts`, because its first attempt
proved nothing. It re-enabled Seat B's disabled Roll button in the DOM, clicked
it, and waited for the server's 403. No request was ever sent: React decides
whether to run `onClick` from the props in its own fiber, not from the
attribute, so the click bubbles in and is dropped. The spec now asserts both
halves separately — that the tampered click really fires and still gets nothing
out of the browser, and that the request it would have made, sent with Seat B's
own token, comes back `403 NOT_YOUR_TURN` with the game unmoved.

It also rolls once as Seat A at the end, purely so that the "no request was
sent" assertion has been watched to catch a request that _was_. Absence is not
evidence until the detector has been seen to fire.

## Guards that are themselves tested

A guard nobody has watched fail is a guard that might not work. This project
found three that did not: an architecture test whose denylist omitted the
frameworks it existed to exclude, a route test that could not see the routes
that were actually exposed, and a `sanitizeFilter` option that was silently
inert.

So the CI pipeline contains a job whose only purpose is to prove a guard fires:
it writes a file importing `mongoose`, `@nestjs/common` and `node:crypto`
alongside `Math.random` and `Date.now`, and fails the build if ESLint accepts
it.

## Running them

```bash
pnpm test                     # everything, no dependencies
pnpm test:integration         # needs `docker compose up -d`
pnpm test:e2e                 # needs MongoDB; builds and starts both apps itself
pnpm --filter @dice-game/api run test    # one package
```
