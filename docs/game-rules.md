# Game rules

The authoritative statement is the code: `apps/api/src/domain/rules/standard-v1.ts`
for what a throw does, `apps/api/src/domain/game.ts` for what the game does with
it. This page says the same thing in prose.

## A turn

Two players alternate. On your turn:

- **Roll** throws **two dice**. Both faces are added to your **round score**, and
  you keep the dice — roll again as often as you like.
- Throwing **6 and 6** wipes the round score and passes the turn. A single six is
  an ordinary six; only the pair loses the round.
- **Hold** adds your round score to your **global score** and passes the turn.

Points on the table are not yours until you hold. That is the whole game: every
roll risks everything you have accumulated this turn against the chance of
adding more.

## Winning

The first player to **reach or exceed** the winning score wins.

Checked on hold only. A streak that climbs past the target wins nothing until it
is banked — and a double six on the way there loses all of it.

On a win the game's status becomes `COMPLETED`, the winner's win count
increments, and every further action is refused from either seat.

## The winning score

Default **100**, configurable per game, range **2–1000**.

Chosen when the game is created and frozen for its duration. A player who could
move the finish line mid-game could move it out of an opponent's reach.

The unusually low minimum of 2 is deliberate: it lets an end-to-end test win a
match in a single hold with scripted dice, instead of scripting a dozen rounds
for no additional coverage.

## Holding on zero is legal

It banks nothing and passes the turn.

The brief asks for no restriction here, and adding one would change the game
rather than validate it: a player would lose the ability to voluntarily pass,
and the only way out of a turn would be to keep rolling until 6 and 6 came up.
Banking zero and handing over the dice is a legitimate move.

## New game

Either player may start one **at any time**, including mid-match.

It preserves both players and both **win counts**, resets both global scores and
the round score, clears the last roll and the winner, and increments the game
number. Win counts are the series score for that pair of players; games are what
resets.

## Who may do what

- Only the two seated players may act. Anyone else gets `NOT_A_PARTICIPANT` —
  including on a read, so a stranger cannot watch a match they are not in.
- Only the player whose turn it is may roll or hold. The other gets
  `NOT_YOUR_TURN`.
- Nobody may act on a completed game. Both get `GAME_OVER`.

The order of those three checks is deliberate and asserted by a test: game-over
is reported ahead of membership, and membership ahead of turn. "It is player 0's
turn" is information about a match, and a non-participant is owed only "you are
not in this game".

## Where the rules live

`standard@1` is a policy object behind a `GameRules` interface, resolved through
an allow-listed registry. It answers three questions and nothing else: what did
this throw do, may this player hold, does this total win.

The engine applies the consequence without ever looking at the dice. It receives
`ADD_TO_ROUND` with a point value or `LOSE_ROUND_AND_PASS`, and the outcome
carries its own effect name — because _what to call a lost round_ is a rules
decision too. An engine that hardcoded `DOUBLE_SIX` would mislabel any future
ruleset that lost the round some other way.

Every game stores the ruleset identity it was created under, so a finished match
stays scored by the rules it was played under even after a `standard@2` exists.

**What that buys, measured:** changing the losing combination touches
`rules/standard-v1.ts` and its own test file. Flip `BUST_FACE` from 6 to 5 and
exactly five tests fail, all in that file; the 74 engine tests pass untouched.

**What it does not buy**, stated plainly: a ruleset that subtracted from a global
score would need a new `RollOutcome` variant and an engine branch, and neither
the number of players nor the number of dice is expressed on the policy at all.
Those are accepted limits, not oversights — see
[decision 1](decisions/0001-versioned-rules-policy.md).
