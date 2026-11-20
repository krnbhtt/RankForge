import { describe, expect, it } from 'vitest';
import {
  BlockedSiteError,
  ExtractionSchema,
  InternalError,
  PlatformProductDataSchema,
  toRankForgeError,
} from '../src/index.js';

const valid = {
  version: 1,
  auditId: 'a1',
  sourceUrl: 'https://shop.example.org/products/x',
  finalUrl: 'https://shop.example.org/products/x',
  capturedAt: '2026-11-20T10:00:00.000Z',
  source: 'live',
  platform: { type: 'shopify', confidence: 0.9, signals: ['cdn.shopify.com'] },
  hydration: { mode: 'server', framework: 'none', signals: [], sentinelSurvived: null },
  meta: { title: 'X', description: 'd' },
  content: { h1: 'X', text: 'hello world', wordCount: 2 },
  headingTree: [{ level: 1, text: 'X', children: [{ level: 2, text: 'Y', children: [] }] }],
  jsonLd: [],
  images: [{ src: 'https://a/b.jpg', alt: '', role: 'hero' }],
  variants: [],
  reviews: { items: [] },
  ctaPositions: [],
  designTokens: {
    fontFamilies: ['Inter'],
    baseFontSizePx: 16,
    colors: [{ value: '#fff', count: 3 }],
    borderRadiiPx: [4],
  },
  components: [{ kind: 'addToCart', selector: '#atc', classes: ['btn'] }],
  classWhitelist: ['btn'],
  stats: { blockedRequests: 0, stubbedRequests: 0, assetCount: 1, renderMs: 900, imagesDisabled: false },
};

describe('ExtractionSchema', () => {
  it('accepts a complete extraction', () => {
    expect(ExtractionSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a wrong version and a bad heading level', () => {
    expect(ExtractionSchema.safeParse({ ...valid, version: 2 }).success).toBe(false);
    const bad = { ...valid, headingTree: [{ level: 7, text: 'x', children: [] }] };
    expect(ExtractionSchema.safeParse(bad).success).toBe(false);
  });

  it('normalises numeric variant ids from platform data', () => {
    const r = PlatformProductDataSchema.parse({
      source: 'shopify_json',
      title: 'T',
      variants: [{ id: 123, title: 'S' }],
    });
    expect(r.variants[0]?.id).toBe('123');
  });
});

describe('typed errors', () => {
  it('BlockedSiteError carries a recovery action and converts to an AuditError', () => {
    const e = new BlockedSiteError('blocked', 'http_status', { status: 403 });
    const a = e.toAuditError(new Date('2026-11-20T00:00:00Z'));
    expect(a.code).toBe('BlockedSiteError');
    expect(a.recoveryAction).toMatch(/Paste/);
    expect(a.details).toMatchObject({ reason: 'http_status', status: 403 });
  });

  it('wraps unknown throwables as InternalError', () => {
    expect(toRankForgeError(new Error('boom'))).toBeInstanceOf(InternalError);
    expect(toRankForgeError('str').message).toBe('str');
  });
});
