# ADR-0003: Manual dependency injection via a composition root

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

The design depends on dependency inversion: services accept ports, and concrete
adapters are chosen in one place. The question is _how_ that wiring happens.

Options considered:

1. **A DI framework** (InversifyJS, tsyringe, NestJS's container) — decorators,
   `reflect-metadata`, a runtime resolution graph.
2. **Manual constructor injection** through a single composition root.
3. **Module-level singletons** — `import { repository } from './repository'`.

Option 3 was rejected outright: it is not injection at all. It hard-codes the
implementation at every import site, makes tests order-dependent through shared
module state, and is precisely the coupling the ports exist to prevent.

## Decision

**Manual constructor injection, wired in `src/container.ts`.**

Every collaborator arrives through a constructor. `createContainer()` is the
only function in the codebase that names a concrete adapter, and an automated
test enforces that (`tests/architecture/layer-boundaries.test.ts` — "confines
adapter instantiation to the composition root").

Dependencies are passed as a single object rather than positionally:

```ts
new GameService({ repository, random, clock, idGenerator, lock, config });
```

At six collaborators this is materially more readable than six positional
arguments, and adding one is not a breaking change to every call site.

## Rationale

A DI framework earns its keep at scale — hundreds of providers, deep graphs,
request-scoped lifetimes, module boundaries a team needs enforced. This service
has **eight** objects wired in one readable function.

At this size a framework costs:

- a runtime dependency and `reflect-metadata` polyfill,
- `experimentalDecorators` / `emitDecoratorMetadata` in `tsconfig`,
- indirection: "where does this come from?" becomes a container lookup rather
  than a line you can read,
- a resolution failure mode that surfaces at runtime rather than compile time.

It buys automatic resolution of a graph that is currently eight lines long.

The trade-off inverts as a system grows, and that is fine — the ports do not
change when the wiring mechanism does. Swapping in a container later is a change
to one file.

## Consequences

**Positive**

- Wiring is readable top to bottom with no framework knowledge required.
- Zero runtime dependencies for DI; the compiler catches a missing dependency.
- Tests construct services directly with fakes — no container bootstrap, no
  module mocking, no `jest.mock()` anywhere in the suite.
- `createContainer()` accepts overrides, so integration tests get a fully wired
  app with substituted config in one call.

**Negative**

- Wiring is written by hand. At ~50 services this becomes tedious — the point at
  which the trade-off flips and this ADR should be revisited.
- No automatic lifecycle management (singleton vs transient scoping). Not needed
  here: every dependency is a stateless singleton except the repository and the
  lock, which are intentionally per-container.
