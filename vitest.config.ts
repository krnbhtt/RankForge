import { defineConfig } from 'vitest/config';
import * as path from 'path';

const pkg = (name: string) => path.resolve(__dirname, `packages/${name}/src/index.ts`);

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'services/*/test/**/*.test.ts'],
  },
  resolve: {
    alias: [
      { find: '@rankforge/schema', replacement: pkg('schema') },
      { find: '@rankforge/scoring', replacement: pkg('scoring') },
      { find: '@rankforge/config', replacement: pkg('config') },
      { find: '@rankforge/ssrf', replacement: pkg('ssrf') },
      { find: '@rankforge/storage', replacement: pkg('storage') },
      { find: '@rankforge/skills', replacement: pkg('skills') },
      // The Next.js app uses `@/` for its own source root.
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, 'apps/web/$1') },
    ],
  },
});
