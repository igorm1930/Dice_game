import '@testing-library/jest-dom/vitest';

import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

/**
 * Testing Library gives `findBy*` one second by default, and one second is not
 * a property of this code — it is a property of the machine.
 *
 * Every board assertion waits on a React Query fetch resolving through a fake
 * `fetch` and two renders. That is milliseconds when the suite has the CPU to
 * itself and occasionally more than a second when `turbo run lint typecheck
 * test` has ESLint and two `tsc` processes running beside it. The failure looked
 * like a real one — `Unable to find role="region" and name "Game 1"` — and
 * reproduced about once in three full runs while passing every time the suite
 * was run alone.
 *
 * Raising the ceiling costs nothing on a passing run: `findBy*` resolves the
 * moment the element appears, so this only changes how long a genuine failure
 * takes to report.
 */
configure({ asyncUtilTimeout: 5000 });

/**
 * The API origin the fake answers on. Set before any module is imported so
 * `src/lib/env.ts`, which reads it once at module scope exactly as the browser
 * bundle does, sees a stable value.
 */
process.env.NEXT_PUBLIC_API_URL = 'http://api.test';

beforeEach(() => {
  // Seat sessions live in `sessionStorage`. A test that signed a seat in must
  // not leak that seat into the next test.
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});
