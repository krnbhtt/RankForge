import { describe, it, expect } from 'vitest';
import {
  AuditStatusEnum,
  AuditStageEnum,
  PatchActionEnum,
  PatchTagEnum,
  AuditCreateInputSchema,
  AuditCreateResponseSchema,
  RunAuditTaskInputSchema,
  AuditRecordSchema,
  AuditCompetitorSchema,
  AuditFindingSchema,
  AuditQuerySchema,
  AuditBlueprintSectionSchema,
  AuditPatchSchema,
  AuditImageSchema,
  WorkspaceSchema,
  StoreSchema,
  AuditErrorSchema,
} from '../src/index.js';

describe('AuditStatusEnum (Spec §6.1 Canonical 14 Statuses)', () => {
  const canonicalStatuses = [
    'queued',
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
    'blocked',
    'failed',
  ] as const;

  it('validates all 14 canonical statuses successfully', () => {
    expect(AuditStatusEnum.options.length).toBe(14);
    for (const status of canonicalStatuses) {
      const parsed = AuditStatusEnum.safeParse(status);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toBe(status);
      }
    }
  });

  it('rejects obsolete or unknown status values', () => {
    expect(AuditStatusEnum.safeParse('pending').success).toBe(false);
    expect(AuditStatusEnum.safeParse('in_progress').success).toBe(false);
    expect(AuditStatusEnum.safeParse('cancelled').success).toBe(false);
    expect(AuditStatusEnum.safeParse('').success).toBe(false);
  });
});

describe('PatchActionEnum (Spec §6.4 Canonical Operations)', () => {
  const canonicalActions = [
    'setText',
    'setAttr',
    'insertBefore',
    'insertAfter',
    'move',
    'remove',
    'setHeadMeta',
    'injectJsonLd',
  ] as const;

  it('validates all 8 patch actions', () => {
    expect(PatchActionEnum.options.length).toBe(8);
    for (const action of canonicalActions) {
      expect(PatchActionEnum.safeParse(action).success).toBe(true);
    }
  });

  it('rejects unsupported patch actions', () => {
    expect(PatchActionEnum.safeParse('deleteNode').success).toBe(false);
    expect(PatchActionEnum.safeParse('swap').success).toBe(false);
  });
});

describe('Ingress and Task Contracts', () => {
  describe('AuditCreateInputSchema', () => {
    it('accepts valid e-commerce URLs with defaults', () => {
      const result = AuditCreateInputSchema.safeParse({
        url: 'https://shop.example.com/products/leather-jacket',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.url).toBe('https://shop.example.com/products/leather-jacket');
        expect(result.data.imageConsent).toBe(false);
        expect(result.data.userId).toBe('anonymous');
        expect(result.data.keyword).toBeUndefined();
      }
    });

    it('accepts valid input with optional keyword and image consent', () => {
      const result = AuditCreateInputSchema.safeParse({
        url: 'https://store.example.in/item/123',
        keyword: '  vintage leather jacket  ',
        imageConsent: true,
        userId: 'user_42',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.keyword).toBe('vintage leather jacket');
        expect(result.data.imageConsent).toBe(true);
        expect(result.data.userId).toBe('user_42');
      }
    });

    it('rejects invalid or non-URL inputs', () => {
      expect(AuditCreateInputSchema.safeParse({ url: 'not-a-url' }).success).toBe(false);
      expect(AuditCreateInputSchema.safeParse({ url: '' }).success).toBe(false);
      expect(AuditCreateInputSchema.safeParse({}).success).toBe(false);
    });

    it('rejects non-HTTP/HTTPS protocols at the schema boundary (Spec R2 & Remediation Item 3)', () => {
      expect(
        AuditCreateInputSchema.safeParse({ url: 'javascript:alert(1)' }).success
      ).toBe(false);
      expect(
        AuditCreateInputSchema.safeParse({ url: 'ftp://example.com/product' }).success
      ).toBe(false);
      expect(
        AuditCreateInputSchema.safeParse({ url: 'file:///etc/passwd' }).success
      ).toBe(false);
      expect(
        AuditCreateInputSchema.safeParse({ url: 'data:text/html,<html></html>' }).success
      ).toBe(false);
      expect(
        AuditCreateInputSchema.safeParse({ url: 'ws://example.com/feed' }).success
      ).toBe(false);
    });
  });

  describe('AuditCreateResponseSchema', () => {
    it('validates successful audit creation response', () => {
      const result = AuditCreateResponseSchema.safeParse({
        success: true,
        auditId: '123e4567-e89b-12d3-a456-426614174000',
        status: 'queued',
        createdAt: '2026-11-20T07:45:00.000Z',
      });
      expect(result.success).toBe(true);
    });

    it('rejects response with invalid status', () => {
      const result = AuditCreateResponseSchema.safeParse({
        success: true,
        auditId: '123',
        status: 'invalid_status',
        createdAt: '2026-11-20T07:45:00.000Z',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('RunAuditTaskInputSchema', () => {
    it('validates task payload for worker execution', () => {
      const result = RunAuditTaskInputSchema.safeParse({
        auditId: '123e4567-e89b-12d3-a456-426614174000',
        targetUrl: 'https://example.com/product/1',
        keyword: 'running shoes',
        imageConsent: false,
        fastMode: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fastMode).toBe(true);
      }
    });

    it('rejects path traversal, empty, and invalid characters in auditId (Remediation Item 2)', () => {
      // Empty ID
      expect(
        RunAuditTaskInputSchema.safeParse({
          auditId: '',
          targetUrl: 'https://example.com/p/1',
        }).success
      ).toBe(false);

      // Path traversal segments
      expect(
        RunAuditTaskInputSchema.safeParse({
          auditId: '../traversal_test',
          targetUrl: 'https://example.com/p/1',
        }).success
      ).toBe(false);

      expect(
        RunAuditTaskInputSchema.safeParse({
          auditId: 'folder/audit_1',
          targetUrl: 'https://example.com/p/1',
        }).success
      ).toBe(false);

      expect(
        RunAuditTaskInputSchema.safeParse({
          auditId: 'folder\\audit_1',
          targetUrl: 'https://example.com/p/1',
        }).success
      ).toBe(false);

      // Invalid characters
      expect(
        RunAuditTaskInputSchema.safeParse({
          auditId: 'audit.id.json',
          targetUrl: 'https://example.com/p/1',
        }).success
      ).toBe(false);

      expect(
        RunAuditTaskInputSchema.safeParse({
          auditId: 'audit@special#chars',
          targetUrl: 'https://example.com/p/1',
        }).success
      ).toBe(false);

      // Valid IDs
      expect(
        RunAuditTaskInputSchema.safeParse({
          auditId: 'audit_valid-123_ABC',
          targetUrl: 'https://example.com/p/1',
        }).success
      ).toBe(true);
    });
  });
});

describe('Subcollection Contracts (Spec §6.1)', () => {
  it('validates AuditCompetitorSchema', () => {
    const competitor = {
      competitorId: 'comp_1',
      auditId: 'audit_123',
      url: 'https://competitor.com/item',
      rank: 1,
      source: 'organic',
      status: 'ok',
      title: 'Top Competitor Item',
      price: 1999,
      currency: 'INR',
      rating: 4.6,
      reviewCount: 340,
      trustSignals: ['COD Available', 'Free Shipping'],
    };
    expect(AuditCompetitorSchema.safeParse(competitor).success).toBe(true);
  });

  it('validates AuditFindingSchema', () => {
    const finding = {
      findingId: 'find_1',
      auditId: 'audit_123',
      category: 'conversion',
      tag: 'Conversion',
      severity: 'high',
      title: 'Missing Cash on Delivery Badge',
      description: 'Competitors display COD prominently above fold.',
      penaltyPoints: 8,
      evidence: 'Observed on 4 of 5 top competitors',
      createdAt: '2026-11-20T07:45:00.000Z',
    };
    expect(AuditFindingSchema.safeParse(finding).success).toBe(true);
  });

  it('validates AuditQuerySchema', () => {
    const query = {
      queryId: 'query_1',
      auditId: 'audit_123',
      query: 'is this dishwasher safe',
      step: 2,
      source: 'paa',
      answered: true,
      sectionTarget: 'faq',
    };
    expect(AuditQuerySchema.safeParse(query).success).toBe(true);
  });

  it('validates AuditBlueprintSectionSchema', () => {
    const section = {
      sectionId: 'sec_hero',
      auditId: 'audit_123',
      order: 1,
      name: 'Hero Section',
      strategy: 'Optimise Above the Fold CTA & MRP Clarity',
      action: 'rebuild',
      status: 'completed',
    };
    expect(AuditBlueprintSectionSchema.safeParse(section).success).toBe(true);
  });

  it('validates AuditPatchSchema', () => {
    const patch = {
      patchId: 'patch_1',
      auditId: 'audit_123',
      sectionId: 'sec_trust',
      op: 'insertAfter',
      targetSelector: '.price-container',
      htmlPayload: '<div class="rf-trust-badge">COD Available</div>',
      tag: 'Conversion',
      reason: 'Adds missing India payment signals',
      isSample: false,
      status: 'applied',
      createdAt: '2026-11-20T07:45:00.000Z',
    };
    expect(AuditPatchSchema.safeParse(patch).success).toBe(true);
  });

  it('validates AuditImageSchema', () => {
    const img = {
      imageId: 'img_1',
      auditId: 'audit_123',
      originalUrl: 'https://store.com/hero.jpg',
      prompt: 'Studio product photography on clean neutral background',
      status: 'ready',
      consentGiven: true,
      createdAt: '2026-11-20T07:45:00.000Z',
    };
    expect(AuditImageSchema.safeParse(img).success).toBe(true);
  });

  it('validates WorkspaceSchema and StoreSchema', () => {
    const ws = {
      wsId: 'ws_default',
      name: 'Personal Workspace',
      ownerUid: 'uid_123',
      createdAt: '2026-11-20T07:45:00.000Z',
    };
    expect(WorkspaceSchema.safeParse(ws).success).toBe(true);

    const store = {
      storeId: 'store_1',
      wsId: 'ws_default',
      domain: 'mystore.in',
      platform: 'shopify',
      createdAt: '2026-11-20T07:45:00.000Z',
    };
    expect(StoreSchema.safeParse(store).success).toBe(true);
  });
});

describe('Top-Level AuditRecordSchema', () => {
  it('validates complete audit record with stage timings and progress', () => {
    const record = {
      auditId: 'audit_abc123',
      wsId: 'default',
      userId: 'anonymous',
      targetUrl: 'https://example.com/product/chair',
      keyword: 'ergonomic office chair',
      keywordCandidates: ['mesh chair', 'ergonomic desk chair'],
      imageConsent: false,
      status: 'complete',
      stage: 'finalize',
      progressPercent: 100,
      platform: 'shopify',
      patchMode: 'static',
      stageTimings: {
        queued: '2026-11-20T07:45:00.000Z',
        complete: '2026-11-20T07:45:24.000Z',
      },
      createdAt: '2026-11-20T07:45:00.000Z',
      updatedAt: '2026-11-20T07:45:24.000Z',
      completedAt: '2026-11-20T07:45:24.000Z',
      totalCostInr: 0,
    };
    const parsed = AuditRecordSchema.safeParse(record);
    expect(parsed.success).toBe(true);
  });
});
