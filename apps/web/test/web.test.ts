import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { validateTargetUrl, isPrivateIp } from '@rankforge/ssrf';
import { WebAuditStore } from '../lib/audit-store.js';

describe('Web SSRF Validation (Spec R2 & §4.2)', () => {
  it('allows valid public e-commerce URLs', async () => {
    const valid = await validateTargetUrl('https://example.com/products/ceramic-dripper', { resolver: async () => ['93.184.216.34'] });
    expect(valid.isValid).toBe(true);
    expect(valid.error).toBeUndefined();
  });

  it('rejects non-HTTP/HTTPS protocols', async () => {
    const ftp = await validateTargetUrl('ftp://example.com/product');
    expect(ftp.isValid).toBe(false);
    expect(ftp.error).toContain('Only HTTP and HTTPS are permitted');

    const file = await validateTargetUrl('file:///etc/passwd');
    expect(file.isValid).toBe(false);
  });

  it('rejects loopback addresses and localhost', async () => {
    const localhost = await validateTargetUrl('http://localhost:3000/api');
    expect(localhost.isValid).toBe(false);
    expect(localhost.error).toContain('prohibited');

    const loopback = await validateTargetUrl('http://127.0.0.1:8080/secret');
    expect(loopback.isValid).toBe(false);
  });

  it('rejects Google Cloud metadata endpoint (169.254.169.254)', async () => {
    const metadata = await validateTargetUrl('http://169.254.169.254/computeMetadata/v1/');
    expect(metadata.isValid).toBe(false);
    expect(metadata.error).toContain('prohibited');
  });

  it('rejects internal GCP hostname (metadata.google.internal)', async () => {
    const internalHost = await validateTargetUrl('http://metadata.google.internal/computeMetadata/v1/');
    expect(internalHost.isValid).toBe(false);
    expect(internalHost.error).toContain('Internal or private hostnames');
  });

  it('rejects private IPv4 subnets (10.x, 172.16-31.x, 192.168.x)', async () => {
    const classA = await validateTargetUrl('http://10.0.0.5/item');
    expect(classA.isValid).toBe(false);

    const classB = await validateTargetUrl('http://172.20.0.1/item');
    expect(classB.isValid).toBe(false);

    const classC = await validateTargetUrl('http://192.168.1.100/item');
    expect(classC.isValid).toBe(false);
  });

  it('rejects IPv4-mapped IPv6, NAT64, and 6to4 bypass attempts (Remediation Item 1)', async () => {
    // IPv4-mapped IPv6 loopback and metadata targets
    const mappedMetadata = await validateTargetUrl('http://[::ffff:169.254.169.254]');
    expect(mappedMetadata.isValid).toBe(false);
    expect(mappedMetadata.error).toContain('prohibited');

    const mappedLoopback = await validateTargetUrl('http://[::ffff:127.0.0.1]');
    expect(mappedLoopback.isValid).toBe(false);
    expect(mappedLoopback.error).toContain('prohibited');

    const mappedPrivateA = await validateTargetUrl('http://[::ffff:10.0.0.1]');
    expect(mappedPrivateA.isValid).toBe(false);
    expect(mappedPrivateA.error).toContain('prohibited');

    const mappedPrivateC = await validateTargetUrl('http://[::ffff:192.168.1.1]');
    expect(mappedPrivateC.isValid).toBe(false);
    expect(mappedPrivateC.error).toContain('prohibited');

    // Hex notation mapped IPv6: 169.254.169.254 -> a9fe:a9fe
    const hexMapped = await validateTargetUrl('http://[::ffff:a9fe:a9fe]');
    expect(hexMapped.isValid).toBe(false);
    expect(hexMapped.error).toContain('prohibited');

    // NAT64 well-known prefix: 64:ff9b::127.0.0.1
    const nat64Loopback = await validateTargetUrl('http://[64:ff9b::127.0.0.1]');
    expect(nat64Loopback.isValid).toBe(false);
    expect(nat64Loopback.error).toContain('prohibited');

    // 6to4 prefix: 2002:a9fe:a9fe::
    const sixToFourMetadata = await validateTargetUrl('http://[2002:a9fe:a9fe::]');
    expect(sixToFourMetadata.isValid).toBe(false);
    expect(sixToFourMetadata.error).toContain('prohibited');
  });

  it('validates isPrivateIp directly for IPv4-mapped and special IPv6 addresses', () => {
    expect(isPrivateIp('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateIp('[::ffff:127.0.0.1]')).toBe(true);
    expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:192.168.1.1')).toBe(true);
    expect(isPrivateIp('64:ff9b::127.0.0.1')).toBe(true);
    expect(isPrivateIp('2002:7f00:0001::')).toBe(true);
    expect(isPrivateIp('2002:a9fe:a9fe::')).toBe(true);

    // Public addresses are NOT private
    expect(isPrivateIp('93.184.216.34')).toBe(false);
    expect(isPrivateIp('::ffff:93.184.216.34')).toBe(false);
  });
});

describe('WebAuditStore Resilience', () => {
  const testDir = path.resolve(process.cwd(), '.data/test-web-audits');
  let store: WebAuditStore;

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    store = new WebAuditStore(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('creates and reads composite records', async () => {
    const auditId = 'web_test_001';
    await store.createAudit({
      auditId,
      wsId: 'default',
      userId: 'anonymous',
      targetUrl: 'https://example.com/p/1',
      keywordCandidates: [],
      imageConsent: false,
      platform: 'unknown',
      patchMode: 'static',
      status: 'queued',
      stage: 'init',
      progressPercent: 5,
      stageTimings: { queued: new Date().toISOString() },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalCostInr: 0,
    });

    const composite = await store.readComposite(auditId);
    expect(composite).not.toBeNull();
    expect(composite?.audit.auditId).toBe(auditId);
    expect(composite?.audit.status).toBe('queued');
    expect(composite?.competitors).toEqual([]);
    expect(composite?.findings).toEqual([]);
  });

  it('updates audit record with stage timestamps', async () => {
    const auditId = 'web_test_002';
    await store.createAudit({
      auditId,
      wsId: 'default',
      userId: 'anonymous',
      targetUrl: 'https://example.com/p/2',
      keywordCandidates: [],
      imageConsent: false,
      platform: 'unknown',
      patchMode: 'static',
      status: 'queued',
      stage: 'init',
      progressPercent: 5,
      stageTimings: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalCostInr: 0,
    });

    const now = new Date().toISOString();
    await store.updateAudit(auditId, {
      status: 'capturing',
      stage: 'scrape_target',
      progressPercent: 12,
      stageTimings: { capturing: now },
    });

    const updated = await store.getAudit(auditId);
    expect(updated?.status).toBe('capturing');
    expect(updated?.progressPercent).toBe(12);
    expect(updated?.stageTimings.capturing).toBe(now);
  });

  it('rejects path traversal and invalid characters in auditId (Remediation Item 2)', async () => {
    // Path traversal with ..
    await expect(store.getAudit('../traversal_test')).rejects.toThrow(
      /Path traversal characters are prohibited|must only contain alphanumeric/
    );

    // Empty ID
    await expect(store.getAudit('')).rejects.toThrow(
      /non-empty string/
    );

    // Subdirectory attempt with slash
    await expect(store.getAudit('subdir/audit_1')).rejects.toThrow(
      /must only contain alphanumeric/
    );

    // Backslash attempt
    await expect(store.getAudit('subdir\\audit_1')).rejects.toThrow(
      /must only contain alphanumeric/
    );

    // Special characters
    await expect(store.getAudit('audit@evil')).rejects.toThrow(
      /must only contain alphanumeric/
    );
  });
});
