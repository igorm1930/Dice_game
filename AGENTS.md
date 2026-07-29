# Working in this repository

Conventions, boundaries and gotchas for anyone — human or agent — changing code
here. Not a description of how the project was produced; a description of how to
work in it.

## Layout

```
apps/
  api/          NestJS. Owns all game rules and all state.
  web/          Next.js App Router. Renders what the API returns.
packages/
  contracts/    Zod schemas + inferred types. The wire contract. Both apps depend on it.
  eslint-config/
  typescript-config/
infrastructure/fly/
docs/
```

## The one rule that matters

**The backend is authoritative for everything: dice, active player, round score,
global scores, winning score, valid actions, status, winner, win counts.**

The frontend sends commands and renders responses. It does not decide whether a
roll was a bust, whose turn it is, whether a button should be enabled, or who
won. Those arrive as `effect`, `activePlayer`, `availableActions` and `winner`.

If you find yourself writing a comparison against `winningScore` in `apps/web`,
stop — the answer belongs in a field the API already sends, or in a field it
should start sending.

## Contracts are frozen

`packages/contracts` is the barrier the whole build depends on. Both apps derive
their types from the same Zod schemas, so a field cannot drift on one side
without failing the build on the other.

Changing it invalidates work in progress elsewhere. Announce a contract change
before making it; never widen a schema locally to unblock yourself.

Add a contract test in `src/contracts.test.ts` whenever you add a rule that two
sides must agree on — the existing ones assert things like "every error code has
exactly one HTTP status" and "no write command accepts an actor id".

## Domain purity is enforced by the linter, not by convention

Anything under `apps/api/src/domain/**` may not import a framework, a driver,
the network, the clock, the environment, or a random source. `no-restricted-imports`
in `@dice-game/eslint-config/base` enforces it with patterns, and
`no-restricted-properties` blocks `Math.random`, `Date.now` and `process.env`.

This is deliberately a linter rule rather than a bespoke architecture test. The
previous generation of this repository had such a test, and it compared imports
against a hardcoded list of seven names that did not include the frameworks it
was meant to keep out — so it would have passed while the domain imported
Mongoose. A pattern-based rule fails closed.

Inject what you need through a port. `DiceGenerator` is the reason `Math.random`
is banned: production uses `node:crypto`, tests use a deterministic sequence, and
the deterministic one is bound only by `DICE_SOURCE=scripted`, which production
refuses outright.

## Auth invariants

Preserve these; each is asserted by a test, and each was a deliberate decision:

- **Guards are default-deny.** A global `APP_GUARD` protects everything;
  `@Public()` opts individual routes out. A controller whose decorator was
  forgotten fails closed. `PUBLIC_ROUTES` in the contract is the allow-list.
- **Identity never comes from a request body.** No endpoint accepts an actor id.
  The acting user is derived from the verified JWT, always.
- **Login is not an enumeration oracle.** An unknown email and a wrong password
  return the same body and cost the same CPU — the unknown-email path performs a
  throwaway hash verification so timing does not leak which accounts exist.
- **Revocation is real.** Logout bumps `tokenVersion` on the user; the guard
  compares it to the claim. A stateless JWT alone would leave logout cosmetic.
- **`TRUST_PROXY_HOPS` must match the real topology.** Too high and a client
  forges `X-Forwarded-For` to reset its own rate limit; too low and everyone
  keys on the load balancer's IP.

## Commands

```bash
pnpm install --frozen-lockfile
docker compose up -d          # MongoDB
pnpm db:seed                  # two demo players; needs SEED_DEMO_USERS=true, see below
pnpm dev                      # api :3001, web :3000

pnpm lint
pnpm typecheck
pnpm test                     # unit
pnpm test:integration         # API against a real MongoDB
pnpm test:e2e                 # Playwright, deterministic dice
pnpm build
pnpm format:check
```

Turbo runs these per package; `--filter=@dice-game/api` scopes to one.

Two of those lines are not portable, and both are in the path a first-time
reader follows:

- `SEED_DEMO_USERS=true pnpm db:seed` is bash. PowerShell reads it as a command
  name and answers _"The term 'SEED_DEMO_USERS=true' is not recognized"_; use
  `$env:SEED_DEMO_USERS = "true"; pnpm db:seed`. The README gives all three
  shells. Everything else is portable — the `&&` inside `db:seed` runs under
  `cmd.exe` via pnpm regardless of the interactive shell.
- `pnpm test:e2e` needs a browser binary that no install step fetches:
  `pnpm --filter @dice-game/web exec playwright install chromium`, once per
  machine. CI does this explicitly and the development container ships Chromium
  preinstalled, which is exactly why it went unnoticed — neither environment
  ever runs the command a new clone runs.

**Turbo deletes environment variables it was not told about.** Turbo 2 defaults
to `envMode: strict`, so a task sees `globalEnv` plus its own `env` /
`passThroughEnv` and nothing else. Two of the commands above were broken by this
and nobody noticed, because each failed in a way that looked like something
else: `SEED_DEMO_USERS=true pnpm db:seed` answered _"Refusing to seed:
SEED_DEMO_USERS is false"_, and `pnpm test:e2e` reported Chromium missing when
`PLAYWRIGHT_BROWSERS_PATH` had simply been stripped. CI hid both — it runs
`pnpm --filter @dice-game/web run test:e2e`, which never goes through turbo.

So: adding a variable that a task reads at runtime means adding it to that
task's `passThroughEnv` in `turbo.json`. Use `env` instead only when the value
should change the cache key. `turbo run <task> --dry=json` prints what the task
will actually receive.

Also note `pnpm test --force` does not do what it looks like: `test` is a pnpm
builtin, so the flag never reaches turbo, and `pnpm run test -- --force` hands it
to vitest, which rejects it. To defeat the cache use
`pnpm exec turbo run test --force`.

`db:seed` refuses unless `SEED_DEMO_USERS=true`, and refuses outright when
`NODE_ENV=production` — before it opens a connection. `.env.example` ships the
flag `false` deliberately: seeding is something you ask for, not something that
happens because you ran a setup command. It is idempotent, so a second run
leaves existing players untouched.

## The dependency audit

`pnpm audit --prod --audit-level=high` blocks CI. One advisory is suppressed by
GHSA id in the root `package.json`:

- **GHSA-mh99-v99m-4gvg** (`brace-expansion`, DoS via unbounded expansion).
  Reached only through `eslint > minimatch`, so it is a lint-time dependency that
  never ships. `pnpm why brace-expansion --prod` returns nothing. Not fixable
  here — it needs ESLint to bump `minimatch`. Remove the entry once it does.

One is **fixed** rather than suppressed, via a `pnpm.overrides` entry:

- **GHSA-pm4m-ph32-ghv5** (`js-yaml`, arrived with `@nestjs/swagger`). A patched
  release existed and `@nestjs/swagger` was already at its latest, so the
  override pins the transitive dependency forward. Prefer this over an ignore
  whenever a patched version exists — an ignore is a permanent decision recorded
  for a temporary problem.

Suppress by id, never by lowering `--audit-level`: dropping the threshold to
hide one advisory hides every future one too. The audit still prints
`1 ignored`, so the suppression stays visible.

Note that `--prod` does not reliably scope to production dependencies in a pnpm
workspace — it flagged this dev-only path — which is why the ignore list is
needed rather than the flag being sufficient.

## Docker and pnpm

pnpm's store is symlinked, so `COPY --from=deps /app/node_modules` produces a
tree of broken links. The API image must materialise a real directory instead:

```dockerfile
RUN pnpm deploy --filter=@dice-game/api --prod /out
```

Do not reach for `node-linker=hoisted` to work around this — it defeats pnpm's
strictness across the whole workspace to solve a problem that belongs to one
build stage.

## Testing conventions

- No mocking frameworks. Test doubles are hand-written fakes implementing the
  port interfaces — the previous suite had zero `jest.mock()` calls and was
  better for it.
- Rules tests and engine tests stay separate. A rules test asserts "6 and 6
  produces `LOSE_ROUND_AND_PASS`"; an engine test asserts "`LOSE_ROUND_AND_PASS`
  clears the round score and switches player". Conflating them means changing a
  rule breaks engine tests for no reason.
- **Engine fixtures never name a die face.** Use the `score`, `bust` and `bank`
  helpers in `game.test.ts`, which drive transitions through a stand-in ruleset.
  A fixture that reaches a banked total by throwing `[5, 5]` is silently
  asserting that 5 and 5 is not the losing combination. This is verifiable: flip
  `BUST_FACE` in `rules/standard-v1.ts` from 6 to 5 and exactly five tests fail,
  all of them in `rules/standard-v1.test.ts`. If that change ever breaks a test
  outside `rules/`, the abstraction has leaked.
- Deliberate end-to-end tests of `standard@1` live in `rules/standard-v1.test.ts`
  alongside the rule they depend on, not in the engine suite.
- E2E uses deterministic dice and a low winning score. That is why
  `MIN_WINNING_SCORE` is 10, which the scripted dice clear in one turn (3+4 then
  1+2). It was 2 for a while so a match could be won in a single hold; that was a
  product bound moved for a test's convenience, and no test ever needed it.

### Three ways a Playwright assertion here lies to you

- **`getByRole`'s `name` is a substring match.** `{ name: 'Seat A' }` also matches
  the region called "Seat A controls", so it resolves to two elements the moment
  a match is on screen. The accessible names are fine; pass `exact: true`.
- **`page.getByRole('alert')` is never empty.** Next.js's App Router mounts a
  `next-route-announcer` — an empty `role="alert"` outside the app root, on every
  page. Scope alert assertions to the region that would render the error.
- **You cannot defeat a disabled React button from the DOM.** Setting
  `button.disabled = false` and clicking dispatches a real click that bubbles,
  and React still drops it: it decides whether to run `onClick` from the props in
  its own fiber, not from the attribute. Nothing leaves the browser. To prove the
  _server_ refuses something, send the request — `attemptRoll` in
  `e2e/support/api.ts` returns the refusal instead of throwing on it.

`apps/web/e2e/artifacts/match-in-progress.png` is committed on purpose — it is
the README's screenshot, and having the suite produce it is what stops that
image drifting from the app. The cost is that `pnpm test:e2e` rewrites it every
run (the player names are randomised per run), so a clean tree goes dirty.
`git checkout apps/web/e2e/artifacts` if you did not mean to update it.

### Build the fixture where the answer could differ

The most expensive class of bug in this repository is not a wrong assertion. It
is a **correct assertion over a fixture in which it cannot fail**, and it has
appeared four times.

The rule: when a test asserts that behaviour follows from a _particular source_,
construct the case where that source and every plausible alternative **disagree**.
If you cannot construct it, the test is not testing what its name says.

Worked example, and the reason `game-board.test.tsx` has a `disagree` block. The
client must disable Roll because the server sent `canRoll: false`, not because it
worked out whose turn it is. Every early fixture happened to satisfy
`canRoll === (viewerSeat === activePlayer)` — so a client deriving legality
locally passed all 44 tests, **including the one named "disables Roll because the
server said canRoll is false, not because the client decided"**. The fix is a
position where it _is_ your turn and the server still says no: a finished game.

The others, same shape:

- The winner fixture gave the server-named winner the higher score too, so
  `nameOf(view, view.winner)` could be swapped for a score comparison undetected.
- `startNewGame`'s round-score reset could be deleted with the suite green,
  because every fixture arrived through a hold that had already zeroed it.
- The immutability tests only ever passed frozen states, so `Object.freeze` was
  doing the work the assertion claimed.

The reliable way to find these is to break the code and check the suite notices.
"Does it pass?" is a much weaker question than "what would I have to break for it
to fail?".

## Things that bit us before

- A router mounted without its auth middleware shipped five unauthenticated
  gameplay endpoints, while the README asserted the opposite. Hence default-deny.
- One global match meant a third player starting a game silently destroyed a
  match in progress. Games are addressed by id; membership is checked on read
  and on write.
- A rollback deploy skipped the entire verify job but still pushed `latest`.
  Every path that publishes an image runs the full check suite first.
- Fly's first deploy creates an HA pair by default and `min_machines_running`
  does not cap machine count.
- Configuration that looks applied and is not: `sanitizeFilter` passed through
  `openUri` is filed where Mongoose's `Query` never reads it, and `dbName`
  silently overrides the database named in `MONGODB_URI`. Both logged success.
  Check the effect, not the setting.
