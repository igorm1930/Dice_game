# 2. Optimistic concurrency with a client-supplied revision

Status: accepted (Phase 1, implemented Phase 3–4)

## Context

Two players act on one shared game from a single page, with no live
synchronisation between browsers. Two things can therefore collide: a
double-clicked Roll, and one seat acting on a board rendered before the other
seat's move landed.

A per-game in-process lock would serialise writes, but only within one process —
it stops being true the moment a second instance exists, and it does not help a
client that is looking at stale state.

## Decision

Every state-changing request carries `expectedRevision`. The write is a
conditional update matched on `{ _id, revision }`, incrementing atomically. No
matching document means the client's view was stale: the API answers
`GAME_REVISION_CONFLICT` (409) and **does not replay the action**. The client
refetches and the player decides again.

The repository owns the revision. Domain transitions leave it untouched — a
domain that incremented it would race with the check that depends on it.

## Consequences

A double-clicked Roll produces one roll and one conflict, not two rolls. Two
seats on one page are safe without WebSockets, polling for correctness, or a
distributed lock. The design is already correct for more than one instance,
which is a property the previous implementation lacked: it locked on a
module-level constant and had shipped to production as an HA pair by accident.

The cost is real and lands on the frontend: every mutation threads a revision
through, and `GAME_REVISION_CONFLICT` is a normal outcome to handle rather than
an error to display. The contract marks it in `REFETCH_ON` for that reason.

Not replaying is deliberate. Replaying a stale Roll would silently spend a turn
the player did not knowingly take.

## Revisit when

A single game acquires more than two writers, or an action becomes expensive
enough that discarding one is worse than reconciling it.
