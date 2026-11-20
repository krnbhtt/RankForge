import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileAuditStore } from '@rankforge/audit-store';
import { AuditFindingSchema, type AuditRecord, type ConsensusModel, type Extraction } from '@rankforge/schema';
import { LocalDiskStorage } from '@rankforge/storage';
import { SpendTracker } from '../src/ai/gemini.js';
import { consensusThreshold, entityAppearsInText, quoteAppearsInText } from '../src/analysis/entity-gap.js';
import { buildFindings } from '../src/analysis/findings.js';
import { auditOnPage } from '../src/analysis/onpage-audit.js';
import { parsePsi } from '../src/analysis/psi.js';
import { auditProductSchema } from '../src/analysis/schema-audit.js';
import { buildConversionInput } from '../src/analysis/signals.js';
import { closestCategory, parseTaxonomy } from '../src/analysis/taxonomy.js';
import { prepareScreenshot } from '../src/analysis/visual-cro.js';
import { silentLog } from '../src/lib/log.js';
import { analysisKey, combineConversionRuns, runAnalysisStage } from '../src/stages/analysis-stage.js';

function extraction(over: Partial<Extraction> = {}): Extraction {
  return {
    version: 1,
    auditId: 'a',
    sourceUrl: 'https://shop.example.org/p/x',
    finalUrl: 'https://shop.example.org/p/x',
    capturedAt: '2026-11-20T00:00:00.000Z',
    source: 'live',
    platform: { type: 'shopify', confidence: 0.9, signals: [] },
    hydration: { mode: 'server', framework: 'none', signals: [], sentinelSurvived: true },
    meta: { title: 'Blue Ceramic Mug For Coffee And Tea Lovers', description: 'A mug.', canonical: 'https://shop.example.org/p/x' },
    content: {
      h1: 'Blue Ceramic Mug',
      text: 'A hand glazed ceramic mug that holds 350 ml. Cash on delivery. Dishwasher safe stoneware. 7 day returns.',
      wordCount: 20,
    },
    headingTree: [{ level: 1, text: 'Blue Ceramic Mug', children: [{ level: 2, text: 'Details', children: [] }, { level: 2, text: 'Care', children: [] }] }],
    jsonLd: [],
    images: [
      { src: 'https://cdn/blue-ceramic-mug-front.jpg', alt: 'Blue mug', role: 'hero' },
      { src: 'https://cdn/blue-ceramic-mug-side.jpg', alt: 'Side view', role: 'gallery' },
      { src: 'https://cdn/blue-ceramic-mug-top.jpg', alt: 'Top view', role: 'gallery' },
      { src: 'https://cdn/blue-ceramic-mug-box.jpg', alt: 'In the box', role: 'gallery' },
    ],
    price: { raw: '₹1,499', selling: 1499, mrp: 1999, discountPercent: 25, currency: 'INR' },
    variants: [],
    reviews: { items: [] },
    ctaPositions: [{ text: 'Add to cart', selector: '#atc', viewport: 'mobile', top: 1500, aboveFold: false, sticky: false, heightPx: 40 }],
    designTokens: { fontFamilies: ['Inter'], baseFontSizePx: 16, colors: [], borderRadiiPx: [] },
    components: [],
    classWhitelist: [],
    pageSignals: { heroPreloaded: false, hiddenOverlays: 1 },
    stats: { blockedRequests: 0, stubbedRequests: 0, assetCount: 0, renderMs: 1, imagesDisabled: false },
    ...over,
  };
}

const consensus: ConsensusModel = {
  competitorCount: 8,
  lowConfidence: false,
  sectionSequence: [],
  entities: [
    { name: 'dishwasher safe', frequency: 6 },
    { name: 'microwave safe', frequency: 5 },
    { name: 'lead free glaze', frequency: 4 },
    { name: 'rare thing', frequency: 1 },
  ],
  schemaTypes: [],
  trustElements: [
    { kind: 'cod', frequency: 5 },
    { kind: 'upi', frequency: 6 },
    { kind: 'reviews', frequency: 7 },
  ],
  imageTypes: [],
  cta: { aboveFoldMobileShare: 0.75, stickyShare: 0.5 },
  medianWordCount: 400,
  medianImageCount: 6,
};

describe('schema audit', () => {
  it('flags a missing Product with evidence', () => {
    const r = auditProductSchema([{ '@type': 'Organization' }]);
    expect(r.hasProductSchema).toBe(false);
    const rule = r.rules.find((x) => x.id === 'schema.product.missing');
    expect(rule?.severity).toBe('critical');
    expect(rule?.evidence).toContain('Organization');
  });

  it('accepts a complete Product with Offer, Brand and BreadcrumbList', () => {
    const r = auditProductSchema([
      {
        '@type': 'Product',
        name: 'Mug',
        image: ['a.jpg'],
        description: 'd',
        sku: 's',
        brand: { '@type': 'Brand', name: 'B' },
        aggregateRating: { ratingValue: 4 },
        review: [{}],
        offers: { '@type': 'Offer', price: '10', priceCurrency: 'INR', availability: 'InStock' },
      },
      { '@type': 'BreadcrumbList' },
    ]);
    expect(r).toMatchObject({ hasProductSchema: true, hasOfferSchema: true, hasBrandSchema: true, hasBreadcrumbList: true });
    expect(r.rules).toEqual([]);
  });

  it('reports a missing price on the Offer', () => {
    const r = auditProductSchema([{ '@type': 'Product', name: 'M', image: 'i', offers: { priceCurrency: 'INR' } }]);
    expect(r.rules.map((x) => x.id)).toEqual(expect.arrayContaining(['schema.offer.price', 'schema.brand.missing']));
  });
});

describe('on-page audit', () => {
  it('passes a well-formed page apart from the preload', () => {
    const r = auditOnPage(extraction(), 'ceramic mug');
    expect(r.structure).toMatchObject({ hasTitle: true, isTitleLengthOptimal: true, hasSingleH1: true, hasH2H3Hierarchy: true, hasCanonical: true });
    expect(r.images).toMatchObject({ allHaveAltText: true, descriptiveFilenames: true, imageCount: 4, isHeroPreloaded: false });
  });

  it('reports title, H1, alt text and image count problems with evidence', () => {
    const r = auditOnPage(
      extraction({
        meta: { title: 'Mug', description: '' },
        headingTree: [],
        images: [{ src: 'https://cdn/123456.jpg', alt: '', role: 'hero' }],
      })
    );
    const ids = r.rules.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['onpage.title.length', 'onpage.meta.missing', 'onpage.h1.count', 'images.alt', 'images.count', 'onpage.canonical.missing']));
    expect(r.rules.every((x) => x.evidence.length > 0)).toBe(true);
  });
});

describe('PageSpeed parsing', () => {
  it('prefers field data and falls back to lab data', () => {
    const lab = { lighthouseResult: { audits: { 'largest-contentful-paint': { numericValue: 3200 }, 'cumulative-layout-shift': { numericValue: 0.04 } } } };
    expect(parsePsi(lab)).toEqual({ lcpSeconds: 3.2, inpMs: undefined, cls: 0.04, source: 'lab' });
    const field = {
      ...lab,
      loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100 }, INTERACTION_TO_NEXT_PAINT: { percentile: 180 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 } } },
    };
    expect(parsePsi(field)).toEqual({ lcpSeconds: 2.1, inpMs: 180, cls: 0.05, source: 'field' });
    expect(parsePsi({})).toBeNull();
  });
});

describe('entity and query guards', () => {
  it('uses 4 competitors as the consensus threshold, fewer when few were captured', () => {
    expect(consensusThreshold(10)).toBe(4);
    expect(consensusThreshold(5)).toBe(3);
    expect(consensusThreshold(2)).toBe(2);
  });
  it('accepts an entity claim only when its words appear on the page', () => {
    const text = 'Dishwasher safe stoneware, holds 350 ml';
    expect(entityAppearsInText('dishwasher safe', text)).toBe(true);
    expect(entityAppearsInText('lead free glaze', text)).toBe(false);
  });
  it('accepts a query answer only when the quoted evidence is on the page', () => {
    const text = 'This mug is dishwasher safe and microwave safe.';
    expect(quoteAppearsInText('dishwasher safe and microwave safe', text)).toBe(true);
    expect(quoteAppearsInText('freezer safe for months', text)).toBe(false);
    expect(quoteAppearsInText('', text)).toBe(false);
  });
});

describe('conversion signals and scoring', () => {
  it('derives conversion inputs from measured facts', () => {
    const input = buildConversionInput(extraction(), { cwv: null, trust: null });
    expect(input.atc).toMatchObject({ isAboveFoldMobile: false, hasStickyAtc: false });
    expect(input.reassurance).toMatchObject({ hasCodAndUpi: false, hasReturnsSummaryNearCta: true });
    expect(input.pricing).toMatchObject({ hasMrp: true, hasSellingPrice: true, hasDiscountBadge: true });
    expect(input.usability).toMatchObject({ tapTargets48pxPlus: false, noIntrusiveInterstitials: false, readableFontSizes: true });
  });

  it('averages two runs only when they differ by more than 10 points', () => {
    const base = buildConversionInput(extraction(), { cwv: null, trust: null });
    const better = { ...base, atc: { isAboveFoldMobile: true, hasStickyAtc: true, hasClearVariantSelection: true }, reassurance: { hasDeliveryEstimateOrPincode: true, hasCodAndUpi: true, hasReturnsSummaryNearCta: true } };
    const close = combineConversionRuns([base, base]);
    expect(close.averaged).toBe(false);
    const far = combineConversionRuns([base, better]);
    expect(far.averaged).toBe(true);
    expect(far.score).toBeCloseTo((far.runs[0]! + far.runs[1]!) / 2, 1);
  });
});

describe('findings', () => {
  it('gives every finding evidence and a valid shape, with competitor counts', () => {
    const findings = buildFindings({
      auditId: 'a',
      extraction: extraction(),
      consensus,
      schema: auditProductSchema([]),
      onPage: auditOnPage(extraction()),
      cwv: { lcpSeconds: 4.1, cls: 0.2, source: 'lab' },
      gap: {
        consensusEntities: consensus.entities.slice(0, 3),
        found: ['dishwasher safe'],
        missing: [consensus.entities[1]!, consensus.entities[2]!],
        querySequence: [
          { query: 'is it microwave safe', order: 1, answered: false, evidence: '', source: 'paa' },
          { query: 'how big is it', order: 2, answered: true, evidence: 'holds 350 ml', source: 'generated' },
        ],
      },
      visualFindings: [{ title: 'Trust badges are hidden', severity: 'medium', evidence: 'No badges visible near the button', viewport: 'mobile', region: { x: 0, y: 0.5, width: 1, height: 0.1 } }],
    });
    for (const f of findings) {
      expect(AuditFindingSchema.safeParse(f).success).toBe(true);
      expect(f.evidence && f.evidence.length > 0).toBe(true);
    }
    const byTitle = (t: RegExp) => findings.find((f) => t.test(f.title));
    expect(byTitle(/cash on delivery/i)).toBeUndefined();
    expect(byTitle(/UPI/)?.evidence).toContain('6 of 8 competitors');
    expect(byTitle(/below the fold/)?.tag).toBe('Conversion');
    expect(byTitle(/Core Web Vitals/)?.tag).toBe('Both');
    expect(byTitle(/does not mention 2 attributes/)?.competitorCount).toBe(5);
    expect(byTitle(/Trust badges/)?.region?.viewport).toBe('mobile');
    expect(new Set(findings.map((f) => f.findingId)).size).toBe(findings.length);
  });
});

describe('taxonomy and screenshots', () => {
  const taxonomy = parseTaxonomy('# header\n1 - Home & Garden\n2 - Home & Garden > Kitchen & Dining\n3 - Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs');
  it('matches exact and closest categories', () => {
    expect(closestCategory('home & garden > kitchen & dining', taxonomy)).toEqual({ path: 'Home & Garden > Kitchen & Dining', exact: true });
    expect(closestCategory('Kitchen mugs and drinkware', taxonomy)?.path).toContain('Mugs');
    expect(closestCategory('zzz', taxonomy)).toBeNull();
    expect(closestCategory('x', [])).toBeNull();
  });
  it('crops and shrinks screenshots', () => {
    const src = new PNG({ width: 800, height: 3000 });
    const out = PNG.sync.read(prepareScreenshot(PNG.sync.write(src), 400, 1000));
    expect(out.width).toBe(400);
    expect(out.height).toBe(500);
  });
});

describe('runAnalysisStage', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-analysis-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes findings, queries and baseline scores, and degrades when the visual audit fails', async () => {
    const store = new FileAuditStore(path.join(dir, 'audits'));
    const storage = new LocalDiskStorage(path.join(dir, 'artifacts'));
    const now = new Date().toISOString();
    const audit: AuditRecord = {
      auditId: 'an1',
      wsId: 'default',
      userId: 'u',
      targetUrl: 'https://shop.example.org/p/x',
      keywordCandidates: [],
      imageConsent: false,
      status: 'competitors',
      stage: 'x',
      progressPercent: 50,
      platform: 'shopify',
      patchMode: 'static',
      stageTimings: {},
      createdAt: now,
      updatedAt: now,
      totalCostInr: 0,
    };
    await store.createAudit(audit);
    const spend = new SpendTracker(25);
    const result = await runAnalysisStage(
      {
        store,
        storage,
        spend,
        logger: silentLog,
        visualEnabled: true,
        fetchCwv: async () => ({ lcpSeconds: 2.0, cls: 0.02, source: 'lab' }),
        gap: async () => ({
          consensusEntities: consensus.entities.slice(0, 3),
          found: ['dishwasher safe', 'microwave safe'],
          missing: [consensus.entities[2]!],
          querySequence: [{ query: 'is it microwave safe', order: 1, answered: true, evidence: 'microwave', source: 'paa' }],
        }),
        trust: async () => ({ toneAndTrustScore: 3, toneNotes: 'clear', currentCategory: 'Mugs', recommendedCategory: 'Home & Garden > Kitchen & Dining', recommendedValidated: true, reason: 'r' }),
        visual: async () => {
          throw new Error('model unavailable');
        },
      },
      audit,
      extraction(),
      { consensus, keyword: 'ceramic mug', queries: [], competitorIds: [] }
    );
    const saved = await store.getAudit('an1');
    expect(saved?.status).toBe('analysed');
    expect(saved?.scores?.baseline?.visibility.current).toBe(result.scoreCard.visibility.current);
    expect(result.scoreCard.ppi.current).toBeCloseTo((result.scoreCard.visibility.current * result.scoreCard.conversion.current) / 100, 1);
    expect(result.visualRuns).toBe(0);
    expect((await store.getFindings('an1')).length).toBe(result.findings.length);
    expect((await store.getQueries('an1'))[0]?.answered).toBe(true);
    expect(await storage.exists(analysisKey('an1'))).toBe(true);
  });

  it('is deterministic for the same inputs when no model judgement changes', async () => {
    const run = async (id: string) => {
      const store = new FileAuditStore(path.join(dir, `audits-${id}`));
      const storage = new LocalDiskStorage(path.join(dir, `artifacts-${id}`));
      const now = new Date().toISOString();
      const audit = { auditId: id, wsId: 'default', userId: 'u', targetUrl: 'https://shop.example.org/p/x', keywordCandidates: [], imageConsent: false, status: 'competitors', stage: 'x', progressPercent: 50, platform: 'shopify', patchMode: 'static', stageTimings: {}, createdAt: now, updatedAt: now, totalCostInr: 0 } as AuditRecord;
      await store.createAudit(audit);
      return runAnalysisStage(
        {
          store,
          storage,
          spend: new SpendTracker(25),
          logger: silentLog,
          visualEnabled: false,
          fetchCwv: async () => null,
          gap: async () => ({ consensusEntities: [], found: [], missing: [], querySequence: [] }),
          trust: async () => null as never,
        },
        audit,
        extraction(),
        { consensus, keyword: 'k', queries: [], competitorIds: [] }
      );
    };
    const [a, b] = await Promise.all([run('d1'), run('d2')]);
    expect(a.scoreCard.visibility.current).toBe(b.scoreCard.visibility.current);
    expect(a.scoreCard.conversion.current).toBe(b.scoreCard.conversion.current);
    expect(a.findings.map((f) => f.title)).toEqual(b.findings.map((f) => f.title));
  });
});

import { entitiesPresent, questionAnswered } from '../src/analysis/entity-gap.js';

describe('deterministic answer and entity checks', () => {
  const text =
    'This ceramic mug is dishwasher safe and microwave safe for daily use. It holds 350 ml of coffee. Care: hand wash recommended for the glaze.';
  it('counts a question as answered only when one passage covers its words', () => {
    expect(questionAnswered('Is the ceramic mug dishwasher safe?', text)).toBe(true);
    expect(questionAnswered('How much coffee does the mug hold?', text)).toBe(true);
    expect(questionAnswered('Does the mug come with a lid and saucer?', text)).toBe(false);
  });
  it('ignores placeholder answers', () => {
    expect(questionAnswered('Is the mug freezer safe for storage?', 'Is the mug freezer safe for storage? The seller will confirm this detail soon for you.')).toBe(false);
  });
  it('finds consensus entities by word match', () => {
    expect(entitiesPresent([{ name: 'dishwasher safe' }, { name: 'lead free glaze' }], text)).toEqual(['dishwasher safe']);
  });
});
