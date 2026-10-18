import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov'],
      // AGENTS.md §5: every file must keep >= 90% coverage.
      thresholds: {
        perFile: true,
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
