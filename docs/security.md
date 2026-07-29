# Security

What is implemented, why it is shaped that way, and what is knowingly left open.

## Authorization is default-deny

A global `APP_GUARD` protects every route. Four opt out with `@Public()`:
register, login, and the two health probes. `PUBLIC_ROUTES` in the contract is
the allow-list, and a test asserts the mounted public set **equals** it.

The equality matters. An earlier version of that test used containment, and a
mutation review showed that adding `@Public()` to `GET /api/users` turned it
into an unauthenticated user-enumeration endpoint with the entire suite green.

The test also runs at two levels. Controller metadata is not the whole story:
Swagger mounts on the raw Express adapter, so its routes are not Nest routes —
no guard, no throttler, no envelope — and are invisible to `DiscoveryService`.
Seven such paths were found answering 200 without a token. Interactive docs are
now mounted outside production only, and the second assertion walks the real
Express router stack.

## Authentication

**Argon2id** with parameters from validated configuration.

**Short-lived JWTs, one per seat**, held in `sessionStorage`. httpOnly cookies
cannot work here: the assignment requires two identities on one page, and a
cookie session cannot represent both at one origin. The XSS exposure is accepted
and bounded by the token lifetime. Dual-token authentication exists only to
satisfy that requirement and is not a pattern to copy.

**Revocation is real.** Every user carries a `tokenVersion`, present as a JWT
claim and compared against the stored value on _every_ request. Logout
increments it, so every token previously issued to that user stops verifying
immediately. This costs one indexed read per request; a stateless JWT would make
logout cosmetic. Since Phase 4 it survives a restart — while the store was
in-memory, a process bounce silently re-validated every outstanding token.

**The Authorization header is parsed strictly in shape and loosely in case.** A
bare token, a wrong scheme, an empty token, a tab separator and two tokens are
all 401 before any I/O. The scheme is matched case-insensitively per RFC 7235
§2.1 — rejecting `bearer eyJ…` would 401 a conforming client, which is an
interoperability bug rather than a defence.

**Login is not a user-enumeration oracle.** An unknown email and a wrong
password return byte-identical bodies, and the unknown-email path performs a
throwaway verification against a dummy digest so both cost comparable CPU. That
digest is computed **eagerly by an async provider at boot**, not lazily
memoised: a lazy one makes the first unknown-email login measurably slower than
the rest, which is exactly the signal the defence exists to remove.

**Registration hashes before checking uniqueness**, deliberately, so a duplicate
address does not answer in microseconds while a fresh one takes tens of
milliseconds. The duplicate is caught by a unique index and Mongo's E11000, not
by a find-then-create — which would be both a timing oracle and a race two
simultaneous registrations win.

Because the uniqueness guarantee rests on that index, `autoIndex` is off and
`createIndexes()` is explicitly awaited at boot. Mongoose's automatic build is
fire-and-forget, and an index that has not finished building is not a
constraint.

## Input handling

Every request body, parameter and query is validated against the contract's own
Zod schemas, all `.strict()`. No endpoint anywhere accepts an actor id, a die
value, a score or a turn — identity comes only from the verified token.

Validation errors return the field path and a machine-readable code, and
deliberately **not** Zod's message: for `unrecognized_keys` and
`invalid_enum_value` that message embeds the submitted input, so a request that
put a secret in the wrong field would have it echoed back.

**NoSQL injection.** Queries are built from explicitly typed fields; nothing
spreads a request object into a filter. `sanitizeFilter` is enabled on a private
Mongoose instance rather than through `openUri` — passing it as a connect-time
option is _silently inert_, because Mongoose files those on `connection.config`
while `Query` reads `model.db.options`. This was found because the injection
test returned a real user, and the test fails if the fix is removed.

## Transport and edge

- **Helmet**, with CSP. `unsafe-inline` for script and style is granted only when
  the docs are mounted — production serves no HTML and does not pay for it.
- **CORS** restricted to configured origins, methods `GET`/`POST`. The API
  refuses to boot in production with `CORS_ORIGIN=*`.
- **Body limit** from configuration; oversized bodies get a 413 in the standard
  envelope.
- **`trust proxy` is an exact hop count, never `true`.** Too high and a client
  forges `X-Forwarded-For` to mint a fresh rate-limit key per request.
  Production must state it explicitly — the default of 0 fails _closed_, keying
  every request on the load balancer and collapsing all traffic onto one bucket,
  which is a self-inflicted outage nothing else would catch.
- **Two rate-limit tiers.** Gameplay gets a normal budget; register and login get
  a far smaller one, because a budget sized for dice is a budget sized for
  thousands of password guesses an hour. Health probes are exempt from both — a
  throttled probe reads as unhealthy and gets the process restarted.

## Error handling

Domain errors carry a stable code and never an HTTP status; the code-to-status
mapping lives in exactly one table, in the contract, so both sides of the wire
agree. An unknown error becomes an opaque 500, and an arbitrary thrown object
carrying `status` or `statusCode` **cannot** downgrade it — status is derived
from recognised types only. No response carries a stack trace, a password hash,
a token or a connection string.

## Configuration

Parsed and validated once at boot; the process refuses to start on invalid
config rather than failing at the first request. Production additionally
refuses: the development `JWT_SECRET` committed to `.env.example`, a secret
under 32 characters, `CORS_ORIGIN=*`, and an unstated `TRUST_PROXY_HOPS`. All
failures are reported together, so fixing one does not reveal the next on the
following restart.

Secrets are never committed. `.env.example` contains only ports, bounds and
durations.

## Container

Runs as `node`, not root — asserted in CI against the built image, because a
build that produced a root-running image would still be a build that passed.
The runtime stage carries no compiler: the argon2 native build happens in the
build stage and only the compiled artefact is copied forward.

## Demo data

`pnpm db:seed` refuses unless `SEED_DEMO_USERS=true`, and refuses outright under
`NODE_ENV=production` before opening a connection. The flag ships `false`:
seeding is something you ask for, not something that happens because you ran a
setup command.

## Known gaps

Stated rather than quietly carried:

- **Credential rate limiting is per-IP only.** Twenty guesses per fifteen minutes
  per source address; a distributed or NAT-diverse attacker is unbounded. A
  second counter keyed on the submitted email would close it.
- **`NODE_ENV=test` does two things at once** — it binds the deterministic dice
  generator _and_ disables the production config refusals. One mis-set variable
  in a real deploy therefore yields both scriptable dice and the committed dev
  secret. Two independent switches would require two mistakes.
- **No refresh tokens.** An expired access token means signing in again.
- **One suppressed advisory**, by GHSA id with a written reason, in the root
  `package.json`. See AGENTS.md. Advisories with a patched release are pinned
  forward with an override instead — suppression is a permanent record for a
  temporary problem.
