import { defineWorkspace } from 'vitest/config';
import * as path from 'path';

const aliases = {
  '@rankforge/schema': path.resolve(__dirname, 'packages/schema/src/index.ts'),
  '@rankforge/scoring': path.resolve(__dirname, 'packages/scoring/src/index.ts'),
  '@rankforge/config': path.resolve(__dirname, 'packages/config/src/index.ts'),
  '@rankforge/skills': path.resolve(__dirname, 'packages/skills/src/index.ts'),
};

export default defineWorkspace([
  {
    test: {
      include: ['packages/**/*.test.ts'],
    },
    resolve: { alias: aliases },
  },
  {
    test: {
      include: ['apps/**/*.test.ts'],
    },
    resolve: { alias: aliases },
  },
]);
