# ADR-0004: Concurrency control — keyed mutex plus optimistic versioning

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Playing a round is a read–modify–write sequence:

```ts
const game = await repository.findById(id); // ← await: yield point
const next = playRound(game, dice, now); //   pure computation
await repository.update(next); // ← await: yield point
```

**Node being single-threaded does not make this atomic.** Every `await` is a
yield point where the event loop can run another request. Two concurrent rolls
against the same game interleave like this:

```
Request A: findById  → version 0, 0 rounds
Request B: findById  → version 0, 0 rounds     ← both read the same snapshot
Request A: update    → version 1, 1 round
Request B: update    → version 1, 1 round      ← A's round is silently gone
```

Both requests return `201 Created`. The client believes two rounds were played.
The game contains one. This is a **lost update**, and it is silent — the worst
property a data bug can have.

The belief that "Node is single-threaded so I don't need locking" is a common
and expensive misconception. It is true only for synchronous sequences.

## Decision

Two independent mechanisms, deliberately layered.

### 1. A keyed mutex (primary — prevents the conflict)

`KeyedLock` is a port; `AsyncMutex` is the in-process adapter. `GameService.rollDice`
wraps the entire critical section:

```ts
return this.lock.withLock(gameId, async () => {
  /* read → apply → write */
});
```

Serialisation is **per game id**, so rolls on different games never block each
other. The implementation chains a promise per key and removes the entry once it
drains, so the map does not grow over the process lifetime.

### 2. Optimistic versioning (backstop — detects any escape)

Every `Game` carries a `version`. `InMemoryGameRepository.update()` refuses a
write whose version does not match what is stored, raising
`ConcurrencyConflictError` → **HTTP 409**.

### Why both

The mutex alone is sufficient _today_, on one replica. But it is an in-process
lock, so it silently stops working the moment there are two replicas — and it
would fail by resuming exactly the silent data loss described above.

The version guard converts that failure from **silent corruption** into a
**loud, correct 409**. It is the difference between a system that is wrong and a
system that knows it is wrong.

The version column also carries over unchanged to a real database, where it
becomes a genuine optimistic lock (`UPDATE ... WHERE version = $1`).

## Alternatives considered

- **Optimistic locking alone.** Correct, but exposes routine 409s to clients
  under normal concurrent use and pushes retry logic into every caller.
- **A single global mutex.** Correct, but serialises unrelated games — an
  unnecessary throughput ceiling for no correctness gain.
- **Nothing.** The lost-update bug above. Rejected.

## Consequences

**Positive**

- Concurrent rolls on one game are serialised; none are lost. Covered by tests
  at both the service layer and through the HTTP API.
- Different games proceed in parallel.
- Correct behaviour is preserved — as a loud error — if the lock is ever
  bypassed.
- The version field ports directly to SQL optimistic locking.

**Negative**

- Rolls on a single game are serialised, capping per-game throughput. This is
  inherent to the requirement (rounds are ordered) and not a real constraint.
- `AsyncMutex` is process-local. At more than one replica it must be replaced
  with a distributed lock behind the same `KeyedLock` port — at which point the
  version guard is doing the real work.

## Verification

- `tests/unit/async-mutex.test.ts` — serialisation, key independence, release on
  rejection, no map growth, arrival ordering.
- `tests/unit/game.service.test.ts` — three concurrent rolls yield rounds 1, 2, 3
  with none lost; concurrent rolls stop exactly at the round limit.
- `tests/unit/in-memory-game.repository.test.ts` — a stale write is rejected.
- `tests/integration/game.api.test.ts` — five concurrent HTTP rolls all succeed
  and the game ends with exactly five rounds.
