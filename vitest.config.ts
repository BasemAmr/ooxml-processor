import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Packages opt in by placing tests next to sources or under a package-local
    // `test/` directory. Generated output is never tested directly — it is
    // tested through the hand-written harnesses that consume it.
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'packages/schema/src/generated/**'],
    // Fixtures can be large; give the corpus runner room without hiding a hang.
    testTimeout: 30_000,
  },
});
