# Final validation report

Commit `c53ad0b`, 2026-07-29. Node v22.22.2, pnpm 9.15.4, Docker 29.3.1, Linux
x86_64.

Produced by four reviewers working in fresh context, none of whom wrote the code
they audited: one executing the command suite and driving the running
application, one checking each assignment requirement against the code and the
test named as its evidence, one enumerating security findings, one on
architecture and documentation. Everything below was run. Nothing is reported as
passing on the strength of having been written.

---

## 1. Verdict and evidence

### PARTIAL PASS

**Every mandatory assignment requirement passes, with evidence.** Fifteen
requirements, fifteen PASS (§2). Ten required commands, ten pass (§3). The
eleven-step manual smoke test passes end to end against a live API and a real
browser (§4), including a double six observed with real cryptographic dice rather
than scripted ones. No Critical or High security findings (§5).

**The verdict is PARTIAL rather than PASS because the project is not
deliverable, and one failure is unexplained:**

- **The API container image has never been built successfully.** Not once, in
  this environment or any other. The Dockerfile is committed, referenced by CI
  and by the deploy workflow, and is entirely unverified. _(The cause given here
  originally — the sandbox's TLS proxy — turned out to be hiding a real defect.
  See the addendum to §6; the conclusion is unchanged.)_
- **Nothing is deployed.** No Fly app, no Vercel project, no Atlas cluster, no
  live URL. The deploy workflow, its rollback path, and the Fly health gate have
  never executed.
- **One integration failure was observed once and never explained.** A run of
  `games.integration.spec.ts` returned `lastDice: [6,6]` together with
  `effect: 'NORMAL_ROLL'` — a combination a single `applyRoll` transition cannot
  produce, since both fields are written from the same `evaluateRoll` outcome. It
  has not recurred in 28 subsequent runs and no mechanism has been found. An
  unexplained failure is not a passed test.

A verdict of PASS would require asserting that a never-built image and an
unexercised deployment path work. They may well. Nobody knows.

**Two defects were found by this audit and fixed, both recorded here rather than
quietly closed:**

- A **concurrency defect that contradicted the project's central claim** of
  server authority. `applyTransition` computed the next state from the game it
  had loaded but guarded the write with the revision the _client_ sent, never
  checking they matched. Reproduced deterministically: a participant's banked
  score was erased, the round score carried two rolls' worth of points from
  before the hold, the turn was taken back, and the request returned `200`. Fixed
  in `0a4a439`. Every concurrency test in the project had both writers name the
  _same_ revision — the case the compare-and-set already handles — so the entire
  set agreed with itself and none could fail for this reason.
- **Both documented setup commands were broken.** `SEED_DEMO_USERS=true pnpm
db:seed` and `pnpm test:e2e`, the commands the README gives a contributor, both
  failed: turbo 2 defaults to `envMode: strict` and deleted the variables. Each
  failed in a way that pointed elsewhere — a seed flag reported as unset when it
  was set, Chromium reported as missing when its path had been stripped. CI
  hid both, because CI runs the package script directly and never goes through
  turbo. Fixed in `c53ad0b`.

Both were found by executing things, not by reading them. That is consistent with
this project's history: of the defects found across ten reviews, the ones that
mattered were found by running the code, mutating it, or watching a guard fail —
never by inspection alone.

---

## 2. Compliance matrix

Each row was verified by opening the implementation, then opening the test file
and finding the named test. The README contains a table making these same claims;
it was deliberately not used as a source.

| Requirement                                            | Status | Implementation                                                                                  | Test evidence                                                                                                                                                                                                                                       | Limitations                                                                                                                                                                                |
| ------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| React frontend                                         | PASS   | `apps/web/src/app/page.tsx`, components under `apps/web/src/components/`; Next.js 15 App Router | 71 tests across 7 files                                                                                                                                                                                                                             | —                                                                                                                                                                                          |
| Backend API contains all game logic                    | PASS   | `apps/api/src/domain/game.ts`, `apps/api/src/domain/rules/standard-v1.ts`                       | 376 unit + 64 integration                                                                                                                                                                                                                           | —                                                                                                                                                                                          |
| Authentication                                         | PASS   | `auth.service.ts` (Argon2id), `guards/jwt-auth.guard.ts` (JWT + `tokenVersion`)                 | `returns a byte-identical failure for an unknown email and a wrong password`; `revokes every token issued before the logout, not only the one presented`                                                                                            | —                                                                                                                                                                                          |
| Two authenticated users on one page                    | PASS   | `hooks/seat-sessions.tsx`; one panel per seat, cache keyed by `(gameId, seat, userId)`          | `fetches the board once per seat, each with that seat's own token` — asserts the two `Authorization` headers are distinct                                                                                                                           | —                                                                                                                                                                                          |
| No live sync between browsers required                 | PASS   | `hooks/use-game.ts` — no polling; both seats invalidated after any command                      | `banks the round with Hold, and refreshes both seats afterwards`                                                                                                                                                                                    | Permissive requirement                                                                                                                                                                     |
| Two dice on every Roll                                 | PASS   | `crypto-dice.generator.ts` `rollPair()`; `dicePairSchema = z.tuple([...])`                      | `never produces a face the contract would reject` — 3000 samples parsed through the 2-tuple schema                                                                                                                                                  | —                                                                                                                                                                                          |
| Normal roll adds **both** dice                         | PASS   | `standard-v1.ts` `points: dice[0] + dice[1]`; `game.ts` adds to `roundScore`                    | `treats a single six as an ordinary six, in either position`; `adds the sum of both dice under standard@1`                                                                                                                                          | `every other pair produces ADD_TO_ROUND with the sum of both dice` asserts only the classification, by design — its own comment says so. The arithmetic is carried by literal-valued tests |
| 6 and 6 clears the round and passes the turn           | PASS   | `standard-v1.ts` `BUST_FACE`; `game.ts` `roundScore: 0, activePlayer: otherSeat(...)`           | Rule: `6 and 6 produces LOSE_ROUND_AND_PASS`. Engine: `clears the round score and switches player`, via a stand-in ruleset that never names a die face                                                                                              | Verified by mutation — see §3                                                                                                                                                              |
| Hold banks, resets, passes                             | PASS   | `game.ts` `applyHold`                                                                           | `banks the round score and passes the turn`; `banks the sum of both dice across a turn, a single six included`                                                                                                                                      | Holding on zero is legal — a documented decision                                                                                                                                           |
| First to reach **or exceed** wins                      | PASS   | `standard-v1.ts` `globalScore >= winningScore`; decided only in `applyHold`                     | `wins on exactly the winning score`, `does not win one under it`, `wins on overshooting it`, and `asks the ruleset whether a total wins, rather than comparing itself` — adversarial in both directions                                             | Checked **on Hold only**: an unbanked round above the target does not win. An interpretation of "global score", documented in the ruleset and the README                                   |
| Default winning score 100                              | PASS   | `standard-v1.ts` and `contracts/primitives.ts`                                                  | `publishes the default and the playable bounds`; `rules-contract-agreement.test.ts` fails the build if domain and contract drift                                                                                                                    | —                                                                                                                                                                                          |
| Winning score configurable                             | PASS   | `createGame`; `create-game-panel.tsx`                                                           | `accepts a custom winning score`, `accepts the exact bounds`, `refuses a winning score outside the ruleset bounds`                                                                                                                                  | The UI sets the score only at creation, not on New Game. (`MIN_WINNING_SCORE` was **2** when this was written, lowered for a test's convenience; it is 10 again — see the addendum.)       |
| Either player may start a new game at any time         | PASS   | `game.ts` `startNewGame` — membership only, no turn check, no game-over check                   | `is legal during an active game, and discards the match in progress`; `may be started by either player`; `clears points still on the table`                                                                                                         | —                                                                                                                                                                                          |
| Only authenticated participants may create, view, play | PASS   | Global `APP_GUARD`; `seatOf` checked on read as well as write                                   | `app.routes.test.ts` asserts the public set **equals** `PUBLIC_ROUTES` — at controller level and again against the raw Express router, where Swagger mounts                                                                                         | Any user may create a game naming any opponent without consent — a design property, not a breach                                                                                           |
| No game logic in the frontend                          | PASS   | Absence, verified by search                                                                     | `when the server's answer and whose turn it is disagree` — a finished game where it is still nominally your turn and the server still says no; `names the winner the server sent, not the player with the higher score` (winner holds 42, loser 91) | Three near-misses, all named below                                                                                                                                                         |

**Requirement 15, searched rather than assumed.** In `apps/web/src`: no `Math.`
anywhere, no arithmetic on scores, no comparison against `winningScore`, no
comparison against a die face, no local winner detection. Three near-misses worth
a reader knowing about:

1. `use-double-six-pause.ts` holds Roll and Hold for 1600 ms after a double six.
   Three reviewers independently flagged this as the app's one client-side gate
   and a possible breach of "no game logic in the frontend". **It is neither: it
   is optional extra #4, which asks in as many words for actions to be disabled
   briefly on 6 & 6.** It is also purely subtractive — it can never enable an
   action the server forbade, and the server has already applied the transition
   by the time the timer starts. Recorded because the reviewers were right to
   stop on it, and the answer is in the brief rather than in a defence.
2. `viewerSeat === activePlayer` appears in `seat-controls.tsx` and
   `game-board.tsx`. Both operands are server fields and the comparison chooses a
   sentence or a CSS class; it gates nothing. The `disagree` fixtures exist
   precisely to prove these were not substituted for `availableActions`.
3. `create-game-panel.tsx` validates the winning score in the browser, using the
   bounds imported from the contract and re-checked by the server. A duplicate
   check, not an independent authority.

Two features were **dropped rather than computed** to keep the row honest: a
progress bar toward the target (division on scores) and naming who threw the
double six (not derivable from a view that arrives with the turn already passed).

---

## 3. Commands executed

Every command below was run at `c53ad0b` and its real result recorded. Turbo
caches aggressively, so `lint`, `typecheck` and `test` are reported from forced,
uncached runs — a cache hit is not evidence that a check ran.

| Command                                 | Result      | Duration | Detail                                                                                                                                                                                                                                                 |
| --------------------------------------- | ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`                     | PASS        | 5 s      | "All matched files use Prettier code style!"                                                                                                                                                                                                           |
| `pnpm exec turbo run lint --force`      | PASS        | 20 s     | 4 tasks, 0 cached, no warnings                                                                                                                                                                                                                         |
| `pnpm exec turbo run typecheck --force` | PASS        | 12 s     | 4 tasks, 0 cached                                                                                                                                                                                                                                      |
| `pnpm exec turbo run test --force`      | PASS        | 18 s     | **462 passed, 0 failed, 0 skipped** — api 376, web 71, contracts 15                                                                                                                                                                                    |
| `pnpm test:integration`                 | PASS        | 15 s     | **64 passed** across 5 files, against a real `mongo:7.0`                                                                                                                                                                                               |
| `pnpm test:e2e`                         | PASS        | 80 s     | **5 passed** — real Chromium, production build of both apps                                                                                                                                                                                            |
| `pnpm build`                            | PASS        | 40 s     | 3 tasks                                                                                                                                                                                                                                                |
| `docker compose config`                 | PASS        | <1 s     | Renders one service, `mongo:7.0`, published to `127.0.0.1:27017`                                                                                                                                                                                       |
| `docker compose build`                  | **no-op**   | <1 s     | `No services to build`. `compose.yaml` declares only `mongo`, with `image:` and no `build:`. `apps/api/Dockerfile` is not referenced by compose, so this command cannot build it. Exit 0 means nothing was attempted — recorded as a no-op, not a pass |
| `docker compose up -d`                  | PASS        | <1 s     | `dice-game-mongo` up and healthy                                                                                                                                                                                                                       |
| `docker build -f apps/api/Dockerfile .` | **BLOCKED** | —        | `apk add python3 make g++` → `certificate verify failed`. The sandbox's HTTPS proxy CA is not in the build container. Environmental, but the consequence is real: the image is unverified                                                              |

**Note on `pnpm test --force`.** It does not do what it appears to. `test` is a
pnpm builtin, so `--force` never reaches turbo; `pnpm run test -- --force` passes
it to vitest, which rejects it. Only `pnpm exec turbo run test --force` produces
an uncached run. Recorded because anyone told to "re-run with `--force`" will
otherwise get a false failure.

**Mutation check, run rather than quoted.** Flipping `BUST_FACE` from 6 to 5 in
`domain/rules/standard-v1.ts`:

```
Test Files  1 failed | 21 passed (22)
     Tests  5 failed | 371 passed (376)
```

All five failures in `rules/standard-v1.test.ts`; the 74 engine tests untouched.
This is the project's headline claim about rule isolation, and it holds. It was
also confirmed independently and by accident: one reviewer flipped the constant
while another's suite happened to be running, and that run captured exactly the
same five failures.

**Known flakiness.** The integration suite failed twice in twenty executions on
the pre-audit tree. One cause was found and fixed: `lets exactly one of two
simultaneous holds through` asserted `[200, 409]`, but `Promise.all` starts two
requests without making them simultaneous, and a hold passes the turn — so a
loser that loads after the winner commits is refused `NOT_YOUR_TURN` before the
revision is ever consulted. It now asserts one applied and one refused, keeping
the state assertions, which were always the point. Stable across 8 further runs.
The second failure is the unexplained one in §1 and §6.

---

## 4. Manual smoke test

Driven against a live stack — MongoDB in Docker, API on `:3001`, web on `:3000`,
`NODE_ENV=development`, so **real cryptographic dice throughout**, not the
scripted generator.

| #   | Step                                            | Observed                                                                                                                                                                                                                                                                                                                                                                                                       | Verdict                       |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | Player 1 authenticates                          | `POST /api/auth/login` → `200`, JWT, `expiresIn: 900`, `Ada Lovelace`                                                                                                                                                                                                                                                                                                                                          | PASS                          |
| 2   | Player 2 authenticates                          | `200`, distinct token and user id, `Grace Hopper`                                                                                                                                                                                                                                                                                                                                                              | PASS                          |
| 3   | Game created                                    | `201`, `gameNumber: 1`, `winningScore: 100` (default), `activePlayer: 0`, `revision: 0`, `ruleset: standard@1`                                                                                                                                                                                                                                                                                                 | PASS                          |
| 4   | Normal roll adds **both** dice                  | `[1,5]` → `roundScore 6`; then `[5,4]` → `roundScore 15`, a delta of exactly 9. Turn unchanged                                                                                                                                                                                                                                                                                                                 | PASS                          |
| 5   | Hold banks and passes                           | `effect: HELD`, `roundScore 15 → 0`, `globalScores [0,0] → [15,0]`, `activePlayer 0 → 1`                                                                                                                                                                                                                                                                                                                       | PASS                          |
| 6   | Double six clears the round and switches player | **Played until it happened with real dice** — arrived on roll 54, after 22 s. `lastDice: [6,6]`, `effect: DOUBLE_SIX`, `roundScore 384 → 0`, `activePlayer 1 → 0`, global scores untouched                                                                                                                                                                                                                     | PASS — observed, not inferred |
| 7   | A player wins                                   | Target 20. `[6,3]`→9, `[2,3]`→14, `[5,1]`→20, then Hold → `effect: GAME_WON`, `status: COMPLETED`, `winner: 0`, `winCounts: [1,0]`. Exactly 20 against a target of 20 — the "reach" branch, not "exceed"                                                                                                                                                                                                       | PASS                          |
| 8   | Completed-game actions rejected                 | Four requests (roll and hold, both seats) → all `409 GAME_OVER`. Refetch: still `COMPLETED`, revision unmoved                                                                                                                                                                                                                                                                                                  | PASS                          |
| 9   | New game starts                                 | Started **by the loser**, seat 1 → `effect: NEW_GAME`, `gameNumber: 2`, `status: ACTIVE`, board cleared                                                                                                                                                                                                                                                                                                        | PASS                          |
| 10  | Win count survives                              | `winCounts: [1,0]` preserved into game 2 while `globalScores` reset to `[0,0]`                                                                                                                                                                                                                                                                                                                                 | PASS                          |
| 11  | Refresh restores persisted state                | Four ways: refetch as each seat; `mongosh` against the container showing an identical stored document; **a second API process on `:3002` against the same database serving the identical view**, proving the state is in MongoDB and not in process memory; and a real Chromium reload — after `page.reload()` the heading, round score, both die faces, both signed-in seats and both button states came back | PASS                          |

Step 6 deserves its note. A double six cannot be forced with the production
generator, so rather than substitute the deterministic one and call it observed,
the reviewer rolled until it happened.

---

## 5. Security findings

Reviewed independently: authorization, authentication, input validation,
multi-tenancy, concurrency, rate limiting, secrets in history as well as in the
tree, deploy configuration, the deterministic dice generator, and dependencies.

### Critical — none

### High — none

### Medium

**M1. Client-chosen revision could overwrite a move it never saw. — FIXED
(`0a4a439`).** `applyTransition` derived the next state from the loaded game but
guarded the write with the client's `expectedRevision`, without checking they
matched. A participant could aim a write one revision into the future and land it
the moment somebody else created that revision. Demonstrated: a banked score
erased, points restored from before a hold, the turn taken back, `200` returned.
Now refused with `GAME_REVISION_CONFLICT`, and the check sits _after_ the
transition so a stranger probing a guessed id still learns only
`NOT_A_PARTICIPANT`. That placement is held by a test in which both refusals are
available and disagree.

**M2. The origin holding the tokens sets no security headers.** Helmet is applied
to the API, which serves only JSON. The Next.js app — which serves the HTML and
whose `sessionStorage` holds both seats' bearer tokens — ships Next's defaults:
no CSP, no `frame-ancestors`, no `Referrer-Policy`, no `X-Content-Type-Options`.
Partially mitigated: there is no XSS sink anywhere (no `dangerouslySetInnerHTML`,
no `eval`, no `innerHTML`; display names are restricted by schema), so token
theft needs a vulnerability that does not currently exist. Clickjacking of the
board is possible today. Open — see §6.

**M3. `NODE_ENV` is a single switch behind both the scripted dice and every
production refusal.** The generator selection itself is careful: it reads
validated config rather than `process.env`, defaults to the CSPRNG so an
unrecognised environment fails closed, and the deterministic class is
deliberately not `@Injectable()`. The coupling is the problem — one mis-set
`NODE_ENV=test` in a real deploy yields scripted dice _and_ the committed
development `JWT_SECRET`, which is token forgery for any user id. Mitigated in
depth (the Dockerfile and `fly.toml` both pin `production`) but not in code.
Open.

### Low

`EMAIL_TAKEN` on registration is an enumeration oracle (login is not — verified);
credential rate limiting is per-IP with no account lockout; throttler counters
are per-process and multiply if more than one machine runs; a high-severity
advisory is suppressed by id, justified and reachable only through `eslint`;
`workflow_dispatch` input is interpolated into a `run:` block in the job holding
the Fly token; the deploy workflow runs a narrower check suite than CI; docs are
mounted whenever `NODE_ENV !== 'production'`; `TRUST_PROXY_HOPS` is bounded but
cannot be validated against the real topology; unbounded game creation; a
game-existence oracle behind 96-bit ids.

### Verified and found to hold

Default-deny asserted by **equality** against `PUBLIC_ROUTES`, at controller
level and again against the raw Express router where Swagger mounts. Login leaks
nothing by body or by timing — the unknown-email path performs a real throwaway
verification against an eagerly-computed dummy hash. Argon2id at RFC 9106's
memory-constrained profile. Revocation compares `tokenVersion` against a fresh
read on every request. No schema anywhere accepts an actor id, a die, a score or
a turn; every write command is `.strict()`. Reads are membership-checked, not
just writes. Mongo filters are built from typed fields with `sanitizeFilter` set
where Mongoose actually reads it. Rate-limit keying cannot be forged, because
`trust proxy` is an exact hop count and never `true`. **No secret has ever been
committed** — 47 commits and every blob scanned for keys, tokens, PEM material
and credentialed connection strings. The container runs as non-root, asserted in
CI against the built image.

**No unresolved Critical or High finding.**

---

## 6. Remaining gaps

| #   | Gap                                                                         | Severity                               | Effect on compliance                                                                                          | Files                                                     | Fix                                                                                                                                      | Effort                                                                     |
| --- | --------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | The API image has never been built end to end                               | High to delivery, none to requirements | No §3 requirement affected. Blocks deployment, and every claim the Dockerfile makes is untested               | `apps/api/Dockerfile`                                     | Build on a network without a TLS-intercepting proxy, or inject the proxy CA into the build stage                                         | Minutes, once off this sandbox                                             |
| 2   | Nothing is deployed; no live URL                                            | High to delivery, none to requirements | The deploy workflow, its rollback path and the Fly health gate are entirely unexercised                       | `infrastructure/fly/`, `.github/workflows/deploy-api.yml` | Needs Fly, Vercel and Atlas credentials                                                                                                  | ~1 hour with credentials                                                   |
| 3   | One integration failure, observed once, unexplained                         | Medium                                 | `lastDice: [6,6]` with `effect: NORMAL_ROLL` is a state `applyRoll` cannot produce. Not reproduced in 28 runs | `apps/api/src/games/games.integration.spec.ts`            | Instrument the roll path to log the `evaluateRoll` outcome alongside the persisted document, and run the spec under load until it recurs | Half a day, open-ended                                                     |
| 4   | No CSP on the web origin; other headers now set (M2)                        | Medium                                 | None — no XSS sink exists today                                                                               | `apps/web/next.config.ts`                                 | Add `headers()` with CSP, `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`; `poweredByHeader: false`                       | 1–2 hours, most of it verifying a nonce-based CSP does not break hydration |
| 5   | `NODE_ENV` gates both the scripted dice and every production refusal (M3)   | Medium                                 | None while deployment pins `production`                                                                       | `dice-generator.provider.ts`, `config/env.schema.ts`      | A separate opt-in flag for the scripted generator, plus a boot assertion that it is unbound outside tests                                | 2–3 hours                                                                  |
| 6   | Credential rate limiting is per-IP only                                     | Low                                    | None                                                                                                          | `config/rate-limit.config.ts`                             | Per-account counter with backoff; shared store if more than one instance runs                                                            | Half a day                                                                 |
| 7   | ~~`MIN_WINNING_SCORE` is 2 because e2e needed it~~ — **CLOSED**, back to 10 | Closed                                 | None — the bound is visible to both players                                                                   | `contracts/primitives.ts`, `standard-v1.ts`               | Raise to 10 and let e2e script a two-hold win instead                                                                                    | 1 hour                                                                     |
| 8   | ~~`docker compose build` builds nothing~~ — still true of `compose.yaml`    | Low                                    | None                                                                                                          | `compose.yaml`                                            | Either add a `build:` for the API or stop listing the command as a check                                                                 | 15 minutes                                                                 |
| 9   | ~~Ten `wip(...)` commits~~ — **CLOSED**, squashed to 41 commits             | Closed                                 | None                                                                                                          | Git history                                               | Squash into the feature commits they belong to before submission                                                                         | 30 minutes, needs a force-push                                             |

### Addendum — what changed after this report was first written

The report above was produced at `c53ad0b`. Work since then closed or moved
four of its gaps, and turned one of them into a defect worth naming.

- **Gap 9 is closed.** The ten `wip(...)` commits were squashed; history is 41
  commits with none of them announcing a broken tree. The tree was verified
  byte-identical before and after the rewrite.
- **Gap 1 changed cause, and the real one was a defect.** "The image has never
  been built" was attributed to this environment's TLS-intercepting proxy.
  Injecting the proxy CA moved the failure past that and exposed
  **`Cannot find matching keyid`** from corepack — which is not environmental
  and would have failed on any machine. corepack verifies package-manager
  downloads against npm signing keys compiled into it; npm rotated that key and
  the old one expired 2025-01-29, so every Node image published before the
  rotation ships a corepack that cannot verify the current pnpm tarball. Both
  Dockerfiles now install pnpm with npm at the version `packageManager` pins.
  The API build clears that step and now stops only at `apk add`, which this
  sandbox's egress policy blocks. Still unverified end to end — but for one
  environmental reason instead of an unexamined one.
- **A web image now exists and has been run.** `apps/web/Dockerfile` was
  written, built, started, and serves the page with its stylesheet — the last
  check being the one that matters, since `output: 'standalone'` omits
  `.next/static` and an image that forgets to copy it starts cleanly and serves
  an unstyled page. This is the first container image the project has produced.
- **Gap 2 is unblocked but not closed.** `compose.prod.yaml` and a Caddyfile run
  the whole application on one host with automatic HTTPS. The compose file
  validates and its required-variable guards were confirmed to refuse a missing
  secret. Nothing has been deployed from here — this environment has no SSH
  client and port 22 is blocked — so "deployable in one command" remains a claim
  about a command nobody has yet run to completion.
- **Gaps 5 and 7 are closed.** `DICE_SOURCE` now decides where the dice come
  from, and nothing else: `NODE_ENV=test` no longer implies scriptable dice,
  production refuses `DICE_SOURCE=scripted` at boot, and the provider names the
  scripted case so anything unrecognised falls through to `node:crypto`. The
  binding test can finally state the thing it was named for — a container with
  `NODE_ENV=test` and no dice setting resolves the CSPRNG — which the old
  condition could not express, since asking for the test environment _was_
  asking for scripted dice. Deleting the flag from the Playwright config makes
  the browser suite fail on real dice and name the missing variable.
  `MIN_WINNING_SCORE` is back to 10; it was 2 for a test's convenience, and no
  test ever asked for a target below 10.
- **Gap 4 is narrower.** The Caddyfile sets HSTS, `X-Content-Type-Options`,
  `Referrer-Policy` and `X-Frame-Options` on the origin that serves the HTML.
  CSP is still absent, and deliberately: Next's App Router injects inline
  bootstrap scripts, so a real policy needs a per-request nonce threaded through
  the framework rather than a static header, and `unsafe-inline` would be
  theatre.
- **A secret-leak path was closed on the way past.** `.gitignore` covered `.env`
  and `.env.local` but not `.env.production`, which the new deployment path
  tells you to create and fill with a database password and a JWT signing key.
  It is now `.env*` with explicit exceptions for the two committed templates,
  verified by creating the file and watching git ignore it.

None of this changes the verdict. The image is still unbuilt end to end and
nothing is deployed, which is what PARTIAL PASS was recording.

### What this project is genuinely good at, and where that came from

The recurring lesson, recorded because it produced every real finding here: **a
correct assertion over a fixture in which it cannot fail** is the most expensive
bug in this repository, and it has now appeared five times. The client that could
have derived `canRoll` locally and passed all 44 tests. The winner fixture that
gave the named winner the higher score. The deletable round-score reset.
Immutability tests that only ever saw frozen states. And, found by this audit,
every concurrency test naming the same revision on both sides — the one case the
compare-and-set already handled.

Each was invisible to review and obvious to mutation. The question that finds
them is not "does it pass?" but "what would I have to break for it to fail?"
