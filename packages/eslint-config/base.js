import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Shared flat config for every workspace package.
 *
 * Two deliberate departures from the previous generation of this repository:
 *
 *  1. Nothing is excluded. The old config ignored `client/**` outright, so a
 *     headline of "0 lint errors" covered zero frontend files. Every app opts
 *     in here.
 *  2. The domain-purity rule is an ESLint rule, not a bespoke test. The old
 *     architecture test compared import specifiers against a hardcoded list of
 *     seven names that did not include the frameworks it was meant to keep out.
 *     `no-restricted-imports` with patterns fails closed instead.
 */
export const config = tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // Config files sit outside every tsconfig `include`, so the type-aware
    // parser has no program for them. They still get syntax and correctness
    // rules — just not the ones that need type information.
    ...tseslint.configs.disableTypeChecked,
    files: [
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.cjs',
      '**/*.config.ts',
      '**/eslint.config.js',
    ],
  },
  prettier,
);

/**
 * Applied to the framework-independent domain layer.
 *
 * The domain may not reach for a framework, a driver, the network, the clock,
 * the environment, or a random number generator. Everything it needs is passed
 * in. Patterns rather than exact names, so a subpath import cannot slip past.
 */
export const domainPurity = {
  files: ['**/src/domain/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '@nestjs/*',
              'mongoose',
              'mongodb',
              'express',
              'react',
              'next/*',
              'node:*',
              'crypto',
              'http',
              'https',
              'fs',
              'path',
              'zod',
              'argon2',
              'bcrypt*',
              'jsonwebtoken',
              '@dice-game/contracts',
            ],
            message:
              'The domain layer must stay framework-independent. Inject what you need through a port instead.',
          },
        ],
      },
    ],
    'no-restricted-properties': [
      'error',
      { object: 'Math', property: 'random', message: 'Inject a RandomGenerator port.' },
      { object: 'Date', property: 'now', message: 'Inject a Clock port.' },
      { object: 'process', property: 'env', message: 'Configuration is passed in, never read.' },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: "NewExpression[callee.name='Date'][arguments.length=0]",
        message: 'Inject a Clock port rather than reading the wall clock.',
      },
    ],
  },
};

export default config;
