import config from '@dice-game/eslint-config/next';

export default [
  ...config,
  {
    // `next build` output and the generated ambient declaration are not sources.
    ignores: ['.next/**', 'next-env.d.ts'],
  },
  {
    rules: {
      // Prop types are the TypeScript annotations. `react/prop-types` predates
      // that and re-checks it from JSX, where it cannot see the type and reports
      // every destructured prop as undeclared.
      'react/prop-types': 'off',
    },
  },
];
