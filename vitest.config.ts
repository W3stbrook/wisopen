import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@wisopen/shared': path.resolve(process.cwd(), 'packages/shared/src/index.ts'),
    },
  },
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'backend/tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/release/**', 'tests/e2e/**'],
    environment: 'node',
    // live-stack integration tests hit a real Supabase (auth + DB + a real LLM call),
    // which is far slower than the default 5s; unit tests still finish in ms.
    testTimeout: 30_000,
  },
});
