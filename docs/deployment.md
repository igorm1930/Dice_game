# Deployment runbook

Target: **Fly.io**, one machine, image built and signed by CI and deployed by
immutable digest.

Chosen because it runs the actual container image (nothing is rebuilt on the
host), honours `SIGTERM` with a configurable grace period, and supports separate
readiness and liveness checks — so the graceful-drain behaviour described in
[ADR-0006](adr/0006-observability-and-lifecycle.md) is exercised in production
rather than merely asserted.

---

## One-time setup

### 1. Create the Fly app

```bash
fly auth login
fly apps create dice-game-service      # name must match `app` in fly.toml
```

Do **not** run `fly launch` — it would overwrite the committed `fly.toml`, which
carries deliberate settings (see [Why these settings](#why-these-settings)).

### 2. Make the GHCR package pullable

Images published to GHCR are **private by default, even from a public repo**.
Fly cannot pull a private image without credentials, and the deploy will fail
with a manifest-unknown or unauthorized error.

After the first successful `build-and-push` run:

> GitHub → your profile → **Packages** → `dice_game` → **Package settings** →
> **Change visibility** → **Public**

Alternatively keep it private and attach a registry-scoped token to the Fly app;
public is simpler and this image contains no secrets.

### 3. Create the deploy token

```bash
fly tokens create deploy -a dice-game-service
```

### 4. Configure the GitHub Environment

> Repo → **Settings** → **Environments** → **New environment** → `production`

| Kind     | Name             | Value                               |
| -------- | ---------------- | ----------------------------------- |
| Secret   | `FLY_API_TOKEN`  | the token from step 3               |
| Variable | `PRODUCTION_URL` | `https://dice-game-service.fly.dev` |

`PRODUCTION_URL` drives both the post-deploy smoke test and the deployment URL
GitHub shows against the commit. If it is unset the smoke test is skipped —
the deploy still succeeds, but **nothing will have verified it**.

Optionally enable **Required reviewers** on the environment to gate production
behind a manual approval.

### 5. Create `main`

`deploy.yml` triggers on pushes to `main`. Until that branch exists, nothing
deploys. Merge the feature branch via a pull request (which also gives CI its
first run), or promote it directly.

---

## Deploying

Automatic on every push to `main`. The pipeline:

```
verify → build & push (GHCR, provenance + SBOM, cosign) → deploy → smoke test
```

Manual, without a new commit:

> **Actions** → **Deploy** → **Run workflow**

Leave `image_tag` blank to build from `HEAD`.

---

## Rolling back

Re-run the workflow with `image_tag` set to a previously good commit SHA:

> **Actions** → **Deploy** → **Run workflow** → `image_tag` = `<previous-sha>`

This skips the build and verify jobs and redeploys that exact image. Because
deploys are addressed by digest rather than by a moving tag, the rolled-back
artifact is bit-identical to what ran before.

Faster still, straight from the platform:

```bash
fly releases -a dice-game-service       # list
fly releases rollback -a dice-game-service
```

---

## Why these settings

Non-obvious choices in `fly.toml`, and what breaks without them.

| Setting                                 | Reason                                                                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kill_signal = 'SIGTERM'`               | Fly defaults to `SIGINT`; `SIGTERM` is the conventional drain signal and what the container contract assumes.                                                                       |
| `kill_timeout = '15s'`                  | Must exceed the app's `SHUTDOWN_TIMEOUT_MS` (10s). Fly's 5s default would `SIGKILL` mid-drain and drop in-flight requests.                                                          |
| `auto_stop_machines = 'off'`            | State is in-memory ([ADR-0001](adr/0001-in-memory-persistence-behind-repository-pattern.md)). Stopping an idle machine silently discards every in-progress game.                    |
| `min_machines_running = 1`              | Same reason — there must always be exactly one live instance.                                                                                                                       |
| `TRUST_PROXY_HOPS = '1'`                | Fly terminates TLS and forwards one hop. Without this the rate limiter keys every request to the proxy's address instead of the client's, so one abusive client throttles everyone. |
| `LOG_PRETTY = 'false'`                  | Fly's log pipeline consumes NDJSON. Pretty output is unparseable to it.                                                                                                             |
| `/readyz` as the HTTP check             | Fly stops routing to a machine whose check fails, which is what makes the SIGTERM drain lossless.                                                                                   |
| `/healthz` as a separate liveness check | Must not depend on anything downstream — a wedged process should be replaced, a busy one should not.                                                                                |

### Known limitation: single replica

`fly scale count 1` is a hard constraint while the repository is in-memory. Two
machines would hold disjoint game sets, and a client's second request could land
on the one that has never heard of their game.

A consequence worth stating plainly: with one machine, a rolling deploy has a
brief gap, and **in-progress games do not survive a deploy or a restart**. That
is the accepted, recorded cost of [ADR-0001](adr/0001-in-memory-persistence-behind-repository-pattern.md),
not an oversight. Implementing `PostgresGameRepository` against the existing port
lifts both restrictions — one line changes in `src/container.ts`.

---

## Verifying a deploy by hand

```bash
BASE=https://dice-game-service.fly.dev

curl -s $BASE/healthz | jq
curl -s $BASE/readyz  | jq

ID=$(curl -s -X POST $BASE/api/v1/games \
  -H 'Content-Type: application/json' \
  -d '{"playerName":"Manual Check","rounds":3}' | jq -r '.data.id')

for _ in 1 2 3; do
  curl -s -X POST $BASE/api/v1/games/$ID/rolls | jq -c '.data.round'
done

curl -s -o /dev/null -w 'expect 409: %{http_code}\n' \
  -X POST $BASE/api/v1/games/$ID/rolls

curl -s $BASE/api/v1/leaderboard | jq
```

The Pig game — the one the frontend plays — needs two registered players:

```bash
ALICE=$(curl -s -X POST $BASE/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"checkalice","password":"deploy check password"}' | jq -r '.data.token')
BOB=$(curl -s -X POST $BASE/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"checkbob","password":"deploy check password"}' | jq -r '.data.token')

curl -s -X POST $BASE/api/v1/pig-game/new-game -H "Authorization: Bearer $ALICE" \
  -H 'Content-Type: application/json' -d '{"opponent":"checkbob","targetScore":20}' | jq '.data.players'

curl -s -X POST $BASE/api/v1/pig-game/roll -H "Authorization: Bearer $ALICE" | jq -c '.data.lastRoll'

# Bob rolling on Alice's turn must be refused by the server, not by the UI.
curl -s -X POST $BASE/api/v1/pig-game/roll -H "Authorization: Bearer $BOB" | jq -r '.error.code'
# expect: NOT_YOUR_TURN
```

Registration is in-memory, so these accounts vanish on the next deploy — which
is itself a useful check: if `checkalice` still exists, the machine did not
restart.

Confirm the image running in production is the one you think it is:

```bash
fly image show -a dice-game-service          # digest
cosign verify ghcr.io/igorm1930/dice_game@<digest> \
  --certificate-identity-regexp '^https://github.com/igorm1930/Dice_game/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

---

## Troubleshooting

| Symptom                                                                                 | Cause                                                                                                                           | Fix                                                                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `unauthorized` / `manifest unknown` during deploy                                       | GHCR package is private                                                                                                         | Step 2 above                                                                                                      |
| `FLY_API_TOKEN is not set`                                                              | Secret missing on the `production` environment                                                                                  | Step 4                                                                                                            |
| Deploy succeeds, smoke test skipped                                                     | `PRODUCTION_URL` variable unset                                                                                                 | Step 4                                                                                                            |
| Machine restarts in a loop                                                              | Config rejected at boot — the app fails fast on invalid env by design                                                           | `fly logs`; the first line names the offending variable                                                           |
| Health check failing but the app looks fine                                             | Check hitting the wrong port                                                                                                    | `internal_port` must equal `PORT` (3000)                                                                          |
| Rate limiting throttles everyone at once                                                | `TRUST_PROXY_HOPS` not set to 1                                                                                                 | Already in `fly.toml`; confirm it was not overridden by `fly secrets`                                             |
| Games vanish between requests                                                           | More than one machine running                                                                                                   | `fly scale count 1` — see the single-replica note above                                                           |
| Smoke test fails once with `GAME_NOT_FOUND` mid-flow right after a deploy               | The flow straddled the outgoing and incoming machines during the brief cutover overlap — each holds disjoint in-memory state    | Expected; the smoke test retries the whole flow (3 attempts, 20s apart). Three straight failures is a real defect |
| `GAME_NOT_FOUND` persists across all smoke retries; UI state flickers between two games | **Two machines are running.** flyctl's first deploy creates an HA pair by default; `min_machines_running` is a floor, not a cap | `fly scale count 1 -a dice-game-service` — deploy.yml now enforces this on every rollout                          |

Logs:

```bash
fly logs -a dice-game-service            # live
fly status -a dice-game-service          # machine + check state
```

Every log line carries a `requestId`. To trace one request end to end, filter on
the `x-request-id` value returned in the response headers or in `meta.requestId`.
