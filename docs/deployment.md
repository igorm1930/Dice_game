# Deployment

Two paths, and they are not equivalent.

**Self-hosted on one box is the supported one** — `compose.prod.yaml` runs
MongoDB, the API, the client and Caddy on a single host, with automatic HTTPS
and nothing but Caddy holding a public port. It is one command and needs no
managed services. Both images build: the web image has been built and run here
and serves the page, and the API image builds end to end in CI. Neither has been
run on a real host — see "What is actually verified".

**Fly + Vercel + Atlas** is configuration that was written earlier and validated
as far as it can be without accounts. Nothing has ever been deployed to it. It
is kept because the workflow and the health gating are worth reading, not
because it is a path anyone has walked.

---

## Self-hosted: the whole application on one host

Requirements: a host with Docker and Docker Compose, ports 80 and 443 open, and
a domain whose A record already resolves to it. A Hetzner CX22 is more than
enough — the API is idle between requests and MongoDB holds kilobytes.

```bash
git clone https://github.com/igorm1930/dice_game.git && cd dice_game

cp .env.production.example .env.production
# fill in DOMAIN, ACME_EMAIL, MONGO_PASSWORD, JWT_SECRET
#   openssl rand -base64 32   # MONGO_PASSWORD
#   openssl rand -base64 48   # JWT_SECRET

docker compose -f compose.prod.yaml --env-file .env.production up -d --build
```

The first `up` takes a few minutes: it builds both images and Caddy requests a
certificate. Then:

```bash
docker compose -f compose.prod.yaml --env-file .env.production ps
curl https://<your-domain>/api/health/ready
```

`ready` answering `200` means the API has a live MongoDB connection. Visit the
domain and both seats are on the page.

### Why the DNS record has to exist first

Caddy obtains the certificate over Let's Encrypt's HTTP-01 challenge, which
means Let's Encrypt connects **back** to port 80 on the address the domain
resolves to. Start before DNS has propagated and issuance fails — and failures
count against a rate limit of five per domain per week, so the cost of being
early is waiting, not retrying.

### What is exposed

Only Caddy publishes ports. The API, the client and MongoDB have no `ports:`
entry at all and are reachable only across the compose network, which is why
MongoDB runs without TLS and why the API is not a public origin. `TRUST_PROXY_HOPS`
is `1` because exactly one proxy sits in front; getting that number wrong in
either direction breaks rate limiting — see `docs/security.md`.

### Updating a running deployment

```bash
git pull
docker compose -f compose.prod.yaml --env-file .env.production up -d --build
```

Compose replaces containers whose image changed and leaves the MongoDB volume
alone. The volume is named `dice-game-prod-mongo-data`; **`docker compose down
-v` deletes it**, along with every account and match.

### Backups

There are none, and that is a gap rather than a decision. A single-host
deployment with one volume needs `mongodump` on a timer and the dump copied off
the box; nothing here does that.

---

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

- **`pnpm deploy --prod`**, not `COPY node_modules`. pnpm's tree is
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

| Item                                                     | Status                                              |
| -------------------------------------------------------- | --------------------------------------------------- |
| `fly.toml` parses; every key lands in its intended table | verified with `tomllib`                             |
| `compose.yaml` valid                                     | `docker compose config -q`, exit 0                  |
| `compose.prod.yaml` valid; required vars fail loudly     | `docker compose config`, and a missing var refuses  |
| `.env.production` cannot be committed                    | checked by creating one and watching git ignore it  |
| API runs against real MongoDB                            | 64 integration tests                                |
| **Web image builds end to end**                          | **verified** — built, run, serves the page with CSS |
| **API image builds end to end**                          | **verified in CI** — and the image runs as `node`   |
| Self-hosted stack running                                | **not run** — needs a host                          |
| Fly / Vercel / Atlas deploy                              | **blocked**: no credentials                         |
| Live URLs                                                | **none exist**                                      |
| Deploy workflow executed                                 | **never run** — no credentials                      |

The web image is built, run, and serving: `GET /` returns 200 with both seats on
the page, and the stylesheet returns 200 with content — which is the check worth
naming, because `output: 'standalone'` excludes `.next/static`, so an image that
forgets to copy it starts perfectly and serves an unstyled page.

**The API image builds.** It took three separate causes to get there, and only
the first was environmental — the other two would have failed on any machine:

1. `apk add python3 make g++` → _Permission denied_. The egress policy here does
   not allow Alpine's package repositories. Environmental, and it will not
   happen on an ordinary host.
2. Past that, `corepack enable && pnpm install` → **`Cannot find matching keyid`**.
   This one was a genuine defect and it would have failed on any machine on
   earth. corepack verifies a package-manager download against npm signing keys
   compiled into it; npm rotated that key and the old one expired on
   2025-01-29, so the corepack shipped in every Node image published before the
   rotation cannot verify the current pnpm tarball. The registry lists both
   keys — the expired `jl3bw…` corepack trusts, and the current `DhQ8wR5…` the
   tarball is signed with. Both Dockerfiles now install pnpm with npm at the
   version `packageManager` pins, and the build clears that step.
3. Past _that_, argon2 falls back to node-gyp and stops at `findPython` —
   confirming the toolchain the Dockerfile installs is genuinely required. It is
   required on `bookworm-slim` too; that was tested, so the Alpine base is not
   the cause and switching bases would not avoid it.

4. And past _that_, on a runner with an ordinary network, the build reached its
   final instruction and died on `pnpm deploy --prod --legacy`:
   **`Unknown option: 'legacy'`**. `--legacy` belongs to pnpm 10, where `deploy`
   was reworked to require `inject-workspace-packages`; this workspace pins
   9.15.4. The comment beside it claimed the flag was _required_ for the v9
   lockfile — exactly backwards. That was the last one.

With the flag gone the image builds end to end in CI, and the job asserts it runs
as `node` rather than root, because a build that produced a root-running image
would still be a build that passed. What remains unverified is the image
_running_: CI builds and inspects it, but nothing has yet started the container
against a database.

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
