# Dice Game

A two-player dice game where **the backend owns every rule**. Two authenticated
players share one page; the React client sends commands and renders whatever the
API returns.

> **Tested, and deployable in one command.** 462 unit tests, 64 integration
> tests against a real MongoDB, 5 Playwright scenarios in a real browser.
> `compose.prod.yaml` runs the whole application — MongoDB, API, client and Caddy
> with automatic HTTPS — on a single host. See
> [docs/deployment.md](docs/deployment.md) for the command and for exactly what
> has and has not been verified.

![Two seats mid-match: Ada has rolled 5 and 2 for a round score of 7, her
controls are live and Seat B's Roll and Hold are
disabled.](apps/web/e2e/artifacts/match-in-progress.png)

The screenshot is not a mock-up and not hand-taken. `two-player-match.spec.ts`
writes it to `apps/web/e2e/artifacts/` partway through the run that plays a match
out to a win, so it can only be as current as the last passing suite.

## Rules

- Two players, taking turns. Every Roll throws **two dice**.
- A normal throw adds **both dice** to your round score. Keep rolling as long as
  you like.
- **6 and 6** wipes the round score and passes the turn. A single six is an
  ordinary six.
- **Hold** banks the round score into your global score and passes the turn.
  Holding on zero is legal — it is how you voluntarily pass.
- First to **reach or exceed** the winning score wins. Checked on hold only, so a
  hot streak is worth nothing until it is banked.
- Winning score defaults to **100**, configurable per game (2–1000).
- Either player may start a new game **at any time**. Win counts survive; scores
  do not.

## Every requirement, and where it is enforced

One row per mandatory requirement: what enforces it, and what proves it. Nothing
in this table is aspirational — each test named here exists and passes.

| Requirement                                 | Enforced by                                                                                                    | Proved by                                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React frontend                              | [`apps/web`](apps/web) — Next.js 15 App Router                                                                 | 71 tests                                                                                                                                                    |
| Backend API                                 | [`apps/api`](apps/api) — NestJS                                                                                | 376 tests + 64 integration                                                                                                                                  |
| Authentication                              | [`auth.service.ts`](apps/api/src/auth/auth.service.ts), Argon2id + JWT                                         | [`auth.service.test.ts`](apps/api/src/auth/auth.service.test.ts), [`auth.integration.spec.ts`](apps/api/src/auth/auth.integration.spec.ts)                  |
| Only authenticated users may create or play | Global `APP_GUARD`; four routes opt out via `@Public()`                                                        | [`app.routes.test.ts`](apps/api/src/app.routes.test.ts) — asserts the public set **equals** `PUBLIC_ROUTES`, at controller _and_ Express-router level       |
| Two authenticated users on one page         | [`seat-sessions.tsx`](apps/web/src/hooks/seat-sessions.tsx) — independent state machine and token per seat     | [`auth.test.tsx`](apps/web/src/app/auth.test.tsx) — token separation asserted on individual requests' `Authorization` headers                               |
| Backend manages player identities           | [`jwt-auth.guard.ts`](apps/api/src/auth/guards/jwt-auth.guard.ts) — identity only from the verified token      | [`jwt-auth.guard.test.ts`](apps/api/src/auth/guards/jwt-auth.guard.test.ts)                                                                                 |
| Backend owns all game state                 | [`domain/game.ts`](apps/api/src/domain/game.ts) — pure transitions over frozen state                           | [`game.test.ts`](apps/api/src/domain/game.test.ts) — 74 tests                                                                                               |
| Backend enforces the rules                  | [`standard-v1.ts`](apps/api/src/domain/rules/standard-v1.ts) — the only file that knows what a bust is         | [`standard-v1.test.ts`](apps/api/src/domain/rules/standard-v1.test.ts)                                                                                      |
| Membership validated                        | `requireTurn` → `NOT_A_PARTICIPANT`; reads are members-only too                                                | [`game.test.ts`](apps/api/src/domain/game.test.ts) `requireTurn check order`                                                                                |
| Turns validated                             | `requireTurn` → `NOT_YOUR_TURN`                                                                                | same, plus [`games.integration.spec.ts`](apps/api/src/games/games.integration.spec.ts)                                                                      |
| Two dice, generated server-side             | [`crypto-dice.generator.ts`](apps/api/src/games/adapters/crypto-dice.generator.ts) — `node:crypto` `randomInt` | [`dice-generator.provider.test.ts`](apps/api/src/games/adapters/dice-generator.provider.test.ts) — asserts production never resolves the scripted generator |
| Normal roll adds **both** dice              | `evaluateRoll` → `ADD_TO_ROUND` with the sum                                                                   | [`standard-v1.test.ts`](apps/api/src/domain/rules/standard-v1.test.ts) — all 36 pairs                                                                       |
| Roll repeatedly during a turn               | `applyRoll` leaves the turn where it is                                                                        | `accumulates across consecutive throws by the same player`                                                                                                  |
| **6 and 6** loses the round score           | `evaluateRoll` → `LOSE_ROUND_AND_PASS`                                                                         | `6 and 6 produces LOSE_ROUND_AND_PASS`; a single six is ordinary                                                                                            |
| **6 and 6** passes the turn                 | `applyRoll` applies the outcome                                                                                | `clears the round score and switches player` — asserted via a stand-in ruleset, so it tests the engine, not the rule                                        |
| Hold banks, resets, passes                  | `applyHold`                                                                                                    | `banks the round score and passes the turn`                                                                                                                 |
| First to reach **or exceed** wins           | `rules.hasWon`, checked on hold only                                                                           | `accumulates across turns until someone reaches the winning score`                                                                                          |
| Default winning score 100                   | `standardRulesV1.defaultWinningScore`                                                                          | `uses the ruleset default winning score when none is given`                                                                                                 |
| Custom winning score                        | `createGame`, frozen for the match                                                                             | `accepts a custom winning score`, plus bounds rejection                                                                                                     |
| New Game at any time                        | `startNewGame` — legal mid-match, preserves win counts                                                         | `is legal during an active game`, `preserving win counts`                                                                                                   |
| **No game logic in React**                  | Nothing to enforce — the absence is the property                                                               | `grep -rn "Math\." apps/web/src` → nothing; no die-face or `winningScore` comparison; no score arithmetic                                                   |

## The optional extras

The brief lists six optional additions. Four are implemented; two were declined,
and the reasons are here rather than left for a reviewer to guess.

| #   | Extra                                                | Status                                                                                                                                 |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Track how many times a player has won                | **Done.** `winCount` per seat, preserved across New Game and reset by nothing except a new pairing                                     |
| 2   | Persist data                                         | **Done.** MongoDB, behind a repository port; 64 integration tests run against a real `mongo:7.0`                                       |
| 3   | AI opponent                                          | **Not done** — see below                                                                                                               |
| 4   | On 6 & 6, disable actions briefly and show a message | **Done.** [`use-double-six-pause.ts`](apps/web/src/hooks/use-double-six-pause.ts), 1600 ms, with a callout and a live-region narration |
| 5   | Sound effects or background music                    | **Not done** — see below                                                                                                               |
| 6   | Any other creative additions                         | Versioned rules policy, full keyboard/screen-reader support, deterministic browser tests, an independent validation report             |

**Why no AI opponent.** It is the one extra that would have changed the
architecture rather than added to it, and doing it properly means deciding
whether a bot is a _player_ (a second identity, authenticated, with a token) or
a _policy_ the server applies on one seat's behalf. The first needs a machine
identity in an auth model built for humans; the second puts an actor inside the
API that no request drives, which is a scheduler, not an endpoint. Either is a
day's work done well and an afternoon's work done badly, and a shallow version
would sit exactly where the design is most load-bearing. The shape it would take
is written up in [docs/assumptions.md](docs/assumptions.md).

**Why no sound.** Nothing here is hostile to it; it simply buys less than
anything else the same time could go to. The double-six moment is already
announced to a screen reader through a polite live region, which is the version
of "feedback on a bust" that a keyboard user gets, and it is tested.

Two features were **dropped rather than computed** to keep that last row true: a
progress bar toward the target (division on scores) and naming who threw the
double six (not derivable from a view that arrives with the turn already
passed).

## Layout

```
apps/
  api/          NestJS. All game rules, all state.        ← domain + API done
  web/          Next.js App Router. Renders, never decides.  ← done
packages/
  contracts/    Zod schemas + types. The wire contract.   ← frozen
  eslint-config/
  typescript-config/
```

## Quick start

Needs Node 20.11+, pnpm, and Docker (Docker Desktop on Windows and macOS).

```bash
pnpm install --frozen-lockfile
docker compose up -d          # MongoDB on 127.0.0.1:27017
pnpm dev                      # API :3001, web :3000
```

Then open **`http://localhost:3000`**.

Use `localhost`, not `127.0.0.1`. The two are different origins to a browser,
and the API's `CORS_ORIGIN` defaults to `http://localhost:3000`, so the page
loads from the IP but every request is refused — and the client reports it as
"Could not reach the server", which points at the wrong thing. Set `CORS_ORIGIN`
if you want a different host.

### Two demo players

Seeding is opt-in: `db:seed` refuses unless `SEED_DEMO_USERS=true`, so it cannot
happen as a side effect of running a setup command. Setting an environment
variable for one command is the one place the shells differ.

```bash
# bash / zsh
SEED_DEMO_USERS=true pnpm db:seed
```

```powershell
# PowerShell
$env:SEED_DEMO_USERS = "true"; pnpm db:seed
```

```bat
:: cmd.exe
set SEED_DEMO_USERS=true && pnpm db:seed
```

That creates `ada@example.com` / `demo-password-ada` and `grace@example.com` /
`demo-password-grace`. It is idempotent, and it refuses outright when
`NODE_ENV=production` — before it opens a connection. You can skip it entirely
and use **Create account** on each seat instead.

### The checks

```bash
pnpm test                     # 462 tests, no database or browser needed
pnpm test:integration         # 64 more, against the real MongoDB above
pnpm test:e2e                 # 5 Playwright scenarios in a real browser
pnpm build
```

`test:e2e` needs a browser binary the first time, on any machine:

```bash
pnpm --filter @dice-game/web exec playwright install chromium
```

It then builds both apps and starts them on 3100/3101 against a database of its
own, so nothing needs to be running first — but it does need MongoDB, and it
will not attach to a dev server you already have up.

## The design, in one claim

Game behaviour lives in framework-independent domain code that cannot import
NestJS, Mongoose, HTTP, the clock, or a random source — enforced by a lint rule,
not by convention. Scoring is a **versioned rules policy** (`standard@1`)
resolved through an allow-listed registry, and every game persists the ruleset
identity it was played under.

The claim that buys is: **changing which combination loses touches one source
file and its own test file.** That is verifiable rather than aspirational — flip
`BUST_FACE` in `apps/api/src/domain/rules/standard-v1.ts` from 6 to 5 and exactly
five tests fail, all of them in `rules/standard-v1.test.ts`. The 74 engine tests
keep passing, because engine fixtures reach a bust or a banked total through
stand-in rulesets rather than by naming a die face.

The wire contract makes the frontend structurally unable to cheat:

- Roll and Hold carry no dice, no score, no actor — only `expectedRevision`. A
  contract test asserts those fields are rejected.
- The server sends `availableActions: { canRoll, canHold, canStartNewGame }`, so
  the client never derives legality. Tests assert each boolean agrees with what
  the matching transition would actually do.
- The server sends `effect` (`NORMAL_ROLL` / `DOUBLE_SIX` / `HELD` / `GAME_WON` /
  `NEW_GAME`), so the client animates a double six without ever deciding what one
  is. The effect is named by the ruleset, not by the engine.

The client holds up its end. There is no comparison against a die face, no
comparison against the winning score, no arithmetic on any score, and no
`Math.` anywhere in `apps/web/src`. Two things the UI would have liked are
absent rather than inferred: which seat threw the double six (the view arrives
with the turn already passed) and any progress indicator toward the target,
which would be division on scores. Both are reported as contract gaps instead of
computed locally.

Authorization is default-deny: a global guard protects everything and four
routes opt out. That is asserted by equality against the contract's
`PUBLIC_ROUTES`, at two levels — the controllers Nest registers, and the Express
router itself. The second exists because Swagger mounts on the raw adapter, so
it is invisible to the first; a security review found seven unauthenticated,
unthrottled documentation paths hiding in exactly that gap.

## Phase status

| Phase                           | State                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| 1. Foundation + frozen contract | done                                                                                   |
| 2. Domain engine + rules policy | done — reviewed, 116 tests                                                             |
| 3. Auth + API                   | done — reviewed, 376 tests                                                             |
| 4. MongoDB persistence          | done — 64 integration tests on real mongod                                             |
| 5. Next.js client               | done — reviewed, 71 tests                                                              |
| 6. Docker + CI/CD               | image, Fly config and deploy workflow written; **image never built, nothing deployed** |
| 7. Browser end-to-end           | done — 5 scenarios, deterministic dice                                                 |
| 8. Security hardening           | done inline; three gaps named in [docs/security.md](docs/security.md)                  |
| 9. Documentation                | done                                                                                   |
| 10. Final audit                 | done — [final validation report](docs/final-validation-report.md): **PARTIAL PASS**    |

Working conventions, invariants and the gotchas that produced them:
[AGENTS.md](AGENTS.md).
