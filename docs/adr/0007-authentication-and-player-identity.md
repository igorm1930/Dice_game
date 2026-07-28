# ADR-0007: Opaque server-side sessions for player identity

- **Status:** Accepted
- **Date:** 2026-07-28
- **Deciders:** Backend engineering

## Context

The brief requires an API with authentication, and states that the API — not the
client — is responsible for _managing the identities of the players_ and for
_validating turns and actions_. Only authenticated users may create or play
games.

Those two requirements are really one requirement. A turn check is only
meaningful if the server knows _who_ is asking, and it can only know that from a
credential it issued itself. If the acting player arrived as a field in the
request body, "validate turns" would reduce to "believe the client", and the
whole rule engine would be advisory.

So the question is not whether to authenticate, but what the credential should
be. Two candidates:

**A signed token (JWT).** The reflexive choice. Its actual advantage is precise:
any instance can verify a token without shared state, because the signature
carries the claim.

**An opaque token backed by a server-side session.** A random string looked up in
a store. Verification requires the store; revocation is a delete.

## Decision

Issue **opaque bearer tokens** — 256 bits from `crypto.randomBytes`, stored in a
`Map` alongside the user id and an expiry — behind the `AuthTokenService` port.
Hash passwords with `node:crypto`'s **scrypt** behind the `PasswordHasher` port.

Identity is resolved once, by `authenticate` middleware, and reaches handlers as
`req.user`. No route reads a user id from a body, a query string, or a header
other than `Authorization`.

## Rationale

### Why not a JWT

A JWT's advantage is stateless verification across instances. This service runs
as a **single replica by deliberate decision** (ADR-0001) and keeps its user
records in memory. There is no second instance to verify a token independently
of the store, because there is no second instance and the store is the same
process.

So a JWT would buy nothing, and would cost:

- a signing key to generate, inject, rotate, and keep out of logs;
- the loss of revocation — a logged-out JWT stays valid until it expires, which
  has to be papered over with… a server-side denylist, i.e. the thing a session
  already is;
- a dependency, or worse, hand-rolled HMAC and base64url parsing.

Opaque tokens are strictly simpler here and strictly stronger on revocation.
When a shared store arrives, the port's contract — token in, user id out — is
already the right shape; only the adapter changes. That is the same argument
ADR-0001 makes about the repository, applied to credentials.

An honest consequence, stated plainly: **a restart logs everyone out.** That is
not a regression introduced by this choice, because a restart already discards
every user account and every in-progress game. One durability story, one
migration, one line in `container.ts`.

### Why scrypt, not bcrypt or argon2

Both bcrypt and argon2 are native modules. Adding either means a compiler in the
build image and a class of "works on my machine, fails in the container"
failures this project explicitly avoids. scrypt is memory-hard, is in the
standard library, and runs at OWASP's recommended `N = 2^15`.

Parameters are encoded into each stored hash (`scrypt$N$r$p$salt$digest`) rather
than read from configuration at verify time, so the cost can be raised later
without invalidating existing passwords.

The hasher is a port for a second reason beyond swappability: it is
_deliberately slow_. A suite that registers dozens of players would spend its
runtime inside a KDF that is not the thing under test. Tests inject a fast
double; the real adapter keeps its real parameters and has its own tests.

### Two properties that are easy to get wrong

**Login must not be an enumeration oracle.** A wrong password and an unknown
username return the same error code, the same message, and the same details.
Message parity alone is not enough — an unknown user would return in
microseconds while a real one takes ~100 ms in the KDF, which is a perfectly
usable timing oracle. `AuthService.login` therefore performs a throwaway
verification against a constant hash when the user is missing, so both paths
cost the same. Both properties are asserted in the suite.

**Credential endpoints need their own rate limit.** The general budget is sized
for gameplay — a player rolling repeatedly is normal traffic. A limit generous
enough for dice is generous enough for thousands of password guesses an hour, so
`/auth/login` and `/auth/register` get a separate, much smaller window.

## Consequences

- Every Pig endpoint is authenticated at the router, not by a check a handler
  could forget.
- `NOT_YOUR_TURN` and `NOT_A_PARTICIPANT` are 403s decided against the
  authenticated identity — a client that bypasses the UI gains nothing.
- Sessions and users do not survive a restart or a deploy. Accepted, and the
  same acceptance as ADR-0001.
- Rotating the session store to Redis or Postgres is one adapter and one line in
  the composition root. Moving to JWTs, should multiple replicas ever appear, is
  the same one file.
