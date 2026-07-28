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
the deterministic one must be unreachable outside tests.

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
pnpm db:seed                  # two demo players
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
- E2E uses deterministic dice and a low winning score. That is why
  `MIN_WINNING_SCORE` is 2 rather than 10 — a match can be won in one hold.

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
