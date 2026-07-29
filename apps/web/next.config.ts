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
};

export default nextConfig;
