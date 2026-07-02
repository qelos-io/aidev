import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, '.vitepress') },
      { find: /^vitepress$/, replacement: resolve(__dirname, 'tests/mocks/vitepress.ts') },
    ],
  },
});
