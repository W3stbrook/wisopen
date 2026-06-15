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
  },
});
