import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests: the API driven end to end over HTTP, against real
 * infrastructure. Kept in a separate suite because they need MongoDB running
 * and the unit suite must stay runnable with nothing installed.
 *
 * Name them `*.integration.spec.ts`, and start the database first:
 *
 * ```bash
 * docker compose up -d     # repository root
 * pnpm test:integration
 * ```
 *
 * The script no longer passes `--passWithNoTests`. It did while Phase 3 shipped
 * none of these; now that they exist, "no tests were collected" means the glob
 * or the suite broke, and that has to be a red pipeline rather than a green one.
 *
 * They run against `dice-game-integration-test`, not the development database —
 * see `src/testing/integration-app.ts`.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    include: ['src/**/*.integration.spec.ts', 'test/**/*.integration.spec.ts'],
    environment: 'node',
    // Shared infrastructure; parallel suites would fight over the same records.
    fileParallelism: false,
  },
});
