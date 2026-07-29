import { type Page } from '@playwright/test';

/**
 * Driving the page with nothing but the keyboard.
 *
 * The jsdom suite can assert that a control is focusable; it cannot assert that
 * a real browser paints a focus ring on it, because jsdom has no layout and no
 * `:focus-visible`. That is the gap this file exists to close.
 *
 * Nothing here clicks. `tabUntil` walks the real tab order one press at a time
 * and reports the stops it visited when it fails, so a broken tab order reads as
 * "went past these eleven things" rather than as a timeout.
 */

export interface FocusedElement {
  id: string;
  ariaLabel: string | null;
  tagName: string;
  text: string;
}

/** What currently holds focus, described enough to match on and to report. */
export function focused(page: Page): Promise<FocusedElement> {
  return page.evaluate(() => {
    const element = document.activeElement;

    if (element === null) {
      return { id: '', ariaLabel: null, tagName: 'NOTHING', text: '' };
    }

    return {
      id: element.id,
      ariaLabel: element.getAttribute('aria-label'),
      tagName: element.tagName,
      text: element.textContent.trim().slice(0, 40),
    };
  });
}

/** A tab order deep enough to cross both seats and the board, and no deeper. */
const MAX_TAB_STOPS = 40;

export async function tabUntil(
  page: Page,
  description: string,
  matches: (element: FocusedElement) => boolean,
): Promise<void> {
  const visited: string[] = [];

  for (let step = 0; step < MAX_TAB_STOPS; step += 1) {
    await page.keyboard.press('Tab');

    const current = await focused(page);

    visited.push(describe(current));

    if (matches(current)) {
      return;
    }
  }

  throw new Error(
    `Tabbed ${MAX_TAB_STOPS} times without reaching ${description}. ` +
      `Stops visited: ${visited.join(' → ')}`,
  );
}

function describe(element: FocusedElement): string {
  if (element.id !== '') {
    return `#${element.id}`;
  }

  if (element.ariaLabel !== null) {
    return `"${element.ariaLabel}"`;
  }

  return element.text === '' ? element.tagName : `"${element.text}"`;
}

export interface FocusRing {
  style: string;
  width: number;
  color: string;
}

/**
 * The outline the browser is actually painting on the focused element.
 *
 * Read from the computed style rather than from a class name: the ring is
 * declared twice — once as a Tailwind `focus-visible:` utility on the component
 * and once as a bare default in `globals.css` — and what matters is that one of
 * them reached the element.
 */
export function focusRing(page: Page): Promise<FocusRing> {
  return page.evaluate(() => {
    const element = document.activeElement;

    if (element === null) {
      throw new Error('Nothing holds focus, so there is no ring to measure.');
    }

    const computed = window.getComputedStyle(element);

    return {
      style: computed.outlineStyle,
      width: Number.parseFloat(computed.outlineWidth),
      color: computed.outlineColor,
    };
  });
}
