import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileAuditStore } from '@rankforge/audit-store';
import type { AuditRecord, ConsensusModel, Extraction } from '@rankforge/schema';
import { LocalDiskStorage } from '@rankforge/storage';
import { SpendTracker } from '../src/ai/gemini.js';
import { runImageStudio, planImages } from '../src/rebuild/image-studio.js';
import { silentLog } from '../src/lib/log.js';

const consensus: ConsensusModel = {
  competitorCount: 8,
  lowConfidence: false,
  sectionSequence: [],
  entities: [],
  schemaTypes: [],
  trustElements: [],
  imageTypes: [{ type: 'lifestyle', frequency: 6 }],
  cta: { aboveFoldMobileShare: 0.5, stickyShare: 0.5 },
  medianWordCount: 300,
  medianImageCount: 5,
};

const extraction = (over: Partial<Extraction> = {}): Extraction =>
  ({
    version: 1,
    auditId: 'a',
    sourceUrl: 'https://s.example.org/p',
    finalUrl: 'https://s.example.org/p',
    capturedAt: '2026-11-20T00:00:00.000Z',
    source: 'live',
    platform: { type: 'custom', confidence: 0.3, signals: [] },
    hydration: { mode: 'server', framework: 'none', signals: [], sentinelSurvived: null },
    meta: { title: 'Blue Mug', description: '' },
    content: { h1: 'Blue Mug', text: 'A mug.', wordCount: 2 },
    headingTree: [],
    jsonLd: [],
    images: [{ src: 'https://cdn.example.org/mug.jpg', alt: 'Blue mug', role: 'hero' }],
    variants: [],
    reviews: { items: [] },
    ctaPositions: [],
    designTokens: { fontFamilies: [], baseFontSizePx: 16, colors: [], borderRadiiPx: [] },
    components: [],
    classWhitelist: [],
    stats: { blockedRequests: 0, stubbedRequests: 0, assetCount: 0, renderMs: 1, imagesDisabled: false },
    ...over,
  }) as Extraction;

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const okImage = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] }), { status: 200 });

describe('image studio', () => {
  let dir: string;
  let store: FileAuditStore;
  let storage: LocalDiskStorage;
  const audit = (consent: boolean): AuditRecord => {
    const now = new Date().toISOString();
    return { auditId: 'im1', wsId: 'default', userId: 'u', targetUrl: 'https://s.example.org/p', keywordCandidates: [], imageConsent: consent, status: 'blueprinted', stage: 'x', progressPercent: 80, platform: 'custom', patchMode: 'static', stageTimings: {}, createdAt: now, updatedAt: now, totalCostInr: 0 };
  };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-img-'));
    store = new FileAuditStore(path.join(dir, 'a'));
    storage = new LocalDiskStorage(path.join(dir, 's'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const deps = (over = {}) => ({ store, storage, spend: new SpendTracker(25), logger: silentLog, enabled: true, downloadImage: async () => ({ data: png, mimeType: 'image/png' }), apiKey: 'k', ...over });

  it('plans a hero image and a lifestyle image only when competitors use lifestyle images and the page has none', () => {
    expect(planImages(extraction(), consensus).map((p) => p.kind)).toEqual(['hero', 'lifestyle']);
    expect(planImages(extraction({ images: [{ src: 'https://c/x.jpg', alt: 'in use in the kitchen', role: 'hero' }] }), consensus).map((p) => p.kind)).toEqual(['hero']);
    expect(planImages(extraction(), { ...consensus, imageTypes: [] }).map((p) => p.kind)).toEqual(['hero']);
  });

  it('does nothing without consent or when the feature flag is off', async () => {
    const fetchImpl = vi.fn();
    const noConsent = await runImageStudio(deps({ fetchImpl }), audit(false), extraction(), consensus, '#g');
    expect(noConsent.status).toBe('skipped');
    const flagOff = await runImageStudio(deps({ fetchImpl, enabled: false }), audit(true), extraction(), consensus, '#g');
    expect(flagOff.skippedBecause).toMatch(/switched off/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('generates, stores and labels images, and counts their cost', async () => {
    await store.createAudit(audit(true));
    const fetchImpl = vi.fn(async () => okImage());
    const spend = new SpendTracker(25);
    const r = await runImageStudio(deps({ fetchImpl, spend }), audit(true), extraction(), consensus, '#gallery');
    expect(r.status).toBe('done');
    expect(r.images.map((i) => i.status)).toEqual(['ready', 'ready']);
    expect(await storage.exists('im1/images/img_01_hero.png')).toBe(true);
    expect(r.ops).toHaveLength(2);
    expect(r.ops[0]).toMatchObject({ op: 'insertAfter', target: '#gallery', sample: true, tag: 'Conversion', sectionId: 'img_01_hero' });
    expect(r.ops[0]?.html).toContain('AI-generated');
    expect(r.ops[0]?.html).toContain('rf-sample-chip');
    expect(spend.totalInr).toBeGreaterThanOrEqual(11);
    expect((await store.getImages('im1')).length).toBe(2);
    const models = fetchImpl.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(models[0]).toContain('nano-banana-pro-preview');
    expect(models[1]).toContain('gemini-3.1-flash-image-preview');
  });

  it('records a failure, stops on quota, and never throws', async () => {
    await store.createAudit(audit(true));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }));
    const r = await runImageStudio(deps({ fetchImpl }), audit(true), extraction(), consensus, '#gallery');
    expect(r.status).toBe('done');
    expect(r.ops).toEqual([]);
    expect(r.images.map((i) => i.status)).toEqual(['failed']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('records a failure when the model returns no image', async () => {
    await store.createAudit(audit(true));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'no image' }] } }] }), { status: 200 }));
    const r = await runImageStudio(deps({ fetchImpl }), audit(true), extraction({ images: [{ src: 'https://c/x.jpg', alt: 'in use home', role: 'hero' }] }), { ...consensus, imageTypes: [] }, '#g');
    expect(r.images[0]?.status).toBe('failed');
    expect(r.ops).toEqual([]);
  });
});
