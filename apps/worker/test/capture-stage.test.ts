import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockedSiteError, type AuditRecord, type Extraction } from '@rankforge/schema';
import { LocalDiskStorage } from '@rankforge/storage';
import type { CaptureInput, CaptureOutput } from '../src/capture/capture.js';
import { extractionKey, pastedHtmlKey, runCaptureStage } from '../src/pipeline/capture-stage.js';
import { silentLog } from '../src/lib/log.js';
import { FileAuditStore } from '../src/store/audit-store.js';

let dir: string;
let store: FileAuditStore;
let storage: LocalDiskStorage;

function baseAudit(auditId: string, status: AuditRecord['status'] = 'queued'): AuditRecord {
  const now = new Date().toISOString();
  return {
    auditId,
    wsId: 'default',
    userId: 'u',
    targetUrl: 'https://shop.example.org/products/x',
    keywordCandidates: [],
    imageConsent: false,
    status,
    stage: 'init',
    progressPercent: 5,
    platform: 'unknown',
    patchMode: 'static',
    stageTimings: {},
    createdAt: now,
    updatedAt: now,
    totalCostInr: 0,
  };
}

function fakeOutput(mode: 'server' | 'runtime' = 'server'): CaptureOutput {
  const extraction = {
    source: 'live',
    finalUrl: 'https://shop.example.org/products/x',
    platform: { type: 'shopify', confidence: 0.9, signals: [] },
    hydration: { mode, framework: 'none', signals: [], sentinelSurvived: true },
    meta: { title: 'Blue Mug', description: '' },
    stats: { assetCount: 12, imagesDisabled: false, blockedRequests: 0, stubbedRequests: 0, renderMs: 800 },
  } as unknown as Extraction;
  return { extraction, timings: { renderMs: 800, snapshotMs: 300, analysisMs: 400, totalMs: 1500 } };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-stage-'));
  store = new FileAuditStore(path.join(dir, 'audits'));
  storage = new LocalDiskStorage(path.join(dir, 'artifacts'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('runCaptureStage', () => {
  it('checkpoints platform, patch mode and capture summary, reporting each step', async () => {
    await store.createAudit(baseAudit('s1'));
    const stages: string[] = [];
    const capture = vi.fn(async (input: CaptureInput) => {
      for (const step of ['rendering', 'snapshotting', 'analysing'] as const) {
        await input.onProgress?.(step);
        stages.push((await store.getAudit('s1'))?.stage ?? '');
      }
      return fakeOutput('runtime');
    });
    const outcome = await runCaptureStage(
      { store, storage, capture, logger: silentLog },
      (await store.getAudit('s1')) as AuditRecord
    );
    const audit = await store.getAudit('s1');
    expect(outcome).toBe('captured');
    expect(stages).toEqual(['render_page', 'proxy_assets', 'extract_page']);
    expect(audit).toMatchObject({
      status: 'captured',
      platform: 'shopify',
      patchMode: 'runtime',
      progressPercent: 20,
    });
    expect(audit?.capture).toMatchObject({ assetCount: 12, hydrationMode: 'runtime', title: 'Blue Mug' });
    expect(audit?.stageTimings).toHaveProperty('capturing');
    expect(audit?.stageTimings).toHaveProperty('captured');
  });

  it('marks the audit blocked with a recovery action when the site blocks capture', async () => {
    await store.createAudit(baseAudit('s2'));
    const capture = vi.fn(async () => {
      throw new BlockedSiteError('refused', 'http_status', { status: 403 });
    });
    const outcome = await runCaptureStage(
      { store, storage, capture, logger: silentLog },
      (await store.getAudit('s2')) as AuditRecord
    );
    const audit = await store.getAudit('s2');
    expect(outcome).toBe('blocked');
    expect(audit?.status).toBe('blocked');
    expect(audit?.error?.code).toBe('BlockedSiteError');
    expect(audit?.error?.recoveryAction).toMatch(/Paste/);
  });

  it('marks unexpected errors as failed with InternalError', async () => {
    await store.createAudit(baseAudit('s3'));
    const capture = vi.fn(async () => {
      throw new Error('chromium crashed');
    });
    const outcome = await runCaptureStage(
      { store, storage, capture, logger: silentLog },
      (await store.getAudit('s3')) as AuditRecord
    );
    expect(outcome).toBe('failed');
    expect((await store.getAudit('s3'))?.error?.code).toBe('InternalError');
  });

  it('skips capture when the extraction is already checkpointed', async () => {
    await store.createAudit(baseAudit('s4', 'analysing'));
    await storage.put(extractionKey('s4'), '{}', 'application/json');
    const capture = vi.fn();
    const outcome = await runCaptureStage(
      { store, storage, capture: capture as never, logger: silentLog },
      (await store.getAudit('s4')) as AuditRecord
    );
    expect(outcome).toBe('captured');
    expect(capture).not.toHaveBeenCalled();
    expect((await store.getAudit('s4'))?.status).toBe('analysing');
  });

  it('re-captures a blocked audit using pasted HTML', async () => {
    await store.createAudit(baseAudit('s5', 'blocked'));
    await storage.put(extractionKey('s5'), '{}', 'application/json');
    await storage.put(pastedHtmlKey('s5'), '<html>pasted</html>', 'text/html');
    const capture = vi.fn(async (_input: CaptureInput) => fakeOutput());
    const outcome = await runCaptureStage(
      { store, storage, capture, logger: silentLog },
      (await store.getAudit('s5')) as AuditRecord
    );
    expect(outcome).toBe('captured');
    expect(capture.mock.calls[0]?.[0].html).toBe('<html>pasted</html>');
    expect((await store.getAudit('s5'))?.error).toBeUndefined();
  });
});
