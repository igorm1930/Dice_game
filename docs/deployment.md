# Deployment

**Current status: prepared and validated, not deployed.** No Fly app, no Vercel
project, no Atlas cluster exists. Everything below is configuration that has
been written and checked as far as it can be without credentials; the gaps are
named at the foot of this page rather than glossed.

## Shape

| Piece    | Where         | Config                                                   |
| -------- | ------------- | -------------------------------------------------------- |
| API      | Fly.io        | `infrastructure/fly/api.fly.toml`, `apps/api/Dockerfile` |
| Web      | Vercel        | `apps/web`, Next.js defaults                             |
| Database | MongoDB Atlas | connection string via `MONGODB_URI`                      |

## Secrets

Never committed, never in `fly.toml`, never in an image.

```bash
fly secrets set \
  MONGODB_URI="mongodb+srv://…" \
  JWT_SECRET="$(openssl rand -base64 48)" \
  CORS_ORIGIN="https://<the-vercel-domain>"
```

On Vercel, `NEXT_PUBLIC_API_URL` is set to the Fly hostname. It is public by
construction — it is compiled into the browser bundle — so it is a URL and
nothing else.

`FLY_API_TOKEN` lives in GitHub Actions secrets for the deploy workflow.

`.env.example` contains only ports, bounds and durations. The API refuses to
start in production with the development `JWT_SECRET` it ships, with a secret
under 32 characters, with `CORS_ORIGIN=*`, or with `TRUST_PROXY_HOPS` unstated.
All failures are reported together, so fixing one does not reveal the next on
the following restart.

## The API image

Built from the repository root, because a pnpm workspace resolves
`@dice-game/contracts` through the root lockfile and a context rooted at the app
cannot install:

```bash
docker build -f apps/api/Dockerfile -t dice-game-api .
```

Two things in it are not obvious:

- **`pnpm deploy --prod --legacy`**, not `COPY node_modules`. pnpm's tree is
  symlinks into a content-addressed store, so the usual copy produces broken
  links. The alternative — `node-linker=hoisted` — would defeat pnpm's
  strictness across the whole workspace to fix one build stage.
- **The build stage installs `python3 make g++`.** argon2 is a native addon whose
  prebuilt binaries do not cover musl, so the install falls back to node-gyp and
  fails in a trace that names neither argon2 nor the missing compiler. The
  runtime stage copies the compiled artefact and carries no toolchain.

The image runs as `node`. CI asserts that against the built image, because a
build producing a root-running image would still be a build that passed.

## Fly

```bash
fly deploy --config infrastructure/fly/api.fly.toml \
           --dockerfile apps/api/Dockerfile --ha=false
```

`--ha=false` matters. **Machine count is not a `fly.toml` setting** —
`min_machines_running` does not cap it, and flyctl's first deploy creates an HA
pair by default. The previous generation of this service ran split-brain in
production for its entire life for exactly that reason, while holding game state
in process memory. This build would survive it (MongoDB is the store, and the
revision compare-and-set orders concurrent writes correctly across instances),
but one machine is what a demo needs.

**Health checks are split on purpose.** `/api/health/ready` gates traffic and
checks MongoDB; it fails _first_ during a SIGTERM drain so the proxy stops
sending work before the server stops accepting it. `/api/health/live` restarts
the machine and touches no dependency — a process killed because its database
blinked comes back into the same blinked database, turning a brief outage into a
restart loop.

**`kill_signal = "SIGTERM"` and `kill_timeout = "15s"`** override Fly's default
of SIGINT with 5 seconds, which would SIGKILL the process mid-drain. The timeout
must exceed `SHUTDOWN_TIMEOUT_MS` (10s). Both are bare top-level keys and must
appear **before the first table** — TOML assigns a bare key to whatever table
precedes it, and at the foot of the file they silently become `[[vm]]` fields
Fly ignores. That mistake was made here and caught by parsing the file.

**`TRUST_PROXY_HOPS = "1"`** because Fly terminates TLS at its proxy and
forwards one hop. Getting it wrong fails closed rather than open: every request
resolves to the proxy's address, all traffic shares one rate-limit bucket, and
the service throttles itself.

## Vercel

Root directory `apps/web`, framework preset Next.js, build `pnpm build`.
`NEXT_PUBLIC_API_URL` points at the Fly hostname. The API's `CORS_ORIGIN` must
name the Vercel domain exactly — it refuses `*` in production.

## MongoDB Atlas

A free-tier cluster is sufficient. Create a database user, allow-list Fly's
egress addresses (or `0.0.0.0/0` for a demo, with the understanding that
authentication is then the only control), and set `MONGODB_URI` as a Fly secret.

Indexes are created explicitly at boot with `autoIndex` off, so nothing depends
on a background build having finished — a unique index still building is not a
constraint, and the duplicate-email guarantee rests on it.

Do **not** run `pnpm db:seed` against production. It refuses under
`NODE_ENV=production` before opening a connection, but the flag exists so the
intent is stated rather than enforced by accident.

## What is actually verified

| Item                                                     | Status                             |
| -------------------------------------------------------- | ---------------------------------- |
| `fly.toml` parses; every key lands in its intended table | verified with `tomllib`            |
| `compose.yaml` valid                                     | `docker compose config -q`, exit 0 |
| API runs against real MongoDB                            | 64 integration tests               |
| Image builds end to end                                  | **unverified locally** — see below |
| Fly deploy                                               | **blocked**: no credentials        |
| Vercel deploy                                            | **blocked**: no credentials        |
| Atlas cluster                                            | **blocked**: none provisioned      |
| Live URLs                                                | **none exist**                     |
| Deploy workflow written                                  | YAML parses; retry policy tested   |
| Deploy workflow executed                                 | **never run** — no credentials     |

The image build cannot complete in the environment this was developed in: the
egress proxy blocks Alpine's package repository and intercepts the npm registry.
A probe build with the proxy CA injected reached the argon2 compile, which is
how the missing toolchain was found — but the build past that point is unproven
until CI runs it. That is why `.github/workflows/ci.yml` has a `docker` job: CI
is the first place the Dockerfile is exercised end to end, and it may well go red
on its first run.

## The deploy workflow

`.github/workflows/deploy-api.yml`. Triggered by a push to `main` touching the
API, or dispatched manually with an `image_digest` to roll back.

**Publishing is gated on the full check suite** — format, lint, typecheck, unit
tests, build, and integration tests against a service-container MongoDB. This is
where the previous generation failed: it gated its verify job on
`inputs.image_tag == ''` while build-and-push ran under `always()`, so a
rollback dispatch ran zero checks and still pushed HEAD, including `latest`.
Skipping verification for a rollback is defensible — that image was verified
when it was built. Publishing anyway is not. Here a rollback skips verify **and**
build; the only path that publishes is the one that verified.

**Deploys by digest, never by tag.** A tag is mutable: deploying `:main` means
deploying whatever `:main` points at by the time the machine pulls, which need
not be what this run verified.

**`--ha=false`**, for the reason in the Fly section above.

**The smoke test** waits for three consecutive `/health/ready` successes, checks
liveness, and asserts `GET /users` answers 401 anonymously — the one assertion
that would catch a deploy where the global guard stopped being registered, a
failure this project has already had once. Its retry policy retries 5xx and
connection failures only, because a 4xx during a rollout is a real answer from a
real server and retrying it turns a genuine regression into a slow green.

That retry helper had a bug, found by testing it rather than reading it:
`|| echo 000` appended a second `000` to the one curl had already written via
`-w`, producing `000000`, which matched neither arm and returned immediately.
Connection failures were therefore _not_ retried — the exact opposite of the
intent, during exactly the window it exists for. Verified against a dead port
before and after the fix, and against a local server for the 503-then-200 and
never-retry-404 cases.

## Not verified

No runner, no Fly credentials, no deployed app. `flyctl`, the GHCR push and the
Fly health gate are entirely unexercised, and the image has never been built end
to end anywhere.

`superfly/flyctl-actions/setup-flyctl@master` is a mutable branch reference that
executes with `FLY_API_TOKEN` in scope. Inherited from the previous pipeline and
carried forward knowingly; pin it to a SHA before this is used in anger.
