import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileAuditStore } from '@rankforge/audit-store';
import { BlueprintSchema, type AuditFinding, type AuditRecord, type ConsensusModel, type Extraction } from '@rankforge/schema';
import { LocalDiskStorage } from '@rankforge/storage';
import { SpendTracker } from '../src/ai/gemini.js';
import type { EntityGapResult } from '../src/analysis/entity-gap.js';
import { arbitrate } from '../src/blueprint/arbiter.js';
import { evaluatePlaybook } from '../src/blueprint/playbook.js';
import { silentLog } from '../src/lib/log.js';
import { analysisKey } from '../src/stages/analysis-stage.js';
import { runBlueprintStage } from '../src/stages/blueprint-stage.js';
import { consensusKey } from '../src/stages/competitors-stage.js';

const HTML = `<html><body><main><h1>Blue Mug</h1><div id="price" class="price">₹1,499</div>
<form action="/cart/add"><button id="atc">Add to cart</button></form>
<div id="desc" class="product__description"><p>Ceramic.</p></div></main><footer>f</footer></body></html>`;

function extraction(over: Partial<Extraction> = {}): Extraction {
  return {
    version: 1,
    auditId: 'a',
    sourceUrl: 'https://s.example.org/p',
    finalUrl: 'https://s.example.org/p',
    capturedAt: '2026-11-20T00:00:00.000Z',
    source: 'live',
    platform: { type: 'custom', confidence: 0.3, signals: [] },
    hydration: { mode: 'server', framework: 'none', signals: [], sentinelSurvived: null },
    meta: { title: 'Blue Mug', description: '' },
    content: { h1: 'Blue Mug', text: 'A ceramic mug.', wordCount: 3 },
    headingTree: [{ level: 1, text: 'Blue Mug', children: [] }],
    jsonLd: [],
    images: [],
    price: { raw: '₹1,499', selling: 1499 },
    variants: [],
    reviews: { items: [] },
    ctaPositions: [{ text: 'Add to cart', selector: '#atc', viewport: 'mobile', top: 1400, aboveFold: false, sticky: false }],
    designTokens: { fontFamilies: [], baseFontSizePx: 16, colors: [], borderRadiiPx: [] },
    components: [
      { kind: 'price', selector: '#price', classes: ['price'] },
      { kind: 'addToCart', selector: '#atc', classes: [] },
      { kind: 'description', selector: '#desc', classes: ['product__description'] },
    ],
    classWhitelist: ['price'],
    stats: { blockedRequests: 0, stubbedRequests: 0, assetCount: 0, renderMs: 1, imagesDisabled: false },
    ...over,
  };
}

const consensus: ConsensusModel = {
  competitorCount: 8,
  lowConfidence: false,
  sectionSequence: [{ heading: 'shipping returns', frequency: 5, medianPosition: 0.8 }],
  entities: [],
  schemaTypes: [],
  trustElements: [
    { kind: 'cod', frequency: 5 },
    { kind: 'upi', frequency: 6 },
    { kind: 'reviews', frequency: 7 },
    { kind: 'certification', frequency: 4 },
  ],
  imageTypes: [],
  cta: { aboveFoldMobileShare: 0.7, stickyShare: 0.5 },
  medianWordCount: 400,
  medianImageCount: 6,
};

const gap: EntityGapResult = {
  consensusEntities: [{ name: 'dishwasher safe', frequency: 6 }, { name: 'lead free', frequency: 5 }],
  found: [],
  missing: [{ name: 'dishwasher safe', frequency: 6 }, { name: 'lead free', frequency: 5 }],
  querySequence: [{ query: 'is it dishwasher safe', order: 1, answered: false, evidence: '', source: 'paa' }],
};

const finding = (id: string, title: string): AuditFinding => ({
  findingId: id,
  auditId: 'a',
  category: 'conversion',
  tag: 'Conversion',
  severity: 'high',
  title,
  description: title,
  penaltyPoints: 5,
  evidence: 'measured',
  createdAt: '2026-11-20T00:00:00.000Z',
});

describe('CRO playbook', () => {
  it('adds only the sections that evidence supports', () => {
    const planned = evaluatePlaybook({ extraction: extraction(), findings: [finding('f1', 'UPI payment is not mentioned')], consensus, gap });
    expect(planned.map((p) => p.type)).toEqual(
      expect.arrayContaining(['delivery_payment', 'trust_row', 'sample_reviews', 'spec_table', 'faq', 'price_clarity', 'sticky_cta'])
    );
    const delivery = planned.find((p) => p.type === 'delivery_payment');
    expect(delivery?.justifications.some((j) => j.kind === 'finding' && j.ref === 'f1')).toBe(true);
    expect(delivery?.sample).toBe(true);
    expect(planned.find((p) => p.type === 'sticky_cta')?.sample).toBe(false);
  });

  it('skips sections the page already satisfies', () => {
    const rich = extraction({
      content: { h1: 'x', text: 'Cash on delivery and UPI. 7 day returns. Delivery in 3 days. ISO certified. Inclusive of all taxes.', wordCount: 20 },
      reviews: { reviewCount: 40, ratingValue: 4.5, items: [] },
      ctaPositions: [{ text: 'Add to cart', selector: '#atc', viewport: 'mobile', top: 400, aboveFold: true, sticky: true }],
    });
    const planned = evaluatePlaybook({
      extraction: rich,
      findings: [],
      consensus,
      gap: { consensusEntities: [], found: [], missing: [], querySequence: [{ query: 'q', order: 1, answered: true, evidence: 'e', source: 'paa' }] },
    });
    expect(planned).toEqual([]);
  });

  it('every planned section has at least one justification', () => {
    const planned = evaluatePlaybook({ extraction: extraction(), findings: [], consensus, gap });
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every((p) => p.justifications.length > 0)).toBe(true);
  });
});

describe('arbiter', () => {
  const planned = evaluatePlaybook({ extraction: extraction(), findings: [], consensus, gap });

  it('maps sections to real components, chains shared anchors and validates against the schema', () => {
    const bp = arbitrate({ auditId: 'a', keyword: 'mug', planned, advice: null, components: extraction().components, html: HTML, ruleIds: [] });
    expect(BlueprintSchema.safeParse(bp).success).toBe(true);
    expect(bp.generatedBy).toBe('fallback');
    const delivery = bp.sections.find((s) => s.type === 'delivery_payment');
    expect(delivery?.anchor).toMatchObject({ selector: '#atc', position: 'insertAfter', componentKind: 'addToCart' });
    const anchors = bp.sections.map((s) => s.anchor.selector);
    expect(anchors.some((a) => a.startsWith('[data-rf-section='))).toBe(true);
    expect(new Set(bp.sections.map((s) => s.sectionId)).size).toBe(bp.sections.length);
    expect(bp.sections.map((s) => s.order)).toEqual(bp.sections.map((_, i) => i + 1));
  });

  it('applies model advice for order, headings and depth', () => {
    const bp = arbitrate({
      auditId: 'a',
      keyword: 'mug',
      planned,
      advice: { sections: [{ type: 'faq', order: 1, h2: 'Mug questions answered', h3s: ['Is it dishwasher safe?'], depth: 'long' }] },
      components: extraction().components,
      html: HTML,
      ruleIds: [],
    });
    expect(bp.generatedBy).toBe('model');
    expect(bp.sections[0]).toMatchObject({ type: 'faq', h2: 'Mug questions answered', depth: 'long' });
  });

  it('drops a section when nothing on the page can host it, and says why', () => {
    const bp = arbitrate({ auditId: 'a', keyword: 'mug', planned, advice: null, components: [], html: '<html></html>', ruleIds: [] });
    expect(bp.sections).toEqual([]);
    expect(bp.decisionLog.some((d) => /No place on the page/.test(d.reason))).toBe(true);
  });

  it('lists deterministic fixes from rule ids', () => {
    const bp = arbitrate({
      auditId: 'a',
      keyword: 'mug',
      planned: [],
      advice: null,
      components: [],
      html: HTML,
      ruleIds: ['onpage.title.length', 'onpage.meta.missing', 'images.alt', 'schema.offer.price', 'schema.breadcrumb.missing'],
    });
    expect(bp.deterministicFixes).toEqual(['title', 'meta_description', 'image_alt', 'product_schema', 'breadcrumb_schema']);
  });
});

describe('runBlueprintStage', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-bp-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes the blueprint to the store and storage and degrades without the model', async () => {
    const store = new FileAuditStore(path.join(dir, 'audits'));
    const storage = new LocalDiskStorage(path.join(dir, 'artifacts'));
    const now = new Date().toISOString();
    const audit: AuditRecord = { auditId: 'bp1', wsId: 'default', userId: 'u', targetUrl: 'https://s.example.org/p', keyword: 'blue mug', keywordCandidates: [], imageConsent: false, status: 'analysed', stage: 'x', progressPercent: 72, platform: 'custom', patchMode: 'static', stageTimings: {}, createdAt: now, updatedAt: now, totalCostInr: 0 };
    await store.createAudit(audit);
    await store.saveFindings('bp1', [{ ...finding('fnd_001', 'No customer reviews are visible'), auditId: 'bp1' }]);
    await storage.put('bp1/target/index.html', HTML, 'text/html');
    await storage.put(consensusKey('bp1'), JSON.stringify(consensus), 'application/json');
    await storage.put(analysisKey('bp1'), JSON.stringify({ schema: { rules: [{ id: 'schema.product.missing' }] }, onPage: { rules: [] }, gap }), 'application/json');

    const bp = await runBlueprintStage(
      { store, storage, spend: new SpendTracker(25), logger: silentLog, advise: async () => null },
      audit,
      extraction()
    );
    expect(bp.sections.length).toBeGreaterThan(0);
    expect(bp.deterministicFixes).toContain('product_schema');
    const saved = await store.getBlueprint('bp1');
    expect(saved).toHaveLength(bp.sections.length);
    expect(saved[0]?.spec?.justifications.length).toBeGreaterThan(0);
    expect((await store.getAudit('bp1'))?.status).toBe('blueprinted');
    expect(await storage.exists('bp1/blueprint.json')).toBe(true);
  });
});
