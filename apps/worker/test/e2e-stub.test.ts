import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { FileAuditStore, getAuditStore } from '../src/store/audit-store.js';

describe('End-to-End Stub Job Walk (Spec §6.1 & §9.4 Prompt 3)', () => {
  const testDir = path.resolve(process.cwd(), '.data/e2e-stub-audits');
  let store: FileAuditStore;

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    store = new FileAuditStore(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('progresses through every canonical status from queued to complete', async () => {
    const auditId = 'e2e_stub_audit_123';
    const targetUrl = 'https://example-shop.com/products/ceramic-pour-over';
    const keyword = 'ceramic pour over dripper';

    // 1. Initial State: queued
    await store.createAudit({
      auditId,
      wsId: 'default',
      userId: 'test_user',
      targetUrl,
      keyword,
      keywordCandidates: [],
      imageConsent: false,
      status: 'queued',
      stage: 'init',
      progressPercent: 5,
      stageTimings: { queued: new Date().toISOString() },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalCostInr: 0,
    });

    const initRecord = await store.getAudit(auditId);
    expect(initRecord?.status).toBe('queued');
    expect(initRecord?.progressPercent).toBe(5);

    // 2. Walk status updates
    const statuses = [
      'capturing',
      'captured',
      'awaiting_keyword',
      'discovering',
      'competitors',
      'analysing',
      'analysed',
      'blueprinted',
      'rebuilding',
      'verifying',
      'complete',
    ] as const;

    for (const status of statuses) {
      await store.updateAudit(auditId, {
        status,
        stage: `stage_${status}`,
        stageTimings: { [status]: new Date().toISOString() },
      });
      const check = await store.getAudit(auditId);
      expect(check?.status).toBe(status);
    }

    // 3. Final complete state check
    const finalAudit = await store.getAudit(auditId);
    expect(finalAudit?.status).toBe('complete');
    expect(finalAudit?.stageTimings.queued).toBeDefined();
    expect(finalAudit?.stageTimings.complete).toBeDefined();
  });
});
