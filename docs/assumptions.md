# Assumptions

Every place the written brief left room, what was chosen, and why. Where a
choice could reasonably have gone the other way, that is said plainly.

## Game rules

**Holding on a zero round score is legal.** It banks zero and passes the turn.

The brief says only that Hold "adds the round score to the global score and
passes the turn" — it asks for no restriction. Forbidding it would change the
game rather than validate it: a player would lose the ability to voluntarily
pass, and the only exit from a turn would become rolling until 6 and 6 comes up.
Banking zero and handing over the dice is a legitimate move.

**A win is checked on Hold only.** Points on the table are not banked, so a
streak that reaches the winning score wins nothing until it is held. This
follows from the rules as written and is what makes the push-your-luck decision
meaningful.

**The winner keeps the seat marked active.** On a winning hold the turn does not
pass, so the finished board reads as the winner's. This is unobservable as a
rule: the game is `COMPLETED` in the same snapshot and every action is refused
from either seat afterwards.

**A single six is an ordinary six.** Only the pair loses the round.

**The winning score is frozen for the duration of a game.** It is chosen at
creation and can only change when a new game starts. Allowing a mid-game change
would let a losing player move the finish line.

**Winning-score range is 2–1000, default 100.** The default is specified. The
minimum is 2 rather than a rounder 10 so an end-to-end test can win a match in a
single hold with deterministic dice, instead of scripting a dozen rounds for no
additional coverage.

**New Game is legal at any time, including mid-game**, by either participant. It
preserves both players and both win counts, and resets the scores. The brief
requires this explicitly.

**Win counts persist across games and live on the game aggregate.** They are the
series score for that pair of players, so they belong to the match series rather
than to the user. Storing them on the aggregate also makes incrementing a win
part of the same atomic write that completes the game — the previous
implementation incremented a counter on the user in a second write, where a
crash in between lost the win.

## Identity and access

**Games are addressed by id and are members-only.** Reading a game requires
being one of its two players. The previous implementation let any authenticated
user read any match and had a test asserting that as intended; it also held one
global match, so a third player starting a game destroyed one in progress.

**Two tokens on one page is a concession to the brief, not a pattern.** The
assignment requires two authenticated users simulated on the same page. That
rules out httpOnly cookies, since two identities cannot share one cookie
session on one origin. Tokens are short-lived and held per seat in
`sessionStorage`; the XSS exposure is accepted and mitigated by the lifetime.

**An opponent is chosen by user id**, from `GET /api/users`. That endpoint is
authenticated, paginated, and returns only `{ id, displayName }` — never an
email.

**Demo accounts are seeded only behind an explicit flag** and never against a
production database.

## Scope

**No live synchronisation between browsers.** The brief says it is not required.
Two seats share one page and one query cache, so an action by either updates
both panels; a second browser sees the same server state on its next fetch.

**Persistence is MongoDB, in-memory until Phase 4.** Repository ports were
defined first so the swap changes adapters only.

**No AI opponent, no sound.** Both are on the brief's optional list, so this is
a decision rather than an oversight — four of the six optional extras are
implemented, and the table in the README says which. Optional additions do not
compensate for mandatory requirements, and the mandatory ones were finished
first.

The AI opponent is the interesting refusal, because the choice is
architectural rather than a matter of effort. A bot can be either:

- **A player** — a second identity with an account, a token, and requests it
  makes for itself. Honest, and it needs nothing new in the game layer: the
  server cannot tell it from a human, which is the point. But it puts a machine
  identity into an auth model built entirely for humans (registration, password
  hashing, revocation by `tokenVersion`) and needs something outside the request
  cycle to drive it.
- **A policy** — a `TurnStrategy` in the domain, pure, alongside `GameRules`:
  `decide(state, rules): 'ROLL' | 'HOLD'`. It would fit the existing seams
  exactly, be trivial to test (no framework, no clock, no randomness), and cost
  a `RulesetRef`-style reference persisted on the game. But something must
  _apply_ it after a human's turn ends, and that something is a scheduler, not
  an endpoint — the first thing in this codebase that acts without a request.

Neither is hard. Both are a day to do properly, and a shallow version would sit
precisely where the design carries the most weight. A `TurnStrategy` port is the
one to build if it is ever wanted.

## Known limitations

- `RollOutcome` expresses two consequences. A ruleset that subtracted from a
  global score would need a new variant and an engine branch — see
  [decision 1](decisions/0001-versioned-rules-policy.md).
- Seat count and dice count are fixed at two. Neither is exposed on the rules
  policy, so varying them is aggregate surgery rather than a rules change.
- The domain-purity lint rule blocks the framework families that matter and
  `node:*`, but not every bare Node builtin — see
  [decision 4](decisions/0004-guarded-by-the-linter.md).
