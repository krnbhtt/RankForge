import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import type { Server } from 'http';
import { FileAuditStore, getAuditStore } from '../src/store/audit-store.js';
import { tasksRouter } from '../src/routes/tasks.js';

describe('Worker FileAuditStore', () => {
  const testDir = path.resolve(process.cwd(), '.data/test-audits');
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

  it('creates and retrieves an audit record', async () => {
    const auditId = 'test_audit_001';
    await store.createAudit({
      auditId,
      wsId: 'default',
      userId: 'user_1',
      targetUrl: 'https://store.example.com/item',
      status: 'queued',
      stage: 'init',
      progressPercent: 5,
      stageTimings: { queued: new Date().toISOString() },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalCostInr: 0,
    });

    const retrieved = await store.getAudit(auditId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.auditId).toBe(auditId);
    expect(retrieved?.status).toBe('queued');
    expect(retrieved?.progressPercent).toBe(5);
  });

  it('updates audit status and stage atomically', async () => {
    const auditId = 'test_audit_002';
    await store.createAudit({
      auditId,
      userId: 'user_1',
      targetUrl: 'https://store.example.com/item',
      status: 'queued',
      stage: 'init',
      progressPercent: 5,
      stageTimings: { queued: new Date().toISOString() },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalCostInr: 0,
    });

    const updated = await store.updateAudit(auditId, {
      status: 'capturing',
      stage: 'scrape_target',
      progressPercent: 12,
    });

    expect(updated.status).toBe('capturing');
    expect(updated.stage).toBe('scrape_target');
    expect(updated.progressPercent).toBe(12);

    const reloaded = await store.getAudit(auditId);
    expect(reloaded?.status).toBe('capturing');
  });

  it('saves and retrieves subcollections', async () => {
    const auditId = 'test_audit_003';
    await store.createAudit({
      auditId,
      userId: 'user_1',
      targetUrl: 'https://store.example.com/item',
      status: 'queued',
      stage: 'init',
      progressPercent: 5,
      stageTimings: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalCostInr: 0,
    });

    // Save competitors
    await store.saveCompetitors(auditId, [
      {
        competitorId: 'c1',
        auditId,
        url: 'https://c1.com',
        rank: 1,
        source: 'organic',
        status: 'ok',
        trustSignals: ['COD'],
      },
    ]);

    const competitors = await store.getCompetitors(auditId);
    expect(competitors.length).toBe(1);
    expect(competitors[0]?.rank).toBe(1);

    // Save findings
    await store.saveFindings(auditId, [
      {
        findingId: 'f1',
        auditId,
        category: 'conversion',
        tag: 'Conversion',
        severity: 'critical',
        title: 'Missing COD badge',
        description: 'No COD badge above fold',
        penaltyPoints: 12,
        createdAt: new Date().toISOString(),
      },
    ]);

    const findings = await store.getFindings(auditId);
    expect(findings.length).toBe(1);
    expect(findings[0]?.penaltyPoints).toBe(12);
  });

  it('rejects path traversal and invalid auditId format (Remediation Item 2)', async () => {
    // Relative path traversal with ..
    await expect(store.getAudit('../traversal_test')).rejects.toThrow(
      /Path traversal characters are prohibited|must only contain alphanumeric/
    );

    // Empty ID
    await expect(store.getAudit('')).rejects.toThrow(/non-empty string/);

    // Slashes and backslashes
    await expect(store.getAudit('folder/audit')).rejects.toThrow(
      /must only contain alphanumeric/
    );
    await expect(store.getAudit('folder\\audit')).rejects.toThrow(
      /must only contain alphanumeric/
    );

    // Special characters
    await expect(store.getAudit('audit@evil')).rejects.toThrow(
      /must only contain alphanumeric/
    );
  });
});

describe('Worker Tasks Route Defense-in-Depth (Remediation Items 2 & 4)', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.use(tasksRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects SSRF loopback and IPv4-mapped IPv6 targets on POST /internal/tasks/run', async () => {
    // IPv4 loopback
    const resLoopback = await fetch(`${baseUrl}/internal/tasks/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auditId: 'worker_ssrf_test_1',
        targetUrl: 'http://127.0.0.1:4050/internal/tasks/run',
        fastMode: true,
      }),
    });
    expect(resLoopback.status).toBe(400);
    const jsonLoopback = await resLoopback.json();
    expect(jsonLoopback.success).toBe(false);
    expect(jsonLoopback.error.message).toContain('SSRF validation failed');

    // IPv4-mapped IPv6 cloud metadata
    const resMetadata = await fetch(`${baseUrl}/internal/tasks/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auditId: 'worker_ssrf_test_2',
        targetUrl: 'http://[::ffff:169.254.169.254]/computeMetadata/v1/',
        fastMode: true,
      }),
    });
    expect(resMetadata.status).toBe(400);
    const jsonMetadata = await resMetadata.json();
    expect(jsonMetadata.success).toBe(false);
    expect(jsonMetadata.error.message).toContain('SSRF validation failed');
  });

  it('rejects path traversal audit IDs at the schema boundary on POST /internal/tasks/run', async () => {
    const res = await fetch(`${baseUrl}/internal/tasks/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auditId: '../traversal_probe',
        targetUrl: 'https://example.com/product/1',
        fastMode: true,
      }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('UserInputError');
  });
});

describe('Phase 0 Deterministic Mock Progression', () => {


});
