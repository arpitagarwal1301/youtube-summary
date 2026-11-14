import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __GEMINI_BASE__: JSON.stringify('https://gemini.test'), __CONFIG_URL__: JSON.stringify('https://config.test/remote-config.json') },
  test: { include: ['test/**/*.test.ts'] },
});
