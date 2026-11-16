import { defineConfig } from 'vitest/config';

/** Vitest config: run every test once under Node, then exit (no watch mode). */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    watch: false,
  },
});
