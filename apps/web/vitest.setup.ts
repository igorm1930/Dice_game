import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

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
