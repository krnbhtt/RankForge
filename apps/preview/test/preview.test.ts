import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDiskStorage } from '@rankforge/storage';
import { createPreviewApp } from '../src/app.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-preview-'));
const storage = new LocalDiskStorage(dir);
let server: http.Server;
let base: string;

beforeAll(async () => {
  await storage.put('aud1/target/index.html', '<html><body>current</body></html>', 'text/html');
  await storage.put('aud1/target/assets/abc.css', 'body{}', 'text/css');
  await storage.put('aud1/optimised/index.html', '<html><body>optimised</body></html>', 'text/html');
  await storage.put('secret/target/index.html', 'secret', 'text/html');
  const app = createPreviewApp(storage);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});

async function get(p: string) {
  return fetch(`${base}${p}`, { redirect: 'manual' });
}

describe('rf-preview', () => {
  it('serves /healthz', async () => {
    const res = await get('/healthz');
    expect(res.status).toBe(200);
    expect((await res.json()).service).toBe('rf-preview');
  });

  it('serves the current snapshot with noindex and hardening headers', async () => {
    const res = await get('/preview/aud1/current/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('current');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('serves assets with their content type and long-lived caching', async () => {
    const res = await get('/preview/aud1/current/assets/abc.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('serves the optimised variant from its own folder', async () => {
    const res = await get('/preview/aud1/optimised/');
    expect(await res.text()).toContain('optimised');
  });

  it('redirects a variant URL without a trailing slash so relative assets resolve', async () => {
    const res = await get('/preview/aud1/current');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/preview/aud1/current/');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('shows a friendly not-ready page when a preview does not exist yet', async () => {
    const res = await get('/preview/nope/current/');
    expect(res.status).toBe(404);
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(await res.text()).toContain('not ready yet');
  });

  it('rejects unknown variants and invalid audit ids', async () => {
    expect((await get('/preview/aud1/evil/')).status).toBe(404);
    expect((await get('/preview/a.b/current/')).status).toBe(404);
  });

  it.each([
    '/preview/aud1/current/..%2F..%2Fsecret/target/index.html',
    '/preview/aud1/current/%2e%2e/secret/target/index.html',
    '/preview/aud1/current/assets/%2e%2e/%2e%2e/index.html',
    '/preview/aud1/current/.hidden',
  ])('blocks path traversal attempt %s', async (p) => {
    const res = await get(p);
    expect([301, 400, 404]).toContain(res.status);
    expect(await res.text()).not.toContain('secret');
  });
});

describe('scroll sync bridge', () => {
  it('is injected into served HTML but not stored in the snapshot', async () => {
    const res = await get('/preview/aud1/current/');
    const html = await res.text();
    expect(html).toContain('data-rf-sync');
    expect(html.indexOf('data-rf-sync')).toBeLessThan(html.indexOf('</body>'));
    const stored = (await storage.get('aud1/target/index.html'))?.body.toString('utf8');
    expect(stored).not.toContain('data-rf-sync');
  });

  it('allows cross-origin font and asset loading from the sandboxed studio frame', async () => {
    const res = await get('/preview/aud1/current/assets/abc.css');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
