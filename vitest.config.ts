import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __GEMINI_BASE__: JSON.stringify('https://gemini.test') },
  test: { include: ['test/**/*.test.ts'] },
});
