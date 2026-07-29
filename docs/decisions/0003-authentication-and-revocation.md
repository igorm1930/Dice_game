# 3. JWT with a token version, and default-deny authorization

Status: accepted (Phase 3)

## Context

The assignment requires two authenticated users driving one page, each acting
under their own identity. That shapes two decisions that would otherwise be
routine.

**Where the token lives.** httpOnly cookies are the usual answer and cannot work
here: two distinct identities share one browser origin, so a cookie session
cannot represent both seats at once.

**What logout means.** A stateless JWT is valid until it expires. Logout that
only deletes the client's copy is cosmetic — the token still verifies.

## Decision

Short-lived access tokens, one per seat, held in `sessionStorage`. The
XSS trade-off is accepted and documented; the mitigation is the short lifetime.

Every user carries a `tokenVersion`. It is a JWT claim, and the guard compares it
against the stored value on **every** request. Logout increments it, so every
token previously issued to that user stops verifying immediately. Revocation is
real, costs one indexed field, and survives multiple instances without a shared
cache or a denylist collection.

Authorization is **default-deny**: a global `APP_GUARD` protects everything and
routes opt out with `@Public()`. `PUBLIC_ROUTES` in the contract is the
allow-list — register, login, and the two health probes.

Passwords use Argon2id with parameters from configuration. Login is not a user
enumeration oracle: an unknown email and a wrong password return an identical
body, and the unknown-email path performs a throwaway verification against a
dummy hash precomputed eagerly at startup, so both paths cost comparable CPU.

## Consequences

Every authenticated request reads the user to compare `tokenVersion`, so the
guard is not stateless. That is the price of real revocation, and it is one
indexed lookup.

Default-deny inverts the failure mode. A controller whose decorator was
forgotten returns 401 instead of serving. The previous implementation opted in
per router and shipped five unauthenticated gameplay endpoints — while its
README asserted that authentication was mounted on the router rather than left
to handlers, and its OpenAPI description claimed every game endpoint required a
token.

Precomputing the dummy hash eagerly rather than lazily matters: a lazily
memoised one makes the first unknown-email login measurably slower than the
rest, which is itself the signal the defence exists to remove.

Dual-token authentication exists **only** to satisfy the same-page requirement.
It is not a pattern to copy into a normal application.

## Revisit when

Refresh tokens are needed, or the user record moves somewhere that makes a
per-request read expensive.
