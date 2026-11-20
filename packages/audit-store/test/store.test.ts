import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AuditRecord } from '@rankforge/schema';
import { FileAuditStore, FirestoreAuditStore, type IAuditStore } from '../src/index.js';

function emulatorUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: 8080, timeout: 800 });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
  });
}

const hasEmulator = await emulatorUp();
if (hasEmulator) process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-audit-store-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function record(auditId: string): AuditRecord {
  const now = new Date().toISOString();
  return {
    auditId,
    wsId: 'default',
    userId: 'user_1',
    targetUrl: 'https://shop.example.org/products/x',
    keywordCandidates: [],
    imageConsent: false,
    status: 'queued',
    stage: 'init',
    progressPercent: 5,
    platform: 'unknown',
    patchMode: 'static',
    stageTimings: { queued: now },
    createdAt: now,
    updatedAt: now,
    totalCostInr: 0,
  };
}

const stores: [string, () => IAuditStore][] = [['FileAuditStore', () => new FileAuditStore(path.join(dir, 'files'))]];
if (hasEmulator) stores.push(['FirestoreAuditStore (emulator)', () => new FirestoreAuditStore({ projectId: 'rankforge-test' })]);

describe.each(stores)('%s contract', (_name, make) => {
  const store = make();
  const id = `t_${Math.random().toString(36).slice(2, 10)}`;

  it('creates and reads an audit', async () => {
    await store.createAudit(record(id));
    expect((await store.getAudit(id))?.status).toBe('queued');
    expect(await store.getAudit('t_missing')).toBeNull();
  });

  it('merges stage timings and keeps unrelated fields on update', async () => {
    const updated = await store.updateAudit(id, { status: 'capturing', stageTimings: { capturing: 'T1' } });
    expect(updated.status).toBe('capturing');
    expect(updated.stageTimings).toMatchObject({ capturing: 'T1' });
    expect(Object.keys(updated.stageTimings)).toContain('queued');
    expect(updated.targetUrl).toBe('https://shop.example.org/products/x');
  });

  it('rejects updates to unknown audits', async () => {
    await expect(store.updateAudit('t_missing', { status: 'failed' })).rejects.toThrow(/not found/);
  });

  it('replaces subcollections idempotently', async () => {
    const f = (n: number) =>
      ({
        findingId: `f${n}`,
        auditId: id,
        category: 'schema',
        tag: 'Ranking',
        severity: 'critical',
        title: `Finding ${n}`,
        description: 'd',
        penaltyPoints: n,
        createdAt: new Date().toISOString(),
      }) as never;
    await store.saveFindings(id, [f(1), f(2)]);
    await store.saveFindings(id, [f(2), f(3)]);
    await store.saveFindings(id, [f(2), f(3)]);
    const ids = (await store.getFindings(id)).map((x) => x.findingId).sort();
    expect(ids).toEqual(['f2', 'f3']);
  });

  it('returns the full composite record', async () => {
    const full = await store.getFullRecord(id);
    expect(full?.audit.auditId).toBe(id);
    expect(full?.findings).toHaveLength(2);
    expect(full?.competitors).toEqual([]);
  });

  it('notifies listeners of changes', async () => {
    const seen: string[] = [];
    const off = store.onAuditChange(id, (r) => seen.push(r.status));
    await store.updateAudit(id, { status: 'captured' });
    await new Promise((r) => setTimeout(r, 600));
    off();
    expect(seen).toContain('captured');
  });

  it('finds a recent completed audit for the same URL and keyword', async () => {
    const url = `https://shop.example.org/products/${id}`;
    const base = { ...record(`${id}_c1`), targetUrl: url, keyword: 'blue mug' };
    await store.createAudit(base);
    expect(await store.findRecentComplete(url, 'blue mug', 60_000)).toBeNull();
    await store.updateAudit(`${id}_c1`, { status: 'complete' });
    expect((await store.findRecentComplete(url, 'blue mug', 60_000))?.auditId).toBe(`${id}_c1`);
    expect(await store.findRecentComplete(url, 'other keyword', 60_000)).toBeNull();
    expect(await store.findRecentComplete(url, undefined, 60_000)).not.toBeNull();
    expect(await store.findRecentComplete(url, 'blue mug', -1)).toBeNull();
    expect(await store.findRecentComplete('https://elsewhere.example.org/p', undefined, 60_000)).toBeNull();
  });

  it('lists audits newest first and respects the limit', async () => {
    const a = { ...record(`${id}_l1`), createdAt: '2026-01-01T00:00:00.000Z' };
    const b = { ...record(`${id}_l2`), createdAt: '2026-06-01T00:00:00.000Z' };
    await store.createAudit(a);
    await store.createAudit(b);
    const list = await store.listAudits(500);
    const ids = list.map((x) => x.auditId);
    expect(ids.indexOf(`${id}_l2`)).toBeLessThan(ids.indexOf(`${id}_l1`));
    expect((await store.listAudits(1)).length).toBe(1);
  });

  it('refuses malformed audit ids', async () => {
    await expect(store.getAudit('../escape')).rejects.toThrow();
  });
});

it('reports whether the Firestore contract ran', () => {
  expect(typeof hasEmulator).toBe('boolean');
});
