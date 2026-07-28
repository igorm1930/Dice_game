import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests: the API driven end to end over HTTP, against real
 * infrastructure. Kept in a separate suite because they need MongoDB running
 * and the unit suite must stay runnable with nothing installed.
 *
 * Name them `*.integration.spec.ts`. Phase 3 ships none — `--passWithNoTests`
 * in the script keeps the pipeline green until the first one lands.
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
