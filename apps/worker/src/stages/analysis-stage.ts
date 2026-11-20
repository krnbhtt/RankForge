import type { IAuditStore } from '@rankforge/audit-store';
import { featureFlags } from '@rankforge/config';
import {
  QuotaError,
  UpstreamModelError,
  type AuditFinding,
  type AuditQuery,
  type AuditRecord,
  type ConsensusModel,
  type Extraction,
  type ScoreCard,
} from '@rankforge/schema';
import { calculateConversionScore, calculatePPI, generateScoreCard, type ConversionInput } from '@rankforge/scoring';
import type { ArtifactStorage } from '@rankforge/storage';
import { SpendTracker } from '../ai/gemini.js';
import { analyseEntityQueryGap, type EntityGapResult } from '../analysis/entity-gap.js';
import { buildFindings } from '../analysis/findings.js';
import { auditOnPage } from '../analysis/onpage-audit.js';
import { fetchCoreWebVitals, type CoreWebVitals } from '../analysis/psi.js';
import { auditProductSchema } from '../analysis/schema-audit.js';
import { buildConversionInput, buildVisibilityInput } from '../analysis/signals.js';
import { analyseTrustAndCategory, type TrustCategoryResult } from '../analysis/trust-category.js';
import { runVisualCro, type VisualCroResult } from '../analysis/visual-cro.js';
import { log as defaultLog, type Logger } from '../lib/log.js';

export interface AnalysisStageDeps {
  store: IAuditStore;
  storage: ArtifactStorage;
  spend: SpendTracker;
  logger?: Logger;
  /** Test seams; production uses the real implementations. */
  fetchCwv?: typeof fetchCoreWebVitals;
  gap?: typeof analyseEntityQueryGap;
  trust?: typeof analyseTrustAndCategory;
  visual?: typeof runVisualCro;
  visualEnabled?: boolean;
}

export interface AnalysisResult {
  scoreCard: ScoreCard;
  findings: AuditFinding[];
  queries: AuditQuery[];
  cwv: CoreWebVitals | null;
  gap: EntityGapResult;
  trust: TrustCategoryResult | null;
  visualRuns: number;
  conversionRuns: number[];
}

export const analysisKey = (auditId: string) => `${auditId}/analysis.json`;

/** Two conversion results that differ by more than 10 points are averaged (spec 7.4). */
export function combineConversionRuns(
  inputs: ConversionInput[]
): { score: number; breakdown: Record<string, number>; averaged: boolean; runs: number[] } {
  const results = inputs.map((i) => calculateConversionScore(i));
  const first = results[0] as ReturnType<typeof calculateConversionScore>;
  const runs = results.map((r) => r.score);
  const second = results[1];
  if (!second || Math.abs(first.score - second.score) <= 10) {
    return { score: first.score, breakdown: { ...first.breakdown }, averaged: false, runs };
  }
  const breakdown: Record<string, number> = {};
  for (const key of Object.keys(first.breakdown) as (keyof typeof first.breakdown)[]) {
    breakdown[key] = Math.round(((first.breakdown[key] + second.breakdown[key]) / 2) * 10) / 10;
  }
  return { score: Math.round(((first.score + second.score) / 2) * 10) / 10, breakdown, averaged: true, runs };
}

async function loadScreenshot(storage: ArtifactStorage, key: string): Promise<Buffer | undefined> {
  const obj = await storage.get(key).catch(() => null);
  return obj?.body;
}

/**
 * Stages 6 of the pipeline: four analyses in parallel (technical and schema, entity and query gap, visual CRO,
 * trust and category), then findings and the baseline Visibility, Conversion and PPI scores computed in code.
 */
export async function runAnalysisStage(
  deps: AnalysisStageDeps,
  audit: AuditRecord,
  target: Extraction,
  competitors: { consensus: ConsensusModel; keyword: string; queries: AuditQuery[]; competitorIds: string[] }
): Promise<AnalysisResult> {
  const { store, storage, spend } = deps;
  const logger = deps.logger ?? defaultLog;
  const auditId = audit.auditId;
  const started = Date.now();

  await store.updateAudit(auditId, {
    status: 'analysing',
    stage: 'gap_analysis',
    progressPercent: 62,
    stageTimings: { analysing: new Date().toISOString() },
  });

  const visualEnabled = deps.visualEnabled ?? featureFlags.VISUAL_CRO_AUDIT;
  const swallow = <T>(label: string, fallback: T) => (err: unknown): T => {
    const e = err as Error;
    logger('warn', `${label} unavailable; continuing without it`, { auditId, stage: 'analysis', error: e.message });
    return fallback;
  };

  const schema = auditProductSchema(target.jsonLd);
  const onPage = auditOnPage(target, competitors.keyword);

  const [cwvPsi, gap, trust, visualRuns] = await Promise.all([
    (deps.fetchCwv ?? fetchCoreWebVitals)({ url: target.finalUrl, logger }),
    (deps.gap ?? analyseEntityQueryGap)(target, competitors.consensus, competitors.queries, {
      keyword: competitors.keyword,
      spend,
      logger,
      auditId,
    }),
    (deps.trust ?? analyseTrustAndCategory)(target, { spend, logger, auditId }).catch(
      swallow<TrustCategoryResult | null>('trust and category analysis', null)
    ),
    (async (): Promise<VisualCroResult[]> => {
      if (!visualEnabled) return [];
      const [mobile, desktop] = await Promise.all([
        loadScreenshot(storage, `${auditId}/target/screens/mobile.png`),
        loadScreenshot(storage, `${auditId}/target/screens/desktop.png`),
      ]);
      if (!mobile && !desktop) return [];
      const shots = await Promise.all(
        competitors.competitorIds.slice(0, 2).map((id) => loadScreenshot(storage, `${auditId}/competitors/${id}/screens/desktop.png`))
      );
      const input = { targetMobile: mobile, targetDesktop: desktop, competitorDesktops: shots.filter((b): b is Buffer => Boolean(b)) };
      const run = (deps.visual ?? runVisualCro)(input, { spend, logger, auditId });
      const first = await run.catch(swallow<VisualCroResult | null>('visual CRO audit', null));
      if (!first) return [];
      const second = await (deps.visual ?? runVisualCro)(input, { spend, logger, auditId }).catch(
        (err: unknown) => {
          if (err instanceof QuotaError || err instanceof UpstreamModelError) return null;
          throw err;
        }
      );
      return second ? [first, second] : [first];
    })(),
  ]);

  const cwv = cwvPsi ?? (target.pageSignals?.cwvLab ? { ...target.pageSignals.cwvLab, source: 'lab' as const } : null);
  const visibilityInput = buildVisibilityInput({ schema, onPage, cwv, gap, trust });
  const conversionInputs = (visualRuns.length ? visualRuns.map((v) => v.rubric) : [undefined]).map((rubric) =>
    buildConversionInput(target, { cwv, trust }, rubric)
  );
  const combined = combineConversionRuns(conversionInputs);

  const scoreCard = generateScoreCard(visibilityInput, conversionInputs[0] as ConversionInput);
  scoreCard.conversion = { ...scoreCard.conversion, current: combined.score, baseline: combined.score, delta: 0, breakdown: combined.breakdown };
  // A metric that could not be measured is left out and the rest rescaled, instead of scoring it as zero.
  const unmeasured: string[] = [];
  if (!cwv) {
    unmeasured.push('core_web_vitals');
    const { core_web_vitals: _cwv, ...rest } = scoreCard.visibility.breakdown as Record<string, number>;
    const earned = Object.values(rest).reduce((n, v) => n + v, 0);
    const rescaled = Math.round(((earned / 80) * 100) * 10) / 10;
    scoreCard.visibility = { ...scoreCard.visibility, current: rescaled, baseline: rescaled, delta: 0 };
  }
  const ppi = calculatePPI(scoreCard.visibility.current, combined.score);
  scoreCard.ppi = { current: ppi, baseline: ppi, delta: 0 };

  const findings = buildFindings({
    auditId,
    extraction: target,
    consensus: competitors.consensus,
    schema,
    onPage,
    cwv,
    gap,
    visualFindings: visualRuns[0]?.findings ?? [],
  });
  const missingEvidence = findings.filter((f) => !f.evidence || f.evidence.trim() === '');
  if (missingEvidence.length) {
    throw new Error(`Findings without evidence: ${missingEvidence.map((f) => f.findingId).join(', ')}`);
  }

  const queries: AuditQuery[] = gap.querySequence.map((q) => ({
    queryId: `q_${String(q.order).padStart(2, '0')}`,
    auditId,
    query: q.query,
    step: q.order,
    source: q.source === 'generated' ? 'grounding' : q.source,
    answered: q.answered,
  }));

  await store.saveFindings(auditId, findings);
  await store.saveQueries(auditId, queries);
  await storage.put(
    analysisKey(auditId),
    JSON.stringify({ schema, onPage, cwv, gap, trust, visual: visualRuns, conversionRuns: combined.runs, averaged: combined.averaged, unmeasured, scoreCard }, null, 2),
    'application/json'
  );
  await store.updateAudit(auditId, {
    status: 'analysed',
    stage: 'gap_synthesis',
    progressPercent: 72,
    scores: { baseline: scoreCard },
    totalCostInr: spend.totalInr,
    stageTimings: { analysed: new Date().toISOString() },
  });

  logger('info', 'analysis stage complete', {
    auditId,
    stage: 'analysis',
    durationMs: Date.now() - started,
    findings: findings.length,
    visibility: scoreCard.visibility.current,
    conversion: scoreCard.conversion.current,
    ppi: scoreCard.ppi.current,
    visualRuns: visualRuns.length,
    spendInr: spend.totalInr,
  });
  return { scoreCard, findings, queries, cwv, gap, trust, visualRuns: visualRuns.length, conversionRuns: combined.runs };
}
