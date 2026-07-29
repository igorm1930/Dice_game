import path from 'node:path';

import { type NextConfig } from 'next';

/**
 * `eslint.ignoreDuringBuilds` is not a way of hiding lint failures: `pnpm lint`
 * runs ESLint over this package as its own turbo task, with the shared flat
 * config, and CI runs that task. What is switched off here is the *second*,
 * different lint pass `next build` would otherwise run through its own
 * resolution path — one config, one place it can fail.
 *
 * Type errors are deliberately left on: `next build` should fail on them, and
 * `pnpm typecheck` runs `tsc --noEmit` over the same sources besides.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },

  /**
   * `standalone` emits a server bundled with only the files it actually
   * traced — the production image copies that instead of a `node_modules` it
   * would otherwise have to install and prune.
   *
   * `outputFileTracingRoot` has to be said out loud in a workspace. Tracing
   * starts from the package directory by default, and in a pnpm monorepo the
   * real dependencies live in the root store behind symlinks, so the trace
   * stops at the package boundary and the image starts and then fails on a
   * missing module. `turbo` runs this task with the cwd set to `apps/web`, and
   * so does the Dockerfile.
   */
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '..', '..'),
};

export default nextConfig;
