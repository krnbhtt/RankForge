import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditRecord } from '@rankforge/schema';

vi.mock('../lib/task-queue', () => ({ enqueueAuditTask: vi.fn() }));

import { getWebAuditStore } from '../lib/audit-store';
import { enqueueAuditTask } from '../lib/task-queue';
import { POST } from '../app/api/audits/[auditId]/html/route';

let dir: string;

function audit(status: AuditRecord['status']): AuditRecord {
  const now = new Date().toISOString();
  return {
    auditId: 'paste_1',
    wsId: 'default',
    userId: 'u',
    targetUrl: 'https://shop.example.org/products/x',
    keywordCandidates: [],
    imageConsent: false,
    status,
    stage: 'scrape_target',
    progressPercent: 12,
    platform: 'unknown',
    patchMode: 'static',
    stageTimings: {},
    createdAt: now,
    updatedAt: now,
    totalCostInr: 0,
    error: {
      code: 'BlockedSiteError',
      message: 'blocked',
      recoveryAction: 'Paste the page HTML instead so we can continue.',
      timestamp: now,
    },
  };
}

const html = `<html><head><title>Pasted</title></head><body>${'<p>Product copy.</p>'.repeat(30)}</body></html>`;

function request(body: unknown, auditId = 'paste_1') {
  const req = new NextRequest(`http://localhost/api/audits/${auditId}/html`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  return POST(req, { params: { auditId } });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-paste-'));
  process.env.ARTIFACT_DIR = path.join(dir, 'artifacts');
  delete process.env.BUCKET;
  getWebAuditStore(path.join(dir, 'audits'));
  vi.mocked(enqueueAuditTask).mockClear();
});
afterEach(() => {
  delete process.env.ARTIFACT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/audits/{id}/html', () => {
  it('stores the pasted HTML, requeues a blocked audit and returns 202', async () => {
    const store = getWebAuditStore();
    await store.createAudit(audit('blocked'));
    const res = await request({ html });
    expect(res.status).toBe(202);
    expect(enqueueAuditTask).toHaveBeenCalledWith(
      expect.objectContaining({ auditId: 'paste_1', targetUrl: 'https://shop.example.org/products/x' })
    );
    const saved = fs.readFileSync(path.join(dir, 'artifacts', 'paste_1', 'input', 'pasted.html'), 'utf8');
    expect(saved).toBe(html);
    const after = await store.getAudit('paste_1');
    expect(after?.status).toBe('queued');
    expect(after?.error).toBeUndefined();
  });

  it('rejects HTML that is too short with a plain-language recovery action', async () => {
    await getWebAuditStore().createAudit(audit('blocked'));
    const res = await request({ html: '<p>hi</p>' });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.code).toBe('UserInputError');
    expect(json.error.recoveryAction).toMatch(/paste/i);
    expect(enqueueAuditTask).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and invalid audit ids', async () => {
    expect((await request('{nope')).status).toBe(400);
    expect((await request({ html }, '../escape')).status).toBe(400);
  });

  it('returns 404 for unknown audits and 409 when the audit is not blocked', async () => {
    expect((await request({ html })).status).toBe(404);
    await getWebAuditStore().createAudit(audit('analysing'));
    const res = await request({ html });
    expect(res.status).toBe(409);
    expect(enqueueAuditTask).not.toHaveBeenCalled();
  });
});
