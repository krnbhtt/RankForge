import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      '@rankforge/schema': path.resolve(__dirname, 'packages/schema/src/index.ts'),
      '@rankforge/scoring': path.resolve(__dirname, 'packages/scoring/src/index.ts'),
      '@rankforge/config': path.resolve(__dirname, 'packages/config/src/index.ts'),
      '@rankforge/skills': path.resolve(__dirname, 'packages/skills/src/index.ts'),
    },
  },
});
