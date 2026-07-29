'use client';

import { type GameView } from '@dice-game/contracts';
import { useEffect, useState } from 'react';

/**
 * How long the board holds still after a double six.
 *
 * **This is the one client-side gate in the whole app that is not a server
 * field, and it is deliberately not a rule.** It decides nothing: the server has
 * already wiped the round score and passed the turn, and the view that arrived
 * says so. All this does is keep Roll and Hold disabled for long enough that a
 * player sees the dice land on the throw that cost them the round, instead of
 * the board jumping straight to the next turn.
 *
 * A player who waits out the pause and one who does not reach exactly the same
 * position, because the transition already happened server-side. If this timer
 * were removed the game would still be correct — only less legible.
 */
export const DOUBLE_SIX_PAUSE_MS = 1600;

/**
 * `true` while the double-six animation is playing.
 *
 * Keyed on the revision as well as the effect, so a second double six in a row —
 * same effect, new revision — restarts the pause rather than being swallowed.
 */
export function useDoubleSixPause(view: GameView | undefined): boolean {
  const [paused, setPaused] = useState(false);
  const effect = view?.effect ?? null;
  const revision = view?.revision ?? null;

  useEffect(() => {
    if (revision === null || effect !== 'DOUBLE_SIX') {
      setPaused(false);

      return undefined;
    }

    setPaused(true);

    const timer = setTimeout(() => {
      setPaused(false);
    }, DOUBLE_SIX_PAUSE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [effect, revision]);

  return paused;
}
