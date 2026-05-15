// ESLint flat config — backend (Node 22 + TS + Express).
//
// Deliberately strict where it catches real bugs; relaxed elsewhere so the
// initial run doesn't drown in stylistic noise. Tighten rules as the team
// agrees on patterns.

import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'scripts/**/*.mjs', '**/*.d.ts'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // Real-bug catchers (errors).
      '@typescript-eslint/no-floating-promises': 'off', // requires type-aware linting; skip for now
      'no-unused-expressions': 'error',
      'no-implicit-coercion': ['error', { boolean: false }],
      'no-throw-literal': 'error',
      'no-return-await': 'error',
      'no-await-in-loop': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // Style / consistency (warnings — non-blocking until tightened).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off', // backend uses console for early-boot errors before pino loads
    },
  },
];
