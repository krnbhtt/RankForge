import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { chromium } from 'playwright';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileAuditStore } from '@rankforge/audit-store';
import { PatchOpSchema, type AuditRecord, type Blueprint, type Extraction, type PatchOp } from '@rankforge/schema';
import { LocalDiskStorage } from '@rankforge/storage';
import { SpendTracker } from '../src/ai/gemini.js';
import { applyPatchOps, applyRuntimeMode } from '../src/rebuild/applier.js';
import { buildDeterministicOps, buildMetaDescription, buildStructuredData, buildTitle } from '../src/rebuild/deterministic.js';
import { sanitizeAndValidateSection } from '../src/rebuild/sanitize.js';
import { silentLog } from '../src/lib/log.js';
import { runRebuildStage, optimisedKey } from '../src/stages/rebuild-stage.js';

const HTML = `<!doctype html><html><head><title>Mug</title><script type="application/ld+json">{"@type":"Product","name":"old"}</script></head>
<body><main><h1>Blue Ceramic Mug</h1><div id="price">₹1,499</div><button id="atc">Add to cart</button>
<img src="a.jpg"><img src="b.jpg" alt=""><img src="c.jpg" alt="ok"></main><footer>f</footer></body></html>`;

const op = (over: Partial<PatchOp>): PatchOp => ({
  op: 'insertAfter',
  target: '#atc',
  html: '<section class="rf-section"><h2>New</h2></section>',
  tag: 'Conversion',
  reason: 'because',
  sample: false,
  sectionId: 'sec_01',
  ...over,
});

describe('applyPatchOps (server mode)', () => {
  it('inserts annotated sections after and before targets', () => {
    const r = applyPatchOps(HTML, [op({}), op({ op: 'insertBefore', target: 'footer', sectionId: 'sec_02', sample: true, tag: 'Both' })]);
    expect(r.failed).toEqual([]);
    expect(r.html).toMatch(/<button id="atc">Add to cart<\/button><section[^>]*data-rf-section="sec_01"/);
    expect(r.html).toMatch(/data-rf-sample="true"[^>]*>.*<\/section><footer>/s);
    expect(r.html).toContain('data-rf-tag="Both"');
  });

  it('sets text, attributes (with an index placeholder), head meta, JSON-LD, move and remove', () => {
    const r = applyPatchOps(HTML, [
      op({ op: 'setText', target: '#price', html: '₹1,299 <b>', sectionId: 's1' }),
      op({ op: 'setAttr', target: 'img:not([alt]), img[alt=""]', attr: { name: 'alt', value: 'Mug - image {n}' }, all: true, sectionId: 's2' }),
      op({ op: 'setHeadMeta', target: 'title', html: 'A better title for the blue ceramic mug', sectionId: 's3' }),
      op({ op: 'setHeadMeta', target: 'meta[name="description"]', html: 'Fresh description', sectionId: 's3' }),
      op({ op: 'injectJsonLd', target: 'head', html: '{"@type":"Product","name":"new"}', replaceType: 'Product', sectionId: 's4' }),
      op({ op: 'move', target: '#price', to: '#atc', sectionId: 's5' }),
      op({ op: 'remove', target: 'footer', sectionId: 's6' }),
    ]);
    expect(r.failed).toEqual([]);
    expect(r.html).toContain('₹1,299 &lt;b&gt;');
    expect(r.html).toContain('alt="Mug - image 1"');
    expect(r.html).toContain('alt="Mug - image 2"');
    expect(r.html).toContain('<title>A better title for the blue ceramic mug</title>');
    expect(r.html).toContain('<meta name="description" content="Fresh description">');
    expect(r.html).not.toContain('"name":"old"');
    expect(r.html).toContain('"name":"new"');
    expect(r.html).not.toContain('<footer>');
    expect(r.html.indexOf('id="atc"')).toBeLessThan(r.html.indexOf('id="price"'));
  });

  it('reports a missing or invalid target as a failure and keeps going', () => {
    const r = applyPatchOps(HTML, [op({ target: '#nope', sectionId: 'a' }), op({ target: '##bad[', sectionId: 'b' }), op({ sectionId: 'c' })]);
    expect(r.failed.map((f) => f.op.sectionId)).toEqual(['a', 'b']);
    expect(r.failed[0]?.reason).toMatch(/matched nothing/);
    expect(r.applied.map((o) => o.sectionId)).toEqual(['c']);
  });

  it('rejects malformed JSON-LD instead of injecting it', () => {
    const r = applyPatchOps(HTML, [op({ op: 'injectJsonLd', target: 'head', html: '{nope' })]);
    expect(r.failed).toHaveLength(1);
  });

  it('patch operations validate against the schema', () => {
    expect(PatchOpSchema.safeParse(op({})).success).toBe(true);
    expect(PatchOpSchema.safeParse({ ...op({}), op: 'eval' }).success).toBe(false);
  });
});

const chromiumOk = await chromium
  .launch()
  .then((b) => b.close().then(() => true))
  .catch(() => false);

(chromiumOk ? describe : describe.skip)('runtime patch mode (real browser)', () => {
  it('re-applies patches after the page wipes and rebuilds its DOM (hydration)', async () => {
    const page = `<!doctype html><html><head><title>t</title></head><body><div id="app"><h1>Hello</h1><button id="atc">Buy</button></div>
<script>setTimeout(function(){document.getElementById('app').innerHTML='<h1>Hydrated</h1><button id="atc">Buy</button>'},250)</script></body></html>`;
    const html = applyRuntimeMode(page, [op({ op: 'insertAfter', target: '#atc', html: '<section class="rf-section">Injected</section>', sectionId: 'rt' })]);
    const browser = await chromium.launch();
    try {
      const p = await browser.newPage();
      await p.setContent(html, { waitUntil: 'load' });
      await p.waitForTimeout(900);
      expect(await p.textContent('h1')).toBe('Hydrated');
      expect(await p.locator('[data-rf-section="rt"]').count()).toBe(1);
      expect(await p.locator('[data-rf-section="rt"]').textContent()).toBe('Injected');
    } finally {
      await browser.close();
    }
  }, 30_000);

  it('does not loop forever when patches are already in place', async () => {
    const html = applyRuntimeMode('<html><body><p id="t">x</p></body></html>', [op({ op: 'setText', target: '#t', html: 'changed' })]);
    const browser = await chromium.launch();
    try {
      const p = await browser.newPage();
      await p.setContent(html, { waitUntil: 'load' });
      await p.waitForTimeout(500);
      const alive = await Promise.race([p.evaluate('1+1').then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]);
      expect(alive).toBe(true);
      expect(await p.textContent('#t')).toBe('changed');
    } finally {
      await browser.close();
    }
  }, 30_000);
});

describe('sanitizeAndValidateSection', () => {
  it('strips executable markup', () => {
    const r = sanitizeAndValidateSection(
      '<section class="rf-section"><h2 onclick="x()">T</h2><script>alert(1)</script><a href="javascript:alert(1)">l</a><iframe src="//e"></iframe><style>*{}</style><form><input></form></section>',
      []
    );
    expect(r.html).not.toMatch(/script|onclick|javascript:|iframe|<style|<form/i);
    expect(r.strippedUnsafe).toBeGreaterThanOrEqual(5);
  });

  it('removes classes outside the whitelist but keeps rf- classes', () => {
    const r = sanitizeAndValidateSection('<div class="rf-card product__description evil"><p class="btn">x</p></div>', ['product__description', 'btn']);
    expect(r.html).toContain('class="rf-card product__description"');
    expect(r.removedClasses).toEqual(['evil']);
    expect(r.usedScopedStyle).toBe(false);
  });

  it('falls back to a scoped wrapper when most classes are unusable', () => {
    const r = sanitizeAndValidateSection('<div class="a b c d"><p class="e f">x</p></div>', ['a']);
    expect(r.usedScopedStyle).toBe(true);
    expect(r.html).toContain('class="rf-scoped"');
  });

  it('keeps data:image sources but drops other data URLs', () => {
    const r = sanitizeAndValidateSection('<img src="data:image/png;base64,AAA"><a href="data:text/html,x">x</a>', []);
    expect(r.html).toContain('data:image/png');
    expect(r.html).not.toContain('data:text/html');
  });
});

function extraction(over: Partial<Extraction> = {}): Extraction {
  return {
    version: 1,
    auditId: 'a',
    sourceUrl: 'https://shop.example.org/products/mug',
    finalUrl: 'https://shop.example.org/products/mug',
    capturedAt: '2026-11-20T00:00:00.000Z',
    source: 'live',
    platform: {
      type: 'shopify',
      confidence: 0.9,
      signals: [],
      productData: { source: 'shopify_json', title: 'Blue Ceramic Mug', vendor: 'Kiln Co', tags: [], descriptionHtml: '<p>Hand glazed stoneware mug that holds 350 ml and is dishwasher safe for everyday coffee and tea.</p>', images: [], variants: [{ id: '1', title: 'S', price: '1499.00', sku: 'MUG-1', available: true }], options: [] },
    },
    hydration: { mode: 'server', framework: 'none', signals: [], sentinelSurvived: true },
    meta: { title: 'Mug', description: '' },
    content: { h1: 'Blue Ceramic Mug', text: 'Hand glazed stoneware.', wordCount: 3 },
    headingTree: [],
    jsonLd: [],
    images: [{ src: 'https://cdn.example.org/a.jpg', alt: '', role: 'hero' }],
    price: { raw: '₹1,499', selling: 1499, currency: 'INR' },
    variants: [],
    reviews: { items: [] },
    ctaPositions: [{ text: 'Add to cart', selector: '#atc', viewport: 'mobile', top: 1400, aboveFold: false, sticky: false }],
    designTokens: { fontFamilies: [], baseFontSizePx: 16, colors: [], borderRadiiPx: [] },
    components: [],
    classWhitelist: [],
    stats: { blockedRequests: 0, stubbedRequests: 0, assetCount: 0, renderMs: 1, imagesDisabled: false },
    ...over,
  };
}

describe('deterministic fixes', () => {
  it('builds a title of 30 to 60 characters and a meta description of 70 to 160', () => {
    const t = buildTitle(extraction());
    expect(t.length).toBeGreaterThanOrEqual(30);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).toContain('Blue Ceramic Mug');
    const d = buildMetaDescription(extraction());
    expect(d.length).toBeGreaterThanOrEqual(70);
    expect(d.length).toBeLessThanOrEqual(160);
  });

  it('builds Product structured data only from captured facts and never invents ratings', () => {
    const [product] = buildStructuredData(extraction(), []);
    expect(product).toMatchObject({ '@type': 'Product', name: 'Blue Ceramic Mug', sku: 'MUG-1', brand: { name: 'Kiln Co' } });
    expect((product as { offers: Record<string, unknown> }).offers).toMatchObject({ price: '1499', priceCurrency: 'INR', availability: 'https://schema.org/InStock' });
    expect(product).not.toHaveProperty('aggregateRating');
    const rated = buildStructuredData(extraction({ reviews: { ratingValue: 4.4, reviewCount: 12, items: [] } }), [])[0];
    expect(rated).toHaveProperty('aggregateRating');
  });

  it('turns blueprint fixes into valid operations', () => {
    const bp = { auditId: 'a', keyword: 'k', sections: [], decisionLog: [], deterministicFixes: ['title', 'meta_description', 'image_alt', 'product_schema'], generatedBy: 'fallback' } as Blueprint;
    const ops = buildDeterministicOps(bp, extraction(), HTML);
    expect(ops.map((o) => o.op)).toEqual(['setHeadMeta', 'setHeadMeta', 'setAttr', 'injectJsonLd']);
    expect(ops.every((o) => PatchOpSchema.safeParse(o).success)).toBe(true);
    expect(ops.every((o) => o.sample === false)).toBe(true);
  });
});

describe('runRebuildStage', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-rebuild-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const blueprint = (): Blueprint => ({
    auditId: 'rb1',
    keyword: 'mug',
    deterministicFixes: ['title'],
    generatedBy: 'fallback',
    decisionLog: [],
    sections: [
      { sectionId: 'sec_01_faq', order: 1, type: 'faq', name: 'FAQ', h2: 'FAQ', h3s: [], depth: 'short', contentType: 'accordion', tag: 'Both', sample: true, justifications: [{ kind: 'playbook_rule', ref: 'pdp.faq', note: 'n' }], anchor: { selector: '#atc', position: 'insertAfter' } },
      { sectionId: 'sec_02_trust_row', order: 2, type: 'trust_row', name: 'Trust', h2: 'Trust', h3s: [], depth: 'short', contentType: 'cards', tag: 'Conversion', sample: true, justifications: [{ kind: 'playbook_rule', ref: 'pdp.trust-badges', note: 'n' }], anchor: { selector: '#missing', position: 'insertAfter' } },
      { sectionId: 'sec_03_sample_reviews', order: 3, type: 'sample_reviews', name: 'Reviews', h2: 'Reviews', h3s: [], depth: 'short', contentType: 'cards', tag: 'Conversion', sample: true, justifications: [{ kind: 'playbook_rule', ref: 'pdp.reviews', note: 'n' }], anchor: { selector: 'footer', position: 'insertBefore' } },
    ],
  });

  it('applies sections progressively, drops failures with reasons and keeps going', async () => {
    const store = new FileAuditStore(path.join(dir, 'audits'));
    const storage = new LocalDiskStorage(path.join(dir, 'artifacts'));
    const now = new Date().toISOString();
    const audit: AuditRecord = { auditId: 'rb1', wsId: 'default', userId: 'u', targetUrl: 'https://shop.example.org/products/mug', keywordCandidates: [], imageConsent: false, status: 'blueprinted', stage: 'x', progressPercent: 80, platform: 'shopify', patchMode: 'static', stageTimings: {}, createdAt: now, updatedAt: now, totalCostInr: 0 };
    await store.createAudit(audit);
    const bp = blueprint();
    await store.saveBlueprint('rb1', bp.sections.map((s) => ({ sectionId: s.sectionId, auditId: 'rb1', order: s.order, name: s.name, strategy: '', action: '', status: 'pending' as const, spec: s })));
    await storage.put('rb1/target/index.html', HTML, 'text/html');

    const seenWrites: string[] = [];
    const result = await runRebuildStage(
      {
        store,
        storage,
        spend: new SpendTracker(25),
        logger: silentLog,
        write: async (spec) => {
          seenWrites.push(spec.sectionId);
          if (spec.sectionId === 'sec_03_sample_reviews') throw new Error('model unavailable');
          return `<section class="rf-section evil"><h2>${spec.h2} <span class="rf-sample-chip">Sample</span></h2><script>x()</script></section>`;
        },
      },
      audit,
      extraction(),
      bp
    );

    expect(seenWrites).toEqual(['sec_01_faq', 'sec_02_trust_row', 'sec_03_sample_reviews']);
    expect(result.dropped.map((d) => d.sectionId)).toEqual(['sec_02_trust_row', 'sec_03_sample_reviews']);
    expect(result.dropped[0]?.reason).toMatch(/matched nothing/);
    expect(result.dropped[1]?.reason).toMatch(/Writing failed/);

    const html = (await storage.get(optimisedKey('rb1')))?.body.toString('utf8') ?? '';
    expect(html).toContain('data-rf-section="sec_01_faq"');
    expect(html).not.toContain('<script>x()</script>');
    expect(html).not.toContain('evil');
    expect(html).toContain('data-rf-helper');
    expect(html).toContain('<style data-rf>');

    const patches = await store.getPatches('rb1');
    expect(patches.find((p) => p.sectionId === 'sec_01_faq')?.status).toBe('applied');
    expect(patches.find((p) => p.sectionId === 'sec_02_trust_row')?.status).toBe('failed');
    expect(patches.find((p) => p.sectionId === 'sec_02_trust_row')?.failureReason).toMatch(/matched nothing/);
    const sections = await store.getBlueprint('rb1');
    expect(sections.find((s) => s.sectionId === 'sec_01_faq')?.status).toBe('completed');
  });
});
