import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Vitest transforms with esbuild by default, which strips types without ever
 * emitting `design:paramtypes`. NestJS resolves constructor dependencies from
 * exactly that metadata, so a provider under test would arrive with `undefined`
 * for every injected argument. SWC with `decoratorMetadata` emits it, which is
 * why this plugin is here and not a matter of taste.
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
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
