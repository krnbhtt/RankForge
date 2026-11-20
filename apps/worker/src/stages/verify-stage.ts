import * as cheerio from 'cheerio';
import type { IAuditStore } from '@rankforge/audit-store';
import {
  ConsensusModelSchema,
  type AuditPatch,
  type AuditRecord,
  type Blueprint,
  type Extraction,
  type PatchOp,
  type ScoreAttribution,
  type ScoreCard,
} from '@rankforge/schema';
import type { ArtifactStorage } from '@rankforge/storage';
import type { Browser } from 'playwright';
import { auditOnPage } from '../analysis/onpage-audit.js';
import { entitiesPresent, questionAnswered, type EntityGapResult } from '../analysis/entity-gap.js';
import { auditProductSchema } from '../analysis/schema-audit.js';
import { buildConversionInput, buildVisibilityInput } from '../analysis/signals.js';
import type { TrustCategoryResult } from '../analysis/trust-category.js';
import type { VisualRubric } from '../analysis/visual-cro.js';
import type { CoreWebVitals } from '../analysis/psi.js';
import { getBrowser } from '../capture/capture.js';
import { buildExtraction, collectLayout } from '../extract/index.js';
import { log as defaultLog, type Logger } from '../lib/log.js';
import { openOffline, verifyOptimised, type VerifyReport } from '../rebuild/verify.js';
import { analysisKey, composeScoreCard } from './analysis-stage.js';
import { consensusKey } from './competitors-stage.js';
import { optimisedKey, renderOptimised, type RebuildResult } from './rebuild-stage.js';

export const reportKey = (auditId: string) => `${auditId}/report.json`;

export interface VerifyStageDeps {
  store: IAuditStore;
  storage: ArtifactStorage;
  logger?: Logger;
  browser?: Browser;
}

interface SavedAnalysis {
  cwv: CoreWebVitals | null;
  gap: EntityGapResult;
  trust: TrustCategoryResult | null;
  visual: { rubric: VisualRubric }[];
  scoreCard: ScoreCard;
}

/** Which blueprint section types and fixes contribute to each score component (for evidence attributions). */
const COMPONENT_SOURCES: Record<string, { category: 'visibility' | 'conversion'; name: string; sections: string[] }> = {
  product_schema: { category: 'visibility', name: 'Complete Product structured data', sections: ['fix_schema'] },
  entity_coverage: { category: 'visibility', name: 'Attributes competitors cover', sections: ['spec_table', 'faq'] },
  query_sequence_coverage: { category: 'visibility', name: 'Shopper questions answered', sections: ['faq'] },
  on_page_structure: { category: 'visibility', name: 'Title and meta description', sections: ['fix_head'] },
  image_seo: { category: 'visibility', name: 'Image alt text', sections: ['fix_images'] },
  add_to_cart: { category: 'conversion', name: 'Sticky buy bar', sections: ['sticky_cta'] },
  delivery_payment_returns: { category: 'conversion', name: 'Delivery, payment and returns', sections: ['delivery_payment'] },
  trust_and_proof: { category: 'conversion', name: 'Reviews and trust marks', sections: ['trust_row', 'sample_reviews'] },
  price_and_offer_clarity: { category: 'conversion', name: 'Price note', sections: ['price_clarity'] },
};

export function buildAttributions(before: ScoreCard, after: ScoreCard, appliedSectionIds: string[], sampleSectionIds: Set<string>): ScoreAttribution[] {
  const out: ScoreAttribution[] = [];
  const typeOf = (id: string) => (id.startsWith('fix_') ? id : id.replace(/^sec_\d+_/, ''));
  const applied = appliedSectionIds.map(typeOf);
  for (const [key, meta] of Object.entries(COMPONENT_SOURCES)) {
    const group = meta.category === 'visibility' ? 'visibility' : 'conversion';
    const b = (before[group].breakdown as Record<string, number>)[key] ?? 0;
    const a = (after[group].breakdown as Record<string, number>)[key] ?? 0;
    const delta = Math.round((a - b) * 10) / 10;
    if (delta <= 0) continue;
    const contributing = meta.sections.filter((s) => applied.includes(s));
    out.push({
      ruleId: key,
      ruleName: meta.name,
      category: meta.category,
      delta,
      reason:
        contributing.length > 0
          ? `Added by ${contributing.map((c) => c.replace(/_/g, ' ')).join(' and ')}.`
          : 'Improved by the rebuilt page.',
      isSample: appliedSectionIds.some((id) => meta.sections.includes(typeOf(id)) && sampleSectionIds.has(id)),
    });
  }
  return out;
}

async function extractAfter(browser: Browser, storage: ArtifactStorage, auditId: string, html: string, target: Extraction): Promise<Extraction> {
  const desktop = await openOffline(browser, storage, auditId, html);
  const desktopLayout = await collectLayout(desktop.page);
  const content = await desktop.page.content();
  await desktop.close();
  const mobile = await openOffline(browser, storage, auditId, html, { width: 390, height: 844 }, true);
  const mobileLayout = await collectLayout(mobile.page);
  await mobile.close();
  return buildExtraction({
    auditId,
    sourceUrl: target.sourceUrl,
    finalUrl: target.finalUrl,
    html: content,
    source: 'live',
    platform: target.platform,
    hydration: target.hydration,
    cssTexts: [],
    mobile: mobileLayout,
    desktop: desktopLayout,
    stats: target.stats,
    // Pop-ups and speed belong to the merchant's live store, which this demonstration does not change.
    pageSignals: target.pageSignals,
  });
}

function scoreAfter(extraction: Extraction, base: SavedAnalysis, keyword: string, before: ScoreCard, attributions: ScoreAttribution[] = []): ScoreCard {
  const text = `${extraction.meta.title}\n${extraction.content.h1}\n${extraction.content.text}`;
  const gap: EntityGapResult = {
    consensusEntities: base.gap.consensusEntities,
    found: entitiesPresent(base.gap.consensusEntities, text),
    missing: [],
    querySequence: base.gap.querySequence.map((q) => ({ ...q, answered: questionAnswered(q.query, text) })),
  };
  gap.missing = gap.consensusEntities.filter((e) => !gap.found.includes(e.name));
  const schema = auditProductSchema(extraction.jsonLd);
  const onPage = auditOnPage(extraction, keyword);
  const visibilityInput = buildVisibilityInput({ schema, onPage, cwv: base.cwv, gap, trust: base.trust });
  const conversionInputs = (base.visual.length ? base.visual.map((v) => v.rubric) : [undefined]).map((rubric) =>
    buildConversionInput(extraction, { cwv: base.cwv, trust: base.trust }, rubric)
  );
  return composeScoreCard(
    visibilityInput,
    conversionInputs,
    Boolean(base.cwv),
    { visibility: before.visibility.current, conversion: before.conversion.current, ppi: before.ppi.current },
    attributions
  ).scoreCard;
}

export interface VerifyStageResult {
  report: VerifyReport;
  scoreCard: ScoreCard;
  scoreCardExcludingSample: ScoreCard;
  droppedSections: { sectionId: string; reason: string }[];
}

/**
 * Stage 9: applies the full patch set in a fresh browser, drops sections that damage the page, runs a click test and
 * re-scores the optimised page with exactly the functions that scored the original. Sample-flagged content counts toward
 * the after score (spec 7.4) but a second score without it is stored so the gain is never misrepresented.
 */
export async function runVerifyStage(
  deps: VerifyStageDeps,
  audit: AuditRecord,
  target: Extraction,
  rebuild: RebuildResult,
  blueprint: Blueprint
): Promise<VerifyStageResult> {
  const { store, storage } = deps;
  const logger = deps.logger ?? defaultLog;
  const auditId = audit.auditId;
  const started = Date.now();
  const browser = deps.browser ?? (await getBrowser());

  await store.updateAudit(auditId, { status: 'verifying', stage: 'verify_dom_and_scores', progressPercent: 93, stageTimings: { verifying: new Date().toISOString() } });

  const snapshot = (await storage.get(`${auditId}/target/index.html`))?.body.toString('utf8') ?? '';
  const render = (ops: PatchOp[]) => renderOptimised(snapshot, ops, rebuild.mode).html;
  const fixOps = rebuild.applied.filter((o) => o.sectionId.startsWith('fix_'));
  const sectionOps = rebuild.applied.filter((o) => !o.sectionId.startsWith('fix_'));

  const mobileCta = target.ctaPositions.find((c) => c.viewport === 'mobile') ?? target.ctaPositions[0];
  const report = await verifyOptimised({ browser, storage, auditId, render, fixOps, sectionOps, ctaSelector: mobileCta?.aboveFold ? mobileCta.selector : undefined });
  const droppedSections = report.sections.filter((v) => !v.ok).map((v) => ({ sectionId: v.sectionId, reason: v.reason ?? 'Failed verification' }));
  const dropIds = new Set(droppedSections.map((d) => d.sectionId));
  const finalOps = report.acceptedOps;
  const finalHtml = render(finalOps);
  await storage.put(optimisedKey(auditId), finalHtml, 'text/html; charset=utf-8');

  const moved = new Map(report.acceptedOps.filter((o) => !o.sectionId.startsWith('fix_')).map((o) => [o.sectionId, o]));
  const placementChanged = report.sections.filter((v) => v.movedTo);
  if (placementChanged.length > 0) {
    const docs = await store.getPatches(auditId);
    await store.savePatches(
      auditId,
      docs.map((p): AuditPatch => {
        const op = moved.get(p.sectionId);
        return op && placementChanged.some((v) => v.sectionId === p.sectionId)
          ? { ...p, op: op.op, targetSelector: op.target, opJson: JSON.stringify(op) }
          : p;
      })
    );
  }
  if (dropIds.size > 0) {
    const docs = await store.getPatches(auditId);
    const reasonById = new Map(droppedSections.map((d) => [d.sectionId, d.reason]));
    await store.savePatches(
      auditId,
      docs.map((p): AuditPatch => (reasonById.has(p.sectionId) ? { ...p, status: 'failed', failureReason: reasonById.get(p.sectionId) } : p))
    );
    await store.saveBlueprint(
      auditId,
      (await store.getBlueprint(auditId)).map((b) => (dropIds.has(b.sectionId) ? { ...b, status: 'pending' as const } : b))
    );
  }

  const analysisObj = await storage.get(analysisKey(auditId));
  const consensusObj = await storage.get(consensusKey(auditId));
  if (!analysisObj || !consensusObj) throw new Error('Baseline analysis is missing; cannot re-score.');
  const base = JSON.parse(analysisObj.body.toString('utf8')) as SavedAnalysis;
  ConsensusModelSchema.parse(JSON.parse(consensusObj.body.toString('utf8')));
  const keyword = audit.keyword ?? target.meta.title;
  const before = base.scoreCard;

  const withSample = await extractAfter(browser, storage, auditId, finalHtml, target);
  const stripped = cheerio.load(finalHtml);
  stripped('[data-rf-sample="true"]').remove();
  const withoutSample = await extractAfter(browser, storage, auditId, stripped.html(), target);

  const appliedIds = [...new Set(finalOps.map((o) => o.sectionId))];
  const sampleIds = new Set(finalOps.filter((o) => o.sample).map((o) => o.sectionId));
  const preliminary = scoreAfter(withSample, base, keyword, before);
  const attributions = buildAttributions(before, preliminary, appliedIds, sampleIds);
  const scoreCard = scoreAfter(withSample, base, keyword, before, attributions);
  const scoreCardExcludingSample = scoreAfter(withoutSample, base, keyword, before);

  const regression = scoreCard.ppi.current < before.ppi.current;
  if (regression) {
    logger('warn', 'optimised page scores below the original', { auditId, stage: 'verify', before: before.ppi.current, after: scoreCard.ppi.current });
  }
  await storage.put(
    `${auditId}/report.json`,
    JSON.stringify(
      {
        baseline: before,
        optimised: scoreCard,
        optimisedExcludingSample: scoreCardExcludingSample,
        verify: report,
        regression,
        dropped: [...rebuild.dropped, ...droppedSections],
        blueprint: blueprint.decisionLog,
      },
      null,
      2
    ),
    'application/json'
  );
  await store.updateAudit(auditId, {
    status: 'complete',
    stage: 'finalize',
    progressPercent: 100,
    completedAt: new Date().toISOString(),
    scores: { baseline: before, optimized: scoreCard },
    stageTimings: { complete: new Date().toISOString() },
  });
  logger('info', 'verify stage complete', {
    auditId,
    stage: 'verify',
    durationMs: Date.now() - started,
    sectionsOk: report.sections.filter((s) => s.ok).length,
    sectionsDropped: droppedSections.length,
    interaction: report.interaction,
    beforePpi: before.ppi.current,
    afterPpi: scoreCard.ppi.current,
    afterPpiWithoutSample: scoreCardExcludingSample.ppi.current,
  });
  return { report, scoreCard, scoreCardExcludingSample, droppedSections };
}
