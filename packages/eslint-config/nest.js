import globals from 'globals';
import tseslint from 'typescript-eslint';

import { config as base, domainPurity } from './base.js';

/** Flat config for the NestJS API, including the domain-purity boundary. */
export default tseslint.config(
  ...base,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Nest's DI decorators are legitimately side-effecting class decorators.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  domainPurity,
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
