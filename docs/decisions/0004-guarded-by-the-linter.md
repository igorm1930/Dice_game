# 4. Architectural boundaries are enforced by the linter

Status: accepted (Phase 1)

## Context

The domain layer must not depend on NestJS, Mongoose, HTTP, the clock, the
environment, or a random source. Stating that in a README makes it an
aspiration. The usual next step is a custom test that reads source files and
checks their imports.

The previous implementation had exactly such a test. It compared each import
against `FORBIDDEN_IN_CORE`, a hardcoded list of seven names. The list did not
contain `mongoose`, `@nestjs/common`, or `zod` — so the test would have passed
while the domain imported an ORM. It also asserted nothing about `Math.random`,
despite the architecture resting on injected randomness.

A guard that cannot fail is worse than no guard, because it reads as coverage.

## Decision

`no-restricted-imports` with **patterns**, not names, applied to
`**/src/domain/**/*.ts`, plus `no-restricted-properties` for `Math.random`,
`Date.now` and `process.env`, and `no-restricted-syntax` for `new Date()`.
Patterns catch subpath imports (`@dice-game/contracts/routes`) that an
exact-match list misses.

A CI job proves the rule fires. It writes a file importing `mongoose`,
`@nestjs/common` and `node:crypto` alongside `Math.random` and `Date.now`, and
fails the build if ESLint accepts it.

## Consequences

The boundary fails closed and is checked on every push rather than in a test
someone must remember to run. Adding a forbidden import is a lint error at the
point of writing it, not a review comment.

The denylist is still a denylist: it names the framework families that matter
and blocks `node:*`, but bare Node builtins beyond the five enumerated ones are
not covered. A stricter inversion — allow-list everything — was rejected as
disproportionate for one directory in one package.

Nothing is excluded from linting. The previous configuration ignored the entire
frontend, so a headline of "0 lint errors" covered zero frontend files. For the
same reason `jsx-a11y` runs at `strict`: that UI shipped with focus styling on
three text inputs and none on any button.

## Revisit when

The domain moves into its own package, at which point its `package.json` can
carry the constraint directly and the pattern list becomes a backstop.
