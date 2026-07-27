# ADR-0002: No caching layer (Redis intentionally omitted)

- **Status:** Accepted
- **Date:** 2026-07-27
- **Deciders:** Backend engineering

## Context

Redis appears in most "production-ready Node.js" reference architectures, and
its absence here is a deliberate decision rather than an oversight. This ADR
records the reasoning, because an unexplained omission is indistinguishable from
an unconsidered one.

A cache is a **response to a measured problem**. The problems it solves are:

1. reads that are expensive (a slow query, a remote call, a heavy computation),
2. state that must be shared across instances,
3. contention on a hot key,
4. rate-limit or session state that must survive a restart.

## Decision

**No caching layer.** No Redis, no Memcached, no in-process LRU.

### Why a cache would make this system slower

The read path is currently `Map.get()` on a process-local object graph — a
pointer dereference, on the order of a microsecond.

Putting Redis in front of that would mean:

```
current:  HTTP → Map.get()                          ~1µs
"cached": HTTP → serialize → TCP → Redis → TCP → deserialize   ~200µs+
```

The cache would be **two orders of magnitude slower than the thing it is
caching**. There is no configuration of Redis that makes a network round trip
beat a pointer dereference. Adding it would be cargo-culting: importing the
_shape_ of a scalable architecture while inverting its effect.

### What it would additionally cost

- **A second source of truth**, with invalidation required on every roll — and
  cache invalidation is a top-tier source of production bugs.
- **A new failure mode.** What is the behaviour when Redis is unreachable? Fail
  the request, or serve stale? Each answer needs design, code, and tests, for a
  component that is not making anything faster.
- **Infrastructure**: a container in CI, a service to monitor, memory to
  provision, a version to patch.
- **Reviewer confusion.** A reader would reasonably ask what it is for, and the
  honest answer would be "nothing".

### The distinction that actually matters

Redis becomes correct here the moment the service needs **more than one
replica** — but in that scenario it is not a _cache_, it is the _primary
datastore_, replacing the in-memory `Map` entirely (ADR-0001).

Conflating those two roles is the real architectural error this ADR exists to
avoid. "Add Redis for caching" and "add Redis as the shared store" are different
decisions with different data models, different consistency requirements, and
different failure semantics. Adding a cache today would not move the system
closer to the multi-replica design; it would add a component that has to be
removed first.

## Consequences

**Positive**

- Fewer moving parts, fewer failure modes, no invalidation logic.
- No component whose purpose cannot be explained.
- Reads remain as fast as they can physically be.

**Negative**

- The rate limiter's counters are per-process, so limits are per-replica. Fine
  at one replica; a real limitation at more (see below).
- Nothing here survives a restart — inherited from ADR-0001, not caused by this
  decision.

## When to revisit

Concrete, measurable triggers — not vibes:

| Trigger                                            | Correct response                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| More than one replica is required                  | Redis as the **shared store**, replacing the Map (ADR-0001), not as a cache |
| A read path is measured above ~50 ms at p99        | Profile first; cache only the specific expensive operation                  |
| Rate limits must hold globally across replicas     | `rate-limit-redis` as the limiter's store                                   |
| Sessions or idempotency keys must survive restarts | Redis for that specific state, scoped to it                                 |

Each of these is a **measurement or a requirement**, not a prediction. The
guiding rule: a cache is added in response to a profile, never in anticipation
of one.
