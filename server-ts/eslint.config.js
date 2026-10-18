import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      // AGENTS.md §2: strict typing, no `any`, no floating promises.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // AGENTS.md §1: stdout is reserved for MCP JSON-RPC; never log with console.
      'no-console': 'error',
      // AGENTS.md §2: external packages first, then internal modules.
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      // AGENTS.md §2: no `x as unknown as T` double casts without a justified disable.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']",
          message:
            'Avoid `as unknown as T` double casts. If a third-party typing limitation forces it, disable this rule on that line with a justification.',
        },
      ],
    },
  },
  {
    // Plain JS config files are not part of the TypeScript project.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
