/**
 * Bundles a service (worker or preview) and the workspace packages it imports into one runnable file.
 * Workspace packages export TypeScript source, so they cannot be loaded by plain `node`; native and large
 * dependencies stay external and are installed in the image with `pnpm install --prod`.
 * Usage: node scripts/bundle.mjs worker|preview
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const services = {
  worker: { entry: 'apps/worker/src/index.ts', out: 'apps/worker/dist/server.js' },
  preview: { entry: 'apps/preview/src/index.ts', out: 'apps/preview/dist/server.js' },
};
const service = services[target];
if (!service) {
  console.error(`Unknown service "${target}". Use worker or preview.`);
  process.exit(1);
}

await build({
  entryPoints: [path.join(root, service.entry)],
  outfile: path.join(root, service.out),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  tsconfig: path.join(root, 'tsconfig.base.json'),
  external: ['playwright', 'playwright-core', '@google-cloud/*', 'cheerio', 'css-tree', 'pngjs', 'pixelmatch', 'express', 'cors', 'dotenv', 'zod', 'zod-to-json-schema'],
});
console.log(`Bundled ${target} to ${service.out}`);
