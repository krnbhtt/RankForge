import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LocalDiskStorage, assertSafeKey, contentTypeForKey } from '../src/index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-storage-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('assertSafeKey', () => {
  it.each(['../x', '/abs', 'a/../b', 'a//b', '.hidden', 'a/.env', 'a b', 'a\\b', ''])('rejects %j', (k) => {
    expect(() => assertSafeKey(k)).toThrow();
  });
  it('accepts normal keys', () => {
    expect(() => assertSafeKey('audit_1/target/assets/abc123.css')).not.toThrow();
  });
});

describe('LocalDiskStorage', () => {
  const store = new LocalDiskStorage(root);

  it('round-trips an object and derives the content type', async () => {
    await store.put('a1/target/index.html', '<p>hi</p>', 'text/html');
    const got = await store.get('a1/target/index.html');
    expect(got?.body.toString()).toBe('<p>hi</p>');
    expect(got?.contentType).toContain('text/html');
    expect(await store.exists('a1/target/index.html')).toBe(true);
  });

  it('returns null for missing keys and directories', async () => {
    expect(await store.get('a1/nope.css')).toBeNull();
    expect(await store.get('a1/target')).toBeNull();
  });

  it('refuses traversal on put and get', async () => {
    await expect(store.put('../escape.txt', 'x', 'text/plain')).rejects.toThrow();
    await expect(store.get('a1/../../etc/passwd')).rejects.toThrow();
  });

  it('maps font and image extensions', () => {
    expect(contentTypeForKey('x.woff2')).toBe('font/woff2');
    expect(contentTypeForKey('x.webp')).toBe('image/webp');
    expect(contentTypeForKey('x.unknown')).toBe('application/octet-stream');
  });
});
