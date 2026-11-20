import * as fs from 'node:fs';
import * as path from 'node:path';

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

/** Artifact store addressed by object keys such as `{auditId}/target/index.html`. */
export interface ArtifactStorage {
  put(key: string, body: Buffer | string, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  exists(key: string): Promise<boolean>;
}

/** Object keys for a capture, following the layout in specification section 6.2. */
export const artifactKeys = {
  pastedHtml: (auditId: string) => `${auditId}/input/pasted.html`,
  extraction: (auditId: string) => `${auditId}/target/extraction.json`,
  targetIndex: (auditId: string) => `${auditId}/target/index.html`,
  targetScreen: (auditId: string, viewport: 'mobile' | 'desktop') => `${auditId}/target/screens/${viewport}.png`,
};

const KEY_PATTERN = /^[A-Za-z0-9_\-./]+$/;

/** Rejects keys that could escape the storage root or address hidden files. */
export function assertSafeKey(key: string): void {
  if (
    !key ||
    !KEY_PATTERN.test(key) ||
    key.startsWith('/') ||
    key.split('/').some((seg) => seg === '..' || seg === '.' || seg === '' || seg.startsWith('.'))
  ) {
    throw new Error(`Invalid storage key '${key}'`);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

export function contentTypeForKey(key: string): string {
  return CONTENT_TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream';
}

/** Local-disk implementation used in development and tests. Content types derive from the extension. */
export class LocalDiskStorage implements ArtifactStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) {
      throw new Error(`Invalid storage key '${key}'`);
    }
    return full;
  }

  async put(key: string, body: Buffer | string): Promise<void> {
    const full = this.resolve(key);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(tmp, body);
    await fs.promises.rename(tmp, full);
  }

  async get(key: string): Promise<StoredObject | null> {
    const full = this.resolve(key);
    try {
      const body = await fs.promises.readFile(full);
      return { body, contentType: contentTypeForKey(key) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'EISDIR') {
        return null;
      }
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }
}

/** Google Cloud Storage implementation. Honours STORAGE_EMULATOR_HOST for local emulators. */
export class GcsStorage implements ArtifactStorage {
  constructor(private readonly bucketName: string) {}

  private async bucket() {
    const { Storage } = await import('@google-cloud/storage');
    const emulator = process.env.STORAGE_EMULATOR_HOST;
    const client = new Storage(emulator ? { apiEndpoint: emulator } : {});
    return client.bucket(this.bucketName);
  }

  async put(key: string, body: Buffer | string, contentType: string): Promise<void> {
    assertSafeKey(key);
    const bucket = await this.bucket();
    await bucket.file(key).save(body, { contentType, resumable: false });
  }

  async get(key: string): Promise<StoredObject | null> {
    assertSafeKey(key);
    const bucket = await this.bucket();
    const file = bucket.file(key);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [body] = await file.download();
    const [meta] = await file.getMetadata();
    return { body, contentType: String(meta.contentType ?? contentTypeForKey(key)) };
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    const bucket = await this.bucket();
    const [exists] = await bucket.file(key).exists();
    return exists;
  }
}

/** Walks up from `start` to the directory holding pnpm-workspace.yaml so every service shares one dev store. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

/** Chooses GCS when BUCKET is set, otherwise local disk under ARTIFACT_DIR (default `<repo>/.data/artifacts`). */
export function createStorageFromEnv(env: NodeJS.ProcessEnv = process.env): ArtifactStorage {
  if (env.BUCKET) return new GcsStorage(env.BUCKET);
  return new LocalDiskStorage(env.ARTIFACT_DIR ?? path.join(findRepoRoot(), '.data', 'artifacts'));
}
