import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { FileAuditStore } from '@rankforge/audit-store';
import type { AuditRecord, Blueprint, ConsensusModel } from '@rankforge/schema';
import { LocalDiskStorage } from '@rankforge/storage';
import { SpendTracker } from '../src/ai/gemini.js';
import { buildConversionInput, buildVisibilityInput } from '../src/analysis/signals.js';
import { auditOnPage } from '../src/analysis/onpage-audit.js';
import { auditProductSchema } from '../src/analysis/schema-audit.js';
import { captureTarget, closeBrowser } from '../src/capture/capture.js';
import { silentLog } from '../src/lib/log.js';
import { analysisKey, composeScoreCard } from '../src/stages/analysis-stage.js';
import { consensusKey } from '../src/stages/competitors-stage.js';
import { runRebuildStage } from '../src/stages/rebuild-stage.js';
import { runVerifyStage } from '../src/stages/verify-stage.js';
import { allowLoopbackPolicy, startFixtureServer, type FixtureServer } from './helpers/fixture-server.js';

const chromiumOk = await chromium
  .launch()
  .then((b) => b.close().then(() => true))
  .catch(() => false);

const consensus: ConsensusModel = {
  competitorCount: 8,
  lowConfidence: false,
  sectionSequence: [],
  entities: [{ name: 'dishwasher safe', frequency: 6 }, { name: 'microwave safe', frequency: 5 }],
  schemaTypes: [],
  trustElements: [{ kind: 'cod', frequency: 5 }, { kind: 'upi', frequency: 6 }, { kind: 'reviews', frequency: 7 }],
  imageTypes: [],
  cta: { aboveFoldMobileShare: 0.7, stickyShare: 0.5 },
  medianWordCount: 300,
  medianImageCount: 5,
};

const section = (sectionId: string, type: Blueprint['sections'][number]['type'], selector: string, sample = true): Blueprint['sections'][number] => ({
  sectionId,
  order: 1,
  type,
  name: type,
  h2: type,
  h3s: [],
  depth: 'short',
  contentType: 'cards',
  tag: 'Conversion',
  sample,
  justifications: [{ kind: 'playbook_rule', ref: 'r', note: 'because' }],
  anchor: { selector, position: 'insertAfter' },
});

(chromiumOk ? describe : describe.skip)('capture, rebuild and verify together (real Chromium)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-e2e-'));
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer();
  }, 30_000);
  afterAll(async () => {
    await closeBrowser();
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rebuilds the page, drops a section that breaks the layout, and measures a gain', async () => {
    const store = new FileAuditStore(path.join(dir, 'audits'));
    const storage = new LocalDiskStorage(path.join(dir, 'artifacts'));
    const auditId = 'e2e1';
    const { extraction: target } = await captureTarget({
      auditId,
      url: `${server.origin}/products/blue-mug`,
      storage,
      urlPolicy: allowLoopbackPolicy,
      logger: silentLog,
      fetchProductData: false,
    });
    const now = new Date().toISOString();
    const audit: AuditRecord = { auditId, wsId: 'default', userId: 'u', targetUrl: target.sourceUrl, keyword: 'ceramic mug', keywordCandidates: [], imageConsent: false, status: 'blueprinted', stage: 'x', progressPercent: 80, platform: 'shopify', patchMode: 'static', stageTimings: {}, createdAt: now, updatedAt: now, totalCostInr: 0 };
    await store.createAudit(audit);

    // Baseline analysis, built with the same functions the real analysis stage uses.
    const gap = {
      consensusEntities: consensus.entities,
      found: [],
      missing: consensus.entities,
      querySequence: [{ query: 'Is the mug dishwasher safe for daily use?', order: 1, answered: false, evidence: '', source: 'paa' as const }],
    };
    const visIn = buildVisibilityInput({ schema: auditProductSchema(target.jsonLd), onPage: auditOnPage(target, 'ceramic mug'), cwv: null, gap, trust: null });
    const convIn = [buildConversionInput(target, { cwv: null, trust: null })];
    const { scoreCard } = composeScoreCard(visIn, convIn, false);
    await storage.put(analysisKey(auditId), JSON.stringify({ cwv: null, gap, trust: null, visual: [], scoreCard }), 'application/json');
    await storage.put(consensusKey(auditId), JSON.stringify(consensus), 'application/json');

    const blueprint: Blueprint = {
      auditId,
      keyword: 'ceramic mug',
      deterministicFixes: ['meta_description', 'product_schema'],
      generatedBy: 'fallback',
      decisionLog: [],
      sections: [
        section('sec_01_faq', 'faq', '#add-to-cart'),
        section('sec_02_trust_row', 'trust_row', 'footer'),
        section('sec_03_sticky_cta', 'sticky_cta', 'footer', false),
      ],
    };
    await store.saveBlueprint(auditId, blueprint.sections.map((s) => ({ sectionId: s.sectionId, auditId, order: s.order, name: s.name, strategy: '', action: '', status: 'pending' as const, spec: s })));

    const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const rebuild = await runRebuildStage(
      {
        store,
        storage,
        spend: new SpendTracker(25),
        logger: silentLog,
        write: async (spec, ex) => {
          if (spec.type === 'faq') {
            return `<section class="rf-section rf-faq"><h2>FAQ <span class="rf-sample-chip">Sample</span></h2><details data-sample="true"><summary>Is the mug dishwasher safe for daily use?</summary><p>The ${ex.content.h1} is dishwasher safe for daily use and also microwave safe, so it fits easily into a busy kitchen routine.</p></details></section>`;
          }
          if (spec.type === 'trust_row') {
            // A section that makes the page scroll sideways: verification must drop it.
            return `<section class="rf-section"><h2>Trust</h2><img src="${tiny}" width="4000" height="10" alt="wide"></section>`;
          }
          return `<div class="rf-sticky"><button type="button" data-rf-click="#add-to-cart">Add to cart</button></div>`;
        },
      },
      audit,
      target,
      blueprint
    );
    expect(rebuild.applied.some((o) => o.sectionId === 'sec_01_faq')).toBe(true);

    const result = await runVerifyStage({ store, storage, logger: silentLog }, audit, target, rebuild, blueprint);

    const verdicts = Object.fromEntries(result.report.sections.map((s) => [s.sectionId, s]));
    expect(verdicts['sec_01_faq']?.ok).toBe(true);
    expect(verdicts['sec_02_trust_row']?.ok).toBe(false);
    expect(verdicts['sec_02_trust_row']?.reason).toMatch(/sideways|pixels above/);
    expect(result.droppedSections.map((d) => d.sectionId)).toContain('sec_02_trust_row');

    const html = (await storage.get(`${auditId}/optimised/index.html`))?.body.toString('utf8') ?? '';
    expect(html).toContain('data-rf-section="sec_01_faq"');
    expect(html).not.toContain('data-rf-section="sec_02_trust_row"');
    expect(html).toContain('application/ld+json');

    const saved = await store.getAudit(auditId);
    expect(saved?.status).toBe('complete');
    const after = saved?.scores?.optimized;
    expect(after).toBeDefined();
    expect(after!.ppi.current).toBeGreaterThan(scoreCard.ppi.current);
    expect(after!.visibility.current).toBeGreaterThan(scoreCard.visibility.current);
    expect(after!.visibility.baseline).toBe(scoreCard.visibility.current);
    // The gain without invented (Sample) content is never larger than the gain with it.
    expect(result.scoreCardExcludingSample.ppi.current).toBeLessThanOrEqual(after!.ppi.current);
    expect(after!.attributions.length).toBeGreaterThan(0);
    expect(after!.attributions.every((a) => a.delta > 0)).toBe(true);
    const patches = await store.getPatches(auditId);
    expect(patches.find((p) => p.sectionId === 'sec_02_trust_row')?.status).toBe('failed');
    expect(await storage.exists(`${auditId}/report.json`)).toBe(true);
  }, 120_000);
});
