import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';

export default [
  // Ignore build artifacts and dependencies
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'docs/_build/**',
      'rollup.config-*.cjs',
    ],
  },

  // Base JS rules
  js.configs.recommended,

  // Base TS rules
  ...tseslint.configs.recommended,

  // JS env/globals for config and scripts, and disable TS-only rule on JS
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
      ecmaVersion: 2021,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },

  // Demo page and browser tests run code in the page (page.evaluate callbacks)
  {
    files: ['demo/**/*.js', 'test/e2e/**/*.mjs', 'test/ha/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  // no-useless-assignment is new in ESLint 10; the upstream card code predates it.
  {
    files: ['src/index.ts', 'src/components/**/*.ts'],
    rules: {
      'no-useless-assignment': 'off',
    },
  },

  // TS: temporarily disable problematic rule causing crash
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },

  // Enforce Prettier formatting via ESLint
  {
    files: ['**/*.js', '**/*.ts', '**/*.mjs', '**/*.cjs'],
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      // Defer to Prettier config in package.json for options (singleQuote, etc.)
      'prettier/prettier': 'error',
    },
  },

  // Relax no-explicit-any temporarily for type-heavy files
  {
    files: ['src/types.ts', 'src/inverters/dto/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Globally allow underscore-prefixed unused vars/args to reduce noise
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs', '**/*.cjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // src/localize/localize.ts: allow any and ignore '_' caught errors
  {
    files: ['src/localize/localize.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^[_e]$',
        },
      ],
    },
  },
];
