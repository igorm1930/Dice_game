# Dice Game

A two-player dice game where **the backend owns every rule**. Two authenticated
players share one page; the React client sends commands and renders whatever the
API returns.

> **Rebuild in progress.** This branch is being rebuilt as a pnpm monorepo on
> NestJS + MongoDB + Next.js. The domain engine and the wire contract are done;
> the API, the client, and the deployment pipeline are not. Phase status is at
> the bottom. The previous Express implementation was removed in this branch and
> remains in git history.

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

## Layout

```
apps/
  api/          NestJS. All game rules, all state.        ← domain layer done
  web/          Next.js App Router.                        ← not started
packages/
  contracts/    Zod schemas + types. The wire contract.   ← frozen
  eslint-config/
  typescript-config/
```

## Quick start

```bash
pnpm install --frozen-lockfile
docker compose up -d          # MongoDB
pnpm test                     # 130 tests
```

`pnpm db:seed` and `pnpm dev` arrive with the API in Phase 3.

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

## Phase status

| Phase                               | State                                        |
| ----------------------------------- | -------------------------------------------- |
| 1. Foundation + frozen contract     | done                                         |
| 2. Domain engine + rules policy     | done — 115 tests                             |
| 3. Auth + API                       | not started                                  |
| 4. MongoDB persistence              | not started                                  |
| 5. Next.js client                   | not started                                  |
| 6. Docker + CI/CD                   | CI ported to pnpm; images and deploy pending |
| 7–10. Tests, hardening, docs, audit | not started                                  |

Working conventions, invariants and the gotchas that produced them:
[AGENTS.md](AGENTS.md).
