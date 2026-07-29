# 5. MongoDB behind the existing ports, and the in-memory adapters stay

Status: accepted (Phase 4)

## Context

Phases 1–3 built the API against repository ports with in-memory adapters. The
ports were shaped for what came next: `updateIfRevisionMatches(gameId,
expectedRevision, next)` returning `null` on no match is a compare-and-set
contract, not a convenience.

Two questions arrived with the real database. Where does the swap happen, and
what becomes of the adapters that got us here.

## Decision

**Mongoose implementations sit beside the in-memory ones; the module binding
chooses.** No service, controller, mapper or domain file changed when the store
did — the ports were the seam and they held.

**The in-memory adapters stay.** They are not scaffolding awaiting deletion.
They are what lets the unit suite run with no database, no container and no
network, which is a property worth protecting: a suite you can only run after
standing something up is a suite people stop running. They also implement the
same compare-and-set contract Mongo honours, so they are a real model of the
behaviour rather than a lenient stand-in.

**The compare-and-set is one statement.** A single `findOneAndUpdate` filtered
on `{ _id, revision }` with `$inc: { revision: 1 }`, `new: true`, no preceding
read, no session, no transaction. A read-then-write pair would reopen the exact
race the revision exists to close, and a transaction would serialise writes the
conditional update already orders correctly.

**Indexes are built explicitly and awaited at boot**, with `autoIndex` off.
Mongoose's automatic build is fire-and-forget: it starts when a model compiles
and nobody waits. A unique index that has not finished building is not a
constraint, and the duplicate-email guarantee rests on it.

**Duplicate email is caught by that index**, mapped from Mongo's E11000 to the
existing domain error. Not by a find-then-create in the service, which would be
both a race two simultaneous registrations win and a timing oracle — duplicates
answering in microseconds while fresh addresses take the length of an Argon2
hash.

## Consequences

`tokenVersion` survives a restart, so logout is permanently real. While the
store was in-memory a process bounce silently re-validated every outstanding
token — revocation that held only until the next deploy.

Two defects surfaced here that no amount of review would have found, and both
are worth remembering as a class:

- **`sanitizeFilter` passed through `openUri` is silently inert.** Mongoose
  files connect-time options on `connection.config`, while `Query` reads
  `model.db.options` then `model.base.options`. Discovered because the NoSQL
  injection test returned a real user. It is now set on a private Mongoose
  instance, and the test fails if that goes.
- **`dbName` overrides the database named in the URI.** With `MONGODB_DB_NAME`
  defaulted, `MONGODB_URI=…/my-db` connected to the default instead and logged
  the default's name, which reads as success. An Atlas connection string
  normally names its database, so the common production case was the broken one.
  It is now an optional override passed only when set, and the connection logs
  the database read back off itself rather than the one configured.

Both were configuration that appeared applied and was not. That is the same
shape as the architecture test whose denylist omitted its own targets and the
route audit that could not see the routes it was auditing — see
[decision 4](0004-guarded-by-the-linter.md).

## What this costs

Unit tests exercise the in-memory adapters, so Mongo-specific behaviour —
E11000 mapping, the atomicity of the conditional update, index enforcement — is
only covered by the integration suite, which needs a running database. That is
the right split, but it means a green `pnpm test` says nothing about the
persistence layer. The integration job in CI is not optional decoration.

## Revisit when

A second writer needs the same document outside this service, or a workload
appears that a single conditional update cannot express atomically. Neither is
true of a two-player dice game.
