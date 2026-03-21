import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['.opencode/skills/**/tests/*.test.ts'],
  },
});
