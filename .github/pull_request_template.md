## What changed

<!-- One or two sentences. The diff shows how; say what. -->

## Why

<!-- The problem, or a link to the issue. -->

## How it was verified

Ticked boxes mean the command was run locally on this branch and passed.
CI runs the same set — a box left unticked is a signal to the reviewer, not a
blocker.

- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm test:integration` (needs `docker compose up -d`)
- [ ] `pnpm test:e2e`
- [ ] `pnpm build`

Anything checked by hand instead:

<!-- e.g. "played a full match in the browser; confirmed 6&6 clears the round score" -->

## Risks

<!--
What could this break, and how would it show? "None" is a valid answer.
Call it out explicitly if the change touches any of:
packages/contracts (both apps must agree), auth guards, the dice source,
or a database schema.
-->
