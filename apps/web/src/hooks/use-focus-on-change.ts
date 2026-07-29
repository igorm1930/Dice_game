'use client';

import { type RefObject, useEffect, useRef } from 'react';

/**
 * Moves focus to a container when the page swaps one branch for another.
 *
 * Signing in, creating a match and leaving a match all replace a whole region of
 * the page. The control the keyboard user just activated goes with it, and
 * focus falls to `<body>` — which is to say, back to the very top of the
 * document, on every single transition. The fix is the standard one: give the
 * region that replaced it `tabIndex={-1}` and put focus there.
 *
 * Two things it deliberately does not do:
 *
 *  - It never focuses on first render. Landing on a page and having it grab
 *    focus is its own defect, and it would also fight the skip link.
 *  - It never focuses on a transition *out of* `ignoreFrom`. That is how the
 *    initial `restoring` → `signed-in` settle stays silent: nobody pressed
 *    anything, so nothing should move.
 */
export function useFocusOnChange(
  branch: string,
  ref: RefObject<HTMLElement | null>,
  ignoreFrom?: string,
): void {
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = branch;

    if (before === null || before === branch || before === ignoreFrom) {
      return;
    }

    ref.current?.focus();
  }, [branch, ignoreFrom, ref]);
}
