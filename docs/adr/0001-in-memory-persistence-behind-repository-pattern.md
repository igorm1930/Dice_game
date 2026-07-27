# ADR-0001: In-memory persistence behind the Repository Pattern

- **Status:** Accepted
- **Date:** 2026-07-27
- **Deciders:** Backend engineering

## Context

The service manages a single aggregate (`Game`) with a short, bounded lifecycle:
create, roll _n_ times, complete. There is no requirement for the data to
outlive the process, no reporting workload, no multi-service access, and no
stated durability guarantee.

The obvious "enterprise" move is to reach for PostgreSQL. That decision carries
real cost:

- schema migrations and a migration runner in the deploy pipeline,
- a connection pool to size, monitor, and tune,
- a database container in CI, slowing every test run and adding a flake source,
- a second thing that can be down, and a corresponding failure mode to design for,
- reviewer time spent on infrastructure rather than on design.

None of that cost buys anything the current requirements ask for.

The opposite failure is equally real: scattering `Map` access through the
service layer produces something that _cannot_ be migrated to a database
without a rewrite.

## Decision

Persist state in an in-memory `Map`, reached exclusively through the
`GameRepository` **port**.

The application core depends on the interface. `InMemoryGameRepository` is
selected in exactly one place — `src/container.ts`. No service, controller, or
domain module names it, and this is enforced by an automated test
(`tests/architecture/layer-boundaries.test.ts`).

The adapter is held to the standards a real datastore would enforce for free:

1. **Snapshot isolation.** Every value crossing the boundary is deep-cloned via
   `structuredClone`. Returning a live reference would let a caller mutate
   "persisted" state without going through `update()` — impossible against a
   real database, and a class of bug that would pass tests here but fail in
   production after migration.
2. **Optimistic concurrency.** Writes are guarded by a `version` check, so a
   lost update raises `ConcurrencyConflictError` instead of vanishing silently
   (see ADR-0004).

## Consequences

**Positive**

- Zero infrastructure to provision, run, or pay for.
- The test suite runs in about five seconds with no containers and no I/O.
- Reads are a `Map.get()` — microseconds, no serialisation, no network.
- Migration to a real datastore is a one-line change in the composition root.

**Negative — accepted deliberately**

- **State is lost on restart or crash.** For a demonstrable dice game this is
  acceptable; for anything with money attached it is not.
- **The service cannot be horizontally scaled.** Two replicas would each hold a
  disjoint set of games, and a client's second request could land on the replica
  that has never heard of their game. The service must run single-replica until
  ADR-0002's trigger is reached.
- **Memory grows without bound.** Nothing evicts completed games. At the
  assignment's scale this is irrelevant; the mitigation is noted below.

## When to revisit

Any one of these makes this decision wrong and should trigger a new ADR:

| Trigger                                  | Response                                                     |
| ---------------------------------------- | ------------------------------------------------------------ |
| Game state must survive a restart        | Implement `PostgresGameRepository` against the existing port |
| More than one replica is needed          | Same — shared state becomes mandatory (see ADR-0002)         |
| Memory growth becomes material           | Add TTL eviction to the adapter, or migrate                  |
| Historical games need querying/reporting | Migrate; a `Map` is not a query engine                       |

## Migration path

Implementing `PostgresGameRepository` requires:

1. A new class satisfying `GameRepository` (~150 lines).
2. Changing one line in `src/container.ts`.
3. Re-pointing the existing repository test suite at the new adapter — the
   contract tests are written against the port, not the implementation.

No service, controller, domain, or route file changes. That property is the
entire justification for paying the abstraction cost up front.
