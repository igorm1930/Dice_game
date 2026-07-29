import nextPlugin from '@next/eslint-plugin-next';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

import { config as base } from './base.js';

/**
 * Flat config for the Next.js client.
 *
 * jsx-a11y runs at `strict`, not `recommended`. The assignment asks for keyboard
 * accessibility and visible focus states, and the previous generation of this UI
 * shipped with focus styling on three text inputs and no buttons at all — a
 * linter that only warns would not have caught it.
 */
export default tseslint.config(
  ...base,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    settings: {
      react: { version: 'detect' },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      '@next/next': nextPlugin,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.strict.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  /**
   * No hand-written API path, anywhere in the client.
   *
   * Every URL comes from the contract's `ROUTES` table, including the
   * parameterised ones. This is a linter rule rather than a test for the same
   * reason domain purity is: a test that renders a component and compares the
   * path it requested against `ROUTES.games.roll(id)` passes *identically*
   * whether the component read the table or typed the string, because both
   * sides of the assertion end up as the same characters. A hardcoded literal
   * is invisible to the assertion and obvious to a pattern.
   *
   * Both node types are covered, because `` `/api/games/${id}` `` is a
   * TemplateLiteral rather than a Literal and would otherwise walk straight
   * past.
   */
  {
    files: ['**/src/**/*.ts', '**/src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^\\/api\\//]',
          message:
            'API paths come from the contract’s ROUTES table. Import ROUTES from @dice-game/contracts instead of writing the path.',
        },
        {
          selector: 'TemplateElement[value.raw=/^\\/api\\//]',
          message:
            'API paths come from the contract’s ROUTES table. Import ROUTES from @dice-game/contracts instead of building the path.',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
