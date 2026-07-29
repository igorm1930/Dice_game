# AI usage

This repository was built with AI assistance. This page says how, plainly.

## What that meant in practice

Work ran in phases — contract, domain, API, persistence, client — with a
separate agent per phase and **independent reviewers who did not write the code
they reviewed**. Every review found something; the interesting ones are recorded
below, because they are the honest argument for why this arrangement was worth
the overhead.

A human directed the phases, resolved the decisions that were genuinely
decisions (JWT revocation strategy, members-only reads, whether to keep the
previous implementation), and integrated and verified every phase before it was
committed.

## What the reviews caught

The pattern is consistent enough to be worth naming: **a guard is worth nothing
until you have watched it fail.** Each of these looked correct in review and was
caught only by running or mutating it.

- The previous implementation's architecture test compared imports against a
  seven-name denylist containing neither `mongoose` nor `@nestjs/common`. It
  would have passed while the domain imported an ORM.
- `applyRoll` hardcoded `effect: 'DOUBLE_SIX'`, so a ruleset losing on 5 and 5
  would have animated the wrong thing. The abstraction the project's central
  claim rests on had leaked.
- Three domain tests asserting the most important behaviour could not fail.
  Deleting `startNewGame`'s round-score reset left the whole suite green.
- Adding `@Public()` to `GET /api/users` — an unauthenticated user-enumeration
  endpoint — left all 329 tests passing.
- The first fix for that walked `DiscoveryService`, which cannot see routes
  mounted on the raw Express adapter. Seven unauthenticated, unthrottled Swagger
  paths were hiding in exactly that gap.
- `sanitizeFilter` passed through `openUri` is silently inert. Found because the
  NoSQL injection test returned a real user.
- On the client, the test named _"disables Roll because the server said canRoll
  is false — not because the client decided"_ did not test that: every fixture
  made the server's answer redundant with locally derivable state.

## What this says about the code

Two things, and they point in opposite directions.

The generated code was good on its first pass more often than not — the domain
layer, the contract and the persistence adapters needed little correction. But
**the tests were systematically over-confident.** They asserted that code ran
rather than that it was right, and they built fixtures where the correct answer
and a plausible wrong answer coincide. That is a failure mode worth knowing
about: a green suite written alongside the code it tests inherits the same
assumptions.

Mutation testing is what surfaced it. Not "does this test pass?" but "what would
I have to break for it to fail?".

## Verification

Nothing in this repository is claimed to pass without having been run. Test
counts, integration results and audit outcomes in the README and commit messages
are actual output. Where something could not be verified — the container image
cannot be built end to end behind this environment's proxy, and nothing has been
deployed — it is stated as unverified rather than implied to work.

The browser suite used to be on that list and no longer is: five Playwright
scenarios run against a production build of both apps, and the README's
screenshot is written by one of them.
