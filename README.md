# Dice Game Service

A production-ready dice game backend built with **Express 4 + TypeScript**, using
a ports-and-adapters architecture with an in-memory repository.

The game itself is small on purpose. The interesting parts are the seams: how
persistence is abstracted, how concurrency is handled, how failures surface, and
how the thing gets built, verified, and deployed.

```
248 tests · 99% statement coverage · 89% branch coverage · 0 lint errors
```

---

## Table of contents

- [Quick start](#quick-start)
- [The Pig Game (full-stack)](#the-pig-game-full-stack)
- [The guiding principle](#the-guiding-principle)
- [Architecture](#architecture)
- [Request lifecycle](#request-lifecycle)
- [Game rules](#game-rules)
- [API reference](#api-reference)
- [Concurrency: the interesting problem](#concurrency-the-interesting-problem)
- [Production readiness](#production-readiness)
- [Testing strategy](#testing-strategy)
- [Deployment](#deployment)
- [Architecture Decision Records](#architecture-decision-records)
- [What I deliberately did not build](#what-i-deliberately-did-not-build)

---

## Quick start

```bash
# Local
npm install
cp .env.example .env
npm run dev                      # http://localhost:3000

# Verify everything
npm run lint && npm run typecheck && npm test

# Docker
docker compose up --build
```

Play a game:

```bash
# Create
GAME=$(curl -s -X POST http://localhost:3000/api/v1/games \
  -H 'Content-Type: application/json' \
  -d '{"playerName":"Ada","rounds":3}')

ID=$(echo "$GAME" | jq -r '.data.id')

# Roll
curl -s -X POST "http://localhost:3000/api/v1/games/$ID/rolls" | jq '.data.round'

# Leaderboard
curl -s http://localhost:3000/api/v1/leaderboard | jq
```

---

## The Pig Game (full-stack)

The service also hosts a two-player, turn-based **Pig** dice game with a React
frontend — added as a parallel vertical (own domain module, port, repository,
service, controller) without touching a single existing game file, which is the
ports architecture doing exactly what it promised.

**Rules (enforced server-side only):** roll a die — a **6 busts**, wiping your
turn score and passing play; 1–5 accumulate. HOLD banks the turn score; first
to the match's target wins. The target is chosen at NEW GAME (**default 100**,
playable range 2–1000, `PIG_TARGET_SCORE` sets the default) and is frozen for
the match. Roll and hold accept **no request body at all** — every in-match
rule lives in `PigGameService`, so there is nothing a modified client could
send to cheat with; the target is the single, validated setup input. The UI is
a pure renderer — it draws whatever `GET /api/v1/pig-game` returns (even the
die face comes from the server's `lastRoll`) and posts bare actions.

| Method | Endpoint                    | Meaning                                   |
| ------ | --------------------------- | ----------------------------------------- |
| `GET`  | `/api/v1/pig-game`          | Current shared state                      |
| `POST` | `/api/v1/pig-game/roll`     | Roll the die                              |
| `POST` | `/api/v1/pig-game/hold`     | Bank the turn score                       |
| `POST` | `/api/v1/pig-game/new-game` | Reset — optional `{ "targetScore": 100 }` |

Actions on a finished game return `409 PIG_GAME_OVER` — the UI disables its
buttons, but the backend does not rely on that.

```bash
# Frontend development (two terminals)
npm run dev                       # API on :3000
cd client && npm ci && npm run dev   # UI on :5173, proxied to the API

# Production composition — Express serves the built UI at /
npm run build:client && npm run build && npm start   # open http://localhost:3000

# Docker builds both automatically (multi-stage) — same one-liner as before
docker compose up --build
```

The client build lands in `client/dist`; `createApp` serves it statically only
when that directory exists, so API-only deployments and the test suite are
untouched. Open the page in two tabs: both render the same server-owned match,
which is the "backend as source of truth" property made visible.

---

## The guiding principle

> **Abstract the boundaries. Don't build the implementations you don't need yet.**

The temptation in a take-home like this is to demonstrate breadth by adding
PostgreSQL, Redis, a message queue, and a DI framework. That produces a system
where most components exist to be impressive rather than to solve a problem.

The approach here is the opposite, and it is applied consistently:

| Concern     | Interface (built) | Implementation (chosen) | Deferred                                                  |
| ----------- | ----------------- | ----------------------- | --------------------------------------------------------- |
| Persistence | `GameRepository`  | In-memory `Map`         | PostgreSQL                                                |
| Randomness  | `RandomGenerator` | `crypto.randomInt`      | —                                                         |
| Time        | `Clock`           | System clock            | —                                                         |
| Identity    | `IdGenerator`     | UUID v4                 | —                                                         |
| Locking     | `KeyedLock`       | In-process mutex        | Distributed lock                                          |
| Caching     | _(none)_          | _(none)_                | Redis — see [ADR-0002](docs/adr/0002-no-caching-layer.md) |

Every deferred item has a written justification and a **named trigger** for
revisiting it. The cost of the abstraction is paid up front; the cost of the
infrastructure is not paid at all until something needs it.

Migrating to PostgreSQL is a one-line change in `src/container.ts` plus a new
class. No service, controller, domain, or route file changes — and an automated
test enforces that this stays true.

---

## Architecture

### Layers and the dependency rule

```mermaid
graph TB
    subgraph HTTP["🌐 Delivery Layer — src/http"]
        R[Routes]
        C[Controllers]
        M[Middleware]
        D[DTOs + Zod schemas]
        MAP[Mappers]
    end

    subgraph CORE["💎 Application Core — src/core"]
        SVC[GameService]
        subgraph DOMAIN["Domain — pure, zero dependencies"]
            E[Game aggregate]
            SC[Scoring rules]
            ERR[Domain errors]
        end
        subgraph PORTS["Ports — interfaces only"]
            P1[GameRepository]
            P2[RandomGenerator]
            P3[Clock]
            P4[IdGenerator]
            P5[KeyedLock]
        end
    end

    subgraph INFRA["🔌 Infrastructure — src/infrastructure"]
        A1[InMemoryGameRepository]
        A2[CryptoRandomGenerator]
        A3[SystemClock]
        A4[UuidGenerator]
        A5[AsyncMutex]
        A6[Pino logger]
    end

    ROOT["⚙️ Composition Root — src/container.ts"]

    R --> C
    C --> MAP
    C --> SVC
    M -.->|cross-cutting| R

    SVC --> E
    SVC --> SC
    SVC --> P1 & P2 & P3 & P4 & P5

    A1 -.->|implements| P1
    A2 -.->|implements| P2
    A3 -.->|implements| P3
    A4 -.->|implements| P4
    A5 -.->|implements| P5

    ROOT ==>|wires everything| SVC
    ROOT ==> A1 & A2 & A3 & A4 & A5 & A6

    classDef core fill:#1f6feb,stroke:#0d419d,color:#fff
    classDef infra fill:#8957e5,stroke:#6639ba,color:#fff
    classDef http fill:#238636,stroke:#1a612b,color:#fff
    classDef root fill:#bb8009,stroke:#845306,color:#fff

    class E,SC,ERR,SVC,P1,P2,P3,P4,P5 core
    class A1,A2,A3,A4,A5,A6 infra
    class R,C,M,D,MAP http
    class ROOT root
```

**The dependency rule: arrows point inward.** The core defines interfaces;
infrastructure implements them. The core imports nothing from `http/` or
`infrastructure/` — not Express, not Pino, not the repository it uses.

This is not a convention the reader has to trust.
[`tests/architecture/layer-boundaries.test.ts`](tests/architecture/layer-boundaries.test.ts)
parses the import graph and fails CI on violation. It also enforces that adapters
are instantiated only in the composition root, that `process.env` is read only in
config, that no `console.*` call exists, and that no async route escapes its
error-handling wrapper.

### Project layout

```
src/
├── config/env.ts                     Zod-validated config, fail-fast at boot
│
├── core/                             ← zero framework dependencies
│   ├── domain/
│   │   ├── game.ts                   Immutable aggregate + transitions
│   │   ├── scoring.ts                The rulebook (pure function)
│   │   ├── dice.ts                   DieValue literal union
│   │   └── errors.ts                 Domain errors — codes, no HTTP statuses
│   ├── ports/                        Interfaces the core depends on
│   └── services/game.service.ts      Use-case orchestration
│
├── infrastructure/                   ← adapters
│   ├── persistence/                  In-memory repo (clone + version guard)
│   ├── concurrency/async-mutex.ts    Per-key serialisation
│   ├── random/, time/, id/           Deterministic-under-test adapters
│   └── logging/                      Pino + AsyncLocalStorage context
│
├── http/                             ← delivery
│   ├── app.ts                        Middleware assembly
│   ├── controllers/, routes/
│   ├── middleware/                   Correlation, validation, errors, limits
│   ├── dto/                          Request schemas + response contracts
│   └── mappers/                      Domain → wire (anti-corruption layer)
│
├── container.ts                      Composition root
└── server.ts                         Bootstrap, signals, graceful drain

tests/
├── unit/                             Domain, service, adapters, middleware
├── integration/                      Full stack via supertest
└── architecture/                     Layering rules as executable assertions
```

---

## Request lifecycle

A roll, end to end:

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant MW as Middleware
    participant Ctrl as GameController
    participant Svc as GameService
    participant Lock as AsyncMutex
    participant Dom as Domain
    participant Repo as GameRepository

    Client->>MW: POST /api/v1/games/:id/rolls
    MW->>MW: correlation id → AsyncLocalStorage
    MW->>MW: helmet · cors · rate limit
    MW->>MW: Zod validation (:id is a UUID)

    MW->>Ctrl: rollDice(req, res)
    Ctrl->>Svc: rollDice(gameId)

    rect rgb(255, 245, 225)
        note over Svc,Repo: Critical section — serialised per game id
        Svc->>Lock: withLock(gameId)
        Lock-->>Svc: acquired
        Svc->>Repo: findById(gameId)
        Repo-->>Svc: Game (version N)
        Svc->>Dom: rollDice(random) → playRound(game, dice, now)
        Dom-->>Svc: { game, round } or throws
        Svc->>Repo: update(game)  [guard: version === N]
        Repo-->>Svc: Game (version N+1)
        Svc->>Lock: release
    end

    Svc-->>Ctrl: { game, round }
    Ctrl->>Ctrl: toRoundResponse / toGameResponse
    Ctrl-->>Client: 201 + { data, meta.requestId }

    note over Dom: On a completed game the domain throws<br/>GameAlreadyCompletedError → mapped to 409
```

### Game state machine

```mermaid
stateDiagram-v2
    [*] --> IN_PROGRESS: POST /games
    IN_PROGRESS --> IN_PROGRESS: roll (rounds played < total)
    IN_PROGRESS --> COMPLETED: roll (final round) — auto-completes
    COMPLETED --> COMPLETED: roll → 409 GAME_ALREADY_COMPLETED
    COMPLETED --> [*]
```

Completion is a **consequence of the rules**, not a separate endpoint. There is
no way for a client to forget to finish a game, and no way to reach an
inconsistent state.

---

## Game rules

Two dice per round. Rules are evaluated in strict precedence order:

| Precedence | Outcome       | Condition       | Points                              |
| ---------- | ------------- | --------------- | ----------------------------------- |
| 1          | `SNAKE_EYES`  | Both dice are 1 | **0** — overrides the doubles bonus |
| 2          | `DOUBLES`     | Both dice match | pips **× 2**                        |
| 3          | `LUCKY_SEVEN` | pips = 7        | pips **+ 10**                       |
| 4          | `STANDARD`    | anything else   | pips                                |

Score range per round: **0** (snake eyes) to **24** (double sixes).

The rulebook is a pure function of the dice
([`src/core/domain/scoring.ts`](src/core/domain/scoring.ts)), so the test suite
**exhaustively enumerates all 36 possible rolls** rather than sampling — along
with symmetry (die order never matters) and the non-negative-score invariant.

---

## API reference

Base path: `/api/v1`

| Method | Endpoint               | Description            | Success       |
| ------ | ---------------------- | ---------------------- | ------------- |
| `POST` | `/games`               | Create a game          | `201`         |
| `GET`  | `/games`               | List games (paginated) | `200`         |
| `GET`  | `/games/:gameId`       | Fetch one game         | `200`         |
| `POST` | `/games/:gameId/rolls` | Play a round           | `201`         |
| `GET`  | `/leaderboard`         | Top completed games    | `200`         |
| `GET`  | `/healthz`             | Liveness probe         | `200`         |
| `GET`  | `/readyz`              | Readiness probe        | `200` / `503` |

### Response envelope

Every response — success or failure — carries `meta.requestId`, which correlates
to every log line for that request.

```jsonc
// 201 POST /api/v1/games
{
  "data": {
    "id": "3f8ce84a-2aa4-4867-817c-1239893ce78a",
    "playerName": "Ada",
    "status": "IN_PROGRESS",
    "totalRounds": 3,
    "roundsPlayed": 0,
    "roundsRemaining": 3,
    "totalScore": 0,
    "rounds": [],
    "createdAt": "2026-07-27T09:40:49.136Z",
    "completedAt": null,
  },
  "meta": {
    "requestId": "1272ddd6-ce82-4302-be10-ed13336db068",
    "timestamp": "2026-07-27T09:40:49.136Z",
  },
}
```

```jsonc
// 409 POST /api/v1/games/:id/rolls  (game already finished)
{
  "error": {
    "code": "GAME_ALREADY_COMPLETED",
    "message": "Game '3f8ce…' has already played all 3 of its rounds and cannot be rolled again.",
    "details": { "gameId": "3f8ce…", "totalRounds": 3 },
  },
  "meta": { "requestId": "9f0ab918-…", "timestamp": "2026-07-27T09:40:49.393Z" },
}
```

Clients branch on the stable `code`, never on message text.

### Error codes

| Code                     | Status | Meaning                                 |
| ------------------------ | ------ | --------------------------------------- |
| `VALIDATION_ERROR`       | 400    | Payload failed schema validation        |
| `MALFORMED_REQUEST_BODY` | 400    | Body was not valid JSON                 |
| `GAME_NOT_FOUND`         | 404    | No such game                            |
| `ROUTE_NOT_FOUND`        | 404    | No such endpoint                        |
| `GAME_ALREADY_COMPLETED` | 409    | All rounds already played               |
| `CONCURRENCY_CONFLICT`   | 409    | Write against a stale snapshot          |
| `PAYLOAD_TOO_LARGE`      | 413    | Body exceeded the limit                 |
| `INVALID_ROUND_COUNT`    | 422    | Well-formed, but violates a domain rule |
| `RATE_LIMIT_EXCEEDED`    | 429    | Too many requests                       |
| `INTERNAL_SERVER_ERROR`  | 500    | A bug — opaque by design                |

The **400 vs 422** split is deliberate: `{"rounds": "abc"}` is malformed (400);
`{"rounds": 50}` against a limit of 20 is well-formed but domain-invalid (422).

Full contract: [`docs/openapi.yaml`](docs/openapi.yaml).

---

## Concurrency: the interesting problem

This is the part of the assignment worth the most attention.

Playing a round is a read–modify–write across two `await` boundaries. **Node
being single-threaded does not make that atomic** — every `await` is a yield
point where the event loop runs another request.

Without protection:

```
Request A: findById  → version 0, 0 rounds
Request B: findById  → version 0, 0 rounds     ← same snapshot
Request A: update    → version 1, 1 round
Request B: update    → version 1, 1 round      ← A's round silently gone
```

Both clients get `201`. Two rounds were reported. One exists. Silent data loss —
the worst kind.

**Two layered defences:**

1. **A keyed mutex** (`KeyedLock` port) serialises the critical section _per game
   id_. Different games never block each other. This prevents the conflict, so
   clients are never asked to retry.

2. **Optimistic versioning** in the repository refuses any write against a stale
   version, raising a 409. This is a correctness backstop: the mutex is
   in-process, so it silently stops working at two replicas — and it would fail
   by resuming exactly the data loss above. The version guard converts that from
   _silent corruption_ into a _loud, correct error_.

The version field also ports directly to SQL (`UPDATE … WHERE version = $1`) when
the repository is swapped.

Proven at three levels — [ADR-0004](docs/adr/0004-concurrency-control.md) has the
full reasoning:

```ts
// tests/integration/game.api.test.ts — five concurrent HTTP rolls
const responses = await Promise.all(
  Array.from({ length: 5 }, () => request(app).post(`/api/v1/games/${id}/rolls`)),
);
expect(indexes).toEqual([1, 2, 3, 4, 5]); // none lost, none duplicated
```

---

## Production readiness

### Observability

- **Structured NDJSON to stdout.** No files, no rotation — the container runtime
  owns log shipping (12-factor XI). `pino-pretty` for local dev only.
- **Correlation ids** propagated via `AsyncLocalStorage` and stamped onto every
  log line by a pino mixin — without appearing in a single business signature.
  Returned in both the response header and body.
- **Inbound ids are validated, not trusted.** Anything outside a safe charset is
  replaced with a fresh UUID: echoing arbitrary client strings into an NDJSON
  stream is a log-injection vector.
- **Credential redaction** for `authorization`, `cookie`, `x-api-key`,
  `set-cookie`, `password`, `token` at any depth — asserted against real emitted
  output, not assumed.
- **Health probes logged at `trace`** so a per-second liveness check doesn't
  produce 86,400 meaningless lines a day.

### Lifecycle

```mermaid
graph LR
    A[SIGTERM] --> B["1 · /readyz → 503"]
    B --> C["LB drains this instance"]
    C --> D["2 · server.close()"]
    D --> E["In-flight requests finish"]
    E --> F["3 · exit 0"]
    D -.->|"timeout 10s"| G["Force exit 1"]

    classDef step fill:#238636,stroke:#1a612b,color:#fff
    classDef danger fill:#da3633,stroke:#a02622,color:#fff
    class B,D,F step
    class G danger
```

**The ordering is the point.** Readiness fails _before_ the server stops
accepting connections, so the load balancer stops routing while the process can
still serve what's queued. Closing first would reject requests the balancer
hasn't learned to stop sending — this is what makes a rolling deploy lossless.

Also handled: `keepAliveTimeout` (65s) set above the typical LB idle timeout to
avoid sporadic 502s; repeated signals ignored during drain; `uncaughtException`
and `unhandledRejection` log at `fatal` and drain with a non-zero exit.

### Security

| Control          | Implementation                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Security headers | `helmet` defaults; `x-powered-by` disabled                                                              |
| Input validation | Zod at the edge, `.strict()` — unknown fields rejected                                                  |
| Body size limit  | Configurable (16 kb default) → `413`                                                                    |
| Rate limiting    | Fixed window, API surface only — **probes never throttled**                                             |
| Proxy trust      | Exact hop count, not `true` — blanket trust lets a client spoof `X-Forwarded-For` and evade the limiter |
| CSPRNG           | `crypto.randomInt` — no modulo bias, not `Math.random()`                                                |
| Error opacity    | 5xx never leaks a message or stack                                                                      |
| Container        | Non-root, read-only FS, `cap_drop: ALL`, `no-new-privileges`                                            |

Rate limiting deliberately excludes `/healthz` and `/readyz`: a throttled probe
makes the orchestrator restart a service that is merely busy, converting a load
spike into an outage.

---

## Testing strategy

```
209 tests across 13 suites — no jest.mock(), no test doubles for our own code
```

| Layer            | What it proves                                                        |
| ---------------- | --------------------------------------------------------------------- |
| **Domain**       | All 36 rolls enumerated; symmetry; invariants; immutability           |
| **Service**      | Orchestration with fakes; concurrency; round limits                   |
| **Adapters**     | Snapshot isolation; version conflicts; RNG uniformity; mutex fairness |
| **Middleware**   | Every error mapping; 500 opacity; validation coercion                 |
| **Integration**  | Full stack via supertest — no ports, no network                       |
| **Architecture** | Layering rules enforced by parsing the import graph                   |

The suite contains **no `jest.mock()` calls**. Because randomness, time, and
identity are injected ports, tests supply real fakes and assert exact values —
there is not a single `expect.any(Number)` standing in for a score.

Two things worth calling out:

**The architecture tests are verified to fail.** A guard that never fires is
worthless, so the layering test was confirmed to fail when an `express` import is
injected into the core, and pass when removed.

**The 500 path is unit tested directly.** By construction no valid request
triggers an internal error, so the opacity guarantee — no message, no stack, no
credentials from a connection string — is asserted against the handler itself.

---

## Deployment

### Container

Three-stage build producing a runtime image with no compiler, no test framework,
and no source:

```mermaid
graph LR
    A["deps<br/>npm ci --omit=dev"] --> C["runtime<br/>node:22-alpine"]
    B["build<br/>tsc → dist/"] --> C
    C --> D["Non-root · tini · healthcheck<br/>OCI labels"]

    classDef s fill:#1f6feb,stroke:#0d419d,color:#fff
    class A,B,C,D s
```

Details that matter:

- **`npm ci`, not `install`** — installs the lockfile exactly, fails if it and
  `package.json` disagree. A build must never resolve a tree different from the
  one that was tested.
- **`tini` as PID 1** — Node doesn't implement default signal dispositions as
  PID 1, so without an init the container can ignore SIGTERM and be SIGKILLed
  after the grace period, defeating the graceful shutdown entirely.
- **`--max-old-space-size` set** — V8 otherwise sizes its heap from _host_ RAM,
  ignores the cgroup limit, and gets OOM-killed with no diagnostic of its own.
- **Dependency layers cached independently** of source, so a code change doesn't
  reinstall `node_modules`.
- **OCI labels** — given only a running container, an operator can recover the
  exact commit it was built from.

### Pipelines

**`ci.yml`** — format, lint, typecheck, test with coverage thresholds, build,
`npm audit` (blocking on high severity in _production_ deps only; a vulnerability
in a test runner is not one in the shipped artifact), then build the image and
**smoke-test the running container**: play a full game through the public API,
assert the 4th roll returns 409, and verify SIGTERM produces a clean drain. A
Dockerfile that merely compiles is not evidence of a working deployment.

**`deploy.yml`** — re-verify, build, push to GHCR with provenance + SBOM, sign
with cosign, deploy to **Fly.io**, then play a real game against production and
fail the job if it doesn't finish correctly.

Four choices worth noting:

- **Deploy by immutable digest, never by tag.** `:latest` can move between the
  decision to deploy and the rollout; a digest cannot. This makes rollback exact.
- **`cancel-in-progress: false`** on deploy. Aborting a half-finished deploy
  leaves the environment in an unknown state. That setting is right for CI and
  actively dangerous here.
- **Nothing is rebuilt on the deploy host.** `flyctl deploy --image <digest>`
  ships the exact artifact CI verified, bit for bit.
- **The post-deploy check plays a game**, not just a readiness poll. A `/readyz`
  200 proves the process booted; it does not prove the app works. The check
  creates a game, plays it to completion, and asserts the next roll returns 409.

Platform settings that carry real weight — `kill_timeout` above the app's drain
budget, auto-stop disabled because state is in-memory, `TRUST_PROXY_HOPS=1` so
rate limiting keys on the client rather than Fly's proxy — are documented with
their failure modes in [`fly.toml`](fly.toml) and the
**[deployment runbook](docs/deployment.md)**, which also covers first-time setup,
rollback, and troubleshooting.

Rollback is a workflow re-dispatch with `image_tag` set to a previous SHA.

---

## Architecture Decision Records

| ADR                                                                      | Decision                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| [0001](docs/adr/0001-in-memory-persistence-behind-repository-pattern.md) | In-memory persistence behind the Repository Pattern        |
| [0002](docs/adr/0002-no-caching-layer.md)                                | **No caching layer — why Redis was intentionally omitted** |
| [0003](docs/adr/0003-manual-dependency-injection.md)                     | Manual DI via a composition root                           |
| [0004](docs/adr/0004-concurrency-control.md)                             | Keyed mutex + optimistic versioning                        |
| [0005](docs/adr/0005-error-handling-strategy.md)                         | Transport-agnostic errors, centralised HTTP mapping        |
| [0006](docs/adr/0006-observability-and-lifecycle.md)                     | Structured logging, correlation ids, graceful shutdown     |

---

## What I deliberately did not build

Judgement is the deliverable, so the omissions are as considered as the
inclusions. Each has a trigger for revisiting.

**Redis.** The read path is a `Map.get()` — roughly a microsecond. A Redis round
trip is ~200µs. The cache would be **two orders of magnitude slower than the
thing it caches**, plus a second source of truth, invalidation on every roll, and
a new failure mode. Redis becomes correct at >1 replica — but then it is the
_shared store_, not a cache. Conflating those is the actual architectural error.
Full reasoning: [ADR-0002](docs/adr/0002-no-caching-layer.md).

**PostgreSQL.** Nothing requires durability yet, and the port means adopting it
later costs one line plus one class. [ADR-0001](docs/adr/0001-in-memory-persistence-behind-repository-pattern.md).

**A DI framework.** Eight objects wired in one readable function. A container
earns its keep at hundreds of providers, not eight. [ADR-0003](docs/adr/0003-manual-dependency-injection.md).

**Authentication.** Not in scope, and a hand-rolled JWT layer nobody asked for is
worse than none. The middleware seam is where it would go.

**A `/metrics` endpoint.** Without a Prometheus scraper to consume it, it's code
nobody reads. The obvious next addition once a monitoring stack exists.

**Event sourcing / CQRS.** One aggregate, no audit requirement, no read/write
asymmetry. It would be complexity as decoration.

---

## Configuration

All variables are validated by Zod at boot; the process **refuses to start** on
invalid config rather than failing later on a request path. A crash-looping
container is a signal an operator can act on; a 500 at 3am is not.

| Variable               | Default            | Notes                                      |
| ---------------------- | ------------------ | ------------------------------------------ |
| `NODE_ENV`             | `development`      | `development` · `test` · `production`      |
| `PORT` / `HOST`        | `3000` / `0.0.0.0` |                                            |
| `LOG_LEVEL`            | `info`             | `trace`…`fatal`, `silent`                  |
| `LOG_PRETTY`           | `false`            | Dev only — must stay `false` in production |
| `CORS_ORIGIN`          | `*`                | Comma-separated allowlist                  |
| `BODY_LIMIT`           | `16kb`             |                                            |
| `TRUST_PROXY_HOPS`     | `0`                | Must be > 0 behind a load balancer         |
| `RATE_LIMIT_WINDOW_MS` | `60000`            |                                            |
| `RATE_LIMIT_MAX`       | `120`              | Per window, per IP                         |
| `SHUTDOWN_TIMEOUT_MS`  | `10000`            | Drain grace period                         |
| `GAME_DEFAULT_ROUNDS`  | `5`                |                                            |
| `GAME_MAX_ROUNDS`      | `20`               |                                            |

## Scripts

| Command             | Purpose                     |
| ------------------- | --------------------------- |
| `npm run dev`       | Watch mode with pretty logs |
| `npm run build`     | Compile to `dist/`          |
| `npm start`         | Run the compiled build      |
| `npm test`          | Full suite                  |
| `npm run test:cov`  | Coverage with thresholds    |
| `npm run lint`      | ESLint (type-aware)         |
| `npm run typecheck` | `tsc --noEmit`              |
| `npm run format`    | Prettier                    |

---

## License

MIT
