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
  // Layering (docs/mcp-server-plan.md §2): domain <- templates <- app <- {infra, mcp}.
  // The composition root (src/main.ts, src/composition.ts, src/cli/) is the only place that wires layers together.
  layer('src/domain', ['**/app/**', '**/infra/**', '**/mcp/**', '**/templates/**', 'pg', '@modelcontextprotocol/*'], 'domain is pure: no other layers, no I/O libraries'),
  layer('src/templates', ['**/app/**', '**/infra/**', '**/mcp/**', 'pg', '@modelcontextprotocol/*'], 'templates are data: they may only use domain'),
  layer('src/app', ['**/infra/**', '**/mcp/**', 'pg', '@modelcontextprotocol/*'], 'app depends on domain and templates only; talk to the database through ports'),
  layer('src/infra', ['**/mcp/**', '@modelcontextprotocol/*'], 'infra must not depend on the MCP adapter'),
  layer('src/mcp', ['**/infra/**', 'pg'], 'the MCP adapter calls app services; it must not reach into infra'),
  {
    // Plain JS config files are not part of the TypeScript project.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);

/** Forbids files under `directory` from importing anything matching `forbidden`. */
function layer(directory, forbidden, message) {
  return {
    files: [`${directory}/**/*.ts`],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: forbidden, message }] }] },
  };
}
