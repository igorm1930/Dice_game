import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

/**
 * Executable architecture enforcement.
 *
 * Every claim this project makes about its own structure is asserted here, so a
 * violation fails CI instead of surviving until someone notices in review. A
 * layering rule that lives only in a README is a layering rule that erodes.
 */
const SRC_ROOT = resolve(__dirname, '../../src');

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(full);
      }
      return entry.name.endsWith('.ts') ? [full] : [];
    }),
  );

  return nested.flat();
}

interface SourceFile {
  readonly path: string;
  readonly relativePath: string;
  readonly contents: string;
  readonly imports: readonly string[];
}

async function loadSources(subdirectory = ''): Promise<SourceFile[]> {
  const files = await collectFiles(join(SRC_ROOT, subdirectory));

  return Promise.all(
    files.map(async (path) => {
      const contents = await readFile(path, 'utf8');
      const imports = [...contents.matchAll(/(?:from|require\()\s*['"]([^'"]+)['"]/g)].map(
        (match) => match[1] ?? '',
      );

      return { path, relativePath: relative(SRC_ROOT, path), contents, imports };
    }),
  );
}

describe('Architecture: layer boundaries', () => {
  /**
   * The load-bearing rule of the whole design. If the core can import Express,
   * the ports are decorative and the "swap the adapter" claim is false.
   */
  describe('the core is framework-agnostic', () => {
    const FORBIDDEN_IN_CORE = [
      'express',
      'helmet',
      'cors',
      'pino',
      'express-rate-limit',
      'http',
      'node:http',
    ];

    it('imports no HTTP or framework package anywhere under core/', async () => {
      const sources = await loadSources('core');
      expect(sources.length).toBeGreaterThan(0);

      const violations = sources.flatMap((file) =>
        file.imports
          .filter((specifier) => FORBIDDEN_IN_CORE.includes(specifier))
          .map((specifier) => `${file.relativePath} imports '${specifier}'`),
      );

      expect(violations).toEqual([]);
    });

    it('never reaches into the http/ or infrastructure/ layers', async () => {
      const sources = await loadSources('core');

      const violations = sources.flatMap((file) =>
        file.imports
          .filter((specifier) => /(^|\/)(http|infrastructure)\//.test(specifier))
          .map((specifier) => `${file.relativePath} imports '${specifier}'`),
      );

      expect(violations).toEqual([]);
    });

    /**
     * The domain must not even depend on the application service layer — the
     * dependency arrow points inward only.
     */
    it('keeps the domain free of service-layer imports', async () => {
      const sources = await loadSources('core/domain');

      const violations = sources.flatMap((file) =>
        file.imports
          .filter((specifier) => specifier.includes('services/'))
          .map((specifier) => `${file.relativePath} imports '${specifier}'`),
      );

      expect(violations).toEqual([]);
    });
  });

  describe('dependency inversion', () => {
    it('has the service layer depend on ports, never on concrete adapters', async () => {
      const sources = await loadSources('core/services');

      const violations = sources.flatMap((file) =>
        file.imports
          .filter((specifier) => specifier.includes('infrastructure'))
          .map((specifier) => `${file.relativePath} imports '${specifier}'`),
      );

      expect(violations).toEqual([]);
    });

    /**
     * Concrete implementations may be named in exactly one file. If a second
     * file starts calling `new InMemoryGameRepository()`, the composition root
     * has stopped being the single place wiring is decided.
     */
    it('confines adapter instantiation to the composition root', async () => {
      const sources = await loadSources();
      const ADAPTERS = [
        'InMemoryGameRepository',
        'InMemoryPigGameRepository',
        'InMemoryUserRepository',
        'InMemoryAuthTokenService',
        'ScryptPasswordHasher',
        'CryptoRandomGenerator',
        'SystemClock',
        'UuidGenerator',
        'AsyncMutex',
      ];

      const offenders = sources
        .filter((file) => file.relativePath !== 'container.ts')
        .flatMap((file) =>
          ADAPTERS.filter((adapter) => file.contents.includes(`new ${adapter}(`)).map(
            (adapter) => `${file.relativePath} instantiates ${adapter}`,
          ),
        );

      expect(offenders).toEqual([]);
    });
  });

  describe('production hygiene', () => {
    it('contains no console usage — all output goes through the structured logger', async () => {
      const sources = await loadSources();

      const offenders = sources
        .filter((file) => /\bconsole\.(log|info|warn|error|debug)\s*\(/.test(file.contents))
        .map((file) => file.relativePath);

      expect(offenders).toEqual([]);
    });

    it('reads process.env only in config and the composition root', async () => {
      // Configuration scattered across modules is untestable and undocumentable;
      // it must funnel through the validated schema.
      const sources = await loadSources();

      const offenders = sources
        .filter((file) => file.contents.includes('process.env'))
        .map((file) => file.relativePath)
        .filter((path) => path !== 'config/env.ts' && path !== 'container.ts');

      expect(offenders).toEqual([]);
    });

    it('leaves no TODO or FIXME markers in shipped code', async () => {
      const sources = await loadSources();

      const offenders = sources
        .filter((file) => /\b(TODO|FIXME|XXX|HACK)\b/.test(file.contents))
        .map((file) => file.relativePath);

      expect(offenders).toEqual([]);
    });
  });

  describe('async safety', () => {
    /**
     * Regression guard for the Express 4 failure mode: an async handler passed
     * to a route without `asyncHandler` swallows rejections, hanging the request
     * and never reaching the error middleware.
     */
    it('wraps every async route handler', async () => {
      const routeFiles = await loadSources('http/routes');
      expect(routeFiles.length).toBeGreaterThan(0);

      for (const file of routeFiles) {
        const handlerRefs = [...file.contents.matchAll(/router\.(get|post|put|patch|delete)\(/g)];

        for (const match of handlerRefs) {
          const statement = file.contents.slice(
            match.index,
            file.contents.indexOf(');', match.index),
          );

          // Health probes are synchronous; everything else must be wrapped.
          const isSynchronousProbe = /controller\.(live|ready)/.test(statement);
          const isWrapped = statement.includes('asyncHandler(');

          expect(isWrapped || isSynchronousProbe).toBe(true);
        }
      }
    });
  });
});
