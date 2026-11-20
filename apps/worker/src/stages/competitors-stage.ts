import type { IAuditStore } from '@rankforge/audit-store';
import {
  type AuditCompetitor,
  type AuditQuery,
  type AuditRecord,
  type CompetitorProfile,
  type ConsensusModel,
  type Extraction,
  type GroundingResult,
  type SerpResult,
} from '@rankforge/schema';
import type { ArtifactStorage } from '@rankforge/storage';
import { SpendTracker } from '../ai/gemini.js';
import type { UrlPolicy } from '../capture/network.js';
import { captureCompetitors, type CompetitorCandidate, type CompetitorOutcome } from '../competitors/capture.js';
import { buildConsensus } from '../competitors/consensus.js';
import { extractEntitiesBatch } from '../competitors/entities.js';
import { discoverAiCitedSources } from '../competitors/grounding.js';
import { resolveKeyword } from '../competitors/keyword.js';
import { buildProfile, detectTrustElements } from '../competitors/profile.js';
import { fetchSerp } from '../competitors/serp.js';
import { log as defaultLog, type Logger } from '../lib/log.js';
import { isSameSite } from '../capture/trackers.js';

const NOT_COMPETITOR_HOSTS =
  /(^|\.)(youtube\.com|youtu\.be|instagram\.com|facebook\.com|pinterest\.[a-z.]+|reddit\.com|quora\.com|wikipedia\.org|nytimes\.com|twitter\.com|x\.com|linkedin\.com|medium\.com|tiktok\.com|bing\.com|google\.[a-z.]+)$/i;
/** Marketplaces usually block automated capture, so they are tried last (as backfill). */
const MARKETPLACE_HOSTS = /(^|\.)(amazon\.[a-z.]+|flipkart\.com|ebay\.[a-z.]+|walmart\.com|etsy\.com|alibaba\.com|aliexpress\.com|meesho\.com|myntra\.com|ajio\.com|snapdeal\.com)$/i;

export interface CompetitorsStageDeps {
  store: IAuditStore;
  storage: ArtifactStorage;
  spend: SpendTracker;
  logger?: Logger;
  keywordWaitMs?: number;
  /** Test seams; production uses the real implementations. */
  fetchSerp?: typeof fetchSerp;
  discoverAiCited?: typeof discoverAiCitedSources;
  captureCompetitors?: typeof captureCompetitors;
  extractEntitiesBatch?: typeof extractEntitiesBatch;
  urlPolicy?: UrlPolicy;
}

export interface CompetitorsStageResult {
  keyword: string;
  serp: SerpResult;
  grounding: GroundingResult;
  outcomes: CompetitorOutcome[];
  profiles: CompetitorProfile[];
  consensus: ConsensusModel;
}

export const consensusKey = (auditId: string) => `${auditId}/competitors/consensus.json`;
export const profilesKey = (auditId: string) => `${auditId}/competitors/profiles.json`;

/** Orders SERP and AI-cited candidates: own domain removed, non-shops dropped, marketplaces last, max 20. */
export function buildCandidates(
  targetUrl: string,
  serp: SerpResult,
  grounding: GroundingResult
): CompetitorCandidate[] {
  const seen = new Set<string>();
  const raw: { url: string; source: 'organic' | 'ai_cited' }[] = [
    ...serp.organic.map((o) => ({ url: o.url, source: 'organic' as const })),
    ...grounding.sources.map((s) => ({ url: s.url, source: 'ai_cited' as const })),
  ];
  const usable = raw.filter((c) => {
    let host: string;
    try {
      host = new URL(c.url).hostname;
    } catch {
      return false;
    }
    if (NOT_COMPETITOR_HOSTS.test(host) || isSameSite(c.url, targetUrl)) return false;
    const key = host.replace(/^www\./, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const shops = usable.filter((c) => !MARKETPLACE_HOSTS.test(new URL(c.url).hostname));
  const marketplaces = usable.filter((c) => MARKETPLACE_HOSTS.test(new URL(c.url).hostname));
  return [...shops, ...marketplaces].slice(0, 20).map((c, i) => ({
    competitorId: `cmp_${String(i + 1).padStart(2, '0')}`,
    url: c.url,
    rank: i + 1,
    source: c.source,
  }));
}

function toAuditCompetitor(auditId: string, outcome: CompetitorOutcome, profile?: CompetitorProfile): AuditCompetitor {
  const { candidate, extraction } = outcome;
  return {
    competitorId: candidate.competitorId,
    auditId,
    url: candidate.url,
    rank: candidate.rank,
    source: candidate.source,
    status: outcome.status,
    title: extraction?.meta.title || (outcome.reason ? `Skipped: ${outcome.reason}` : undefined),
    price: extraction?.price?.selling,
    currency: extraction?.price?.currency ?? 'INR',
    rating: extraction?.reviews.ratingValue,
    reviewCount: extraction?.reviews.reviewCount,
    trustSignals: profile?.trust ?? (extraction ? detectTrustElements(extraction.content.text) : []),
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Stages 3 to 5 of the audit pipeline: keyword, discovery (SERP plus AI-cited sources in parallel), parallel
 * competitor capture with skip and backfill, entity extraction and the consensus model. Each competitor is
 * written to the store as soon as it finishes so the studio can stream the cards.
 */
export async function runCompetitorsStage(
  deps: CompetitorsStageDeps,
  audit: AuditRecord,
  targetExtraction: Extraction
): Promise<CompetitorsStageResult> {
  const { store, storage, spend } = deps;
  const logger = deps.logger ?? defaultLog;
  const auditId = audit.auditId;

  const t = (label: string, since: number) => logger('info', `${label} done`, { auditId, stage: 'competitors', durationMs: Date.now() - since });
  let mark = Date.now();
  const keyword = await resolveKeyword({ store, spend, logger, waitMs: deps.keywordWaitMs }, audit, targetExtraction);

  t('keyword', mark);
  mark = Date.now();
  await store.updateAudit(auditId, {
    status: 'discovering',
    stage: 'discover_competitors',
    progressPercent: 38,
    keyword,
    stageTimings: { discovering: new Date().toISOString() },
  });

  const [serp, grounding] = await Promise.all([
    (deps.fetchSerp ?? fetchSerp)({ keyword }),
    (deps.discoverAiCited ?? discoverAiCitedSources)({ keyword, spend, logger, auditId }),
  ]);

  t('discovery', mark);
  mark = Date.now();
  const queries: AuditQuery[] = [
    ...serp.peopleAlsoAsk.map((q, i) => ({
      queryId: `paa_${i + 1}`,
      auditId,
      query: q.question,
      step: i + 1,
      source: 'paa' as const,
      answered: false,
    })),
    ...serp.relatedSearches.map((q, i) => ({
      queryId: `rel_${i + 1}`,
      auditId,
      query: q,
      step: serp.peopleAlsoAsk.length + i + 1,
      source: 'related' as const,
      answered: false,
    })),
  ];
  await store.saveQueries(auditId, queries);

  const candidates = buildCandidates(audit.targetUrl, serp, grounding);
  logger('info', 'competitor candidates ready', { auditId, stage: 'discovery', candidates: candidates.length });

  await store.updateAudit(auditId, {
    status: 'competitors',
    stage: 'crawl_competitors',
    progressPercent: 50,
    stageTimings: { competitors: new Date().toISOString() },
  });

  const saved = new Map<string, AuditCompetitor>();
  const outcomesSoFar: CompetitorOutcome[] = [];
  const outcomes = await (deps.captureCompetitors ?? captureCompetitors)({
    auditId,
    candidates,
    storage,
    urlPolicy: deps.urlPolicy,
    logger,
    onOutcome: async (outcome) => {
      outcomesSoFar.push(outcome);
      saved.set(outcome.candidate.competitorId, toAuditCompetitor(auditId, outcome));
      await store.saveCompetitors(
        auditId,
        [...saved.values()].sort((a, b) => a.rank - b.rank)
      );
    },
  });

  t('competitor capture', mark);
  mark = Date.now();
  const usable = outcomes.filter((o): o is CompetitorOutcome & { extraction: Extraction } => o.status === 'ok' && !!o.extraction);
  const entityMap = await (deps.extractEntitiesBatch ?? extractEntitiesBatch)(
    usable.map((o) => ({ id: o.candidate.competitorId, extraction: o.extraction })),
    { spend, logger, auditId }
  ).catch((err: Error) => {
    logger('warn', 'entity extraction failed; continuing without entities', { auditId, stage: 'competitors', error: err.message });
    return new Map<string, string[]>();
  });
  const profiles = usable.map((o) => buildProfile(o.candidate.competitorId, o.extraction, entityMap.get(o.candidate.competitorId) ?? []));

  for (const o of usable) {
    const profile = profiles.find((p) => p.competitorId === o.candidate.competitorId);
    saved.set(o.candidate.competitorId, toAuditCompetitor(auditId, o, profile));
  }
  await store.saveCompetitors(
    auditId,
    [...saved.values()].sort((a, b) => a.rank - b.rank)
  );

  t('entities', mark);
  const consensus = buildConsensus(profiles);
  await storage.put(consensusKey(auditId), JSON.stringify(consensus, null, 2), 'application/json');
  await storage.put(profilesKey(auditId), JSON.stringify(profiles, null, 2), 'application/json');
  logger('info', 'competitors stage complete', {
    auditId,
    stage: 'competitors',
    usable: usable.length,
    skipped: outcomes.length - usable.length,
    lowConfidence: consensus.lowConfidence,
    spendInr: spend.totalInr,
  });

  return { keyword, serp, grounding, outcomes, profiles, consensus };
}
