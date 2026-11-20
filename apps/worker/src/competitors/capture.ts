import { BlockedSiteError, toRankForgeError, type Extraction } from '@rankforge/schema';
import type { ArtifactStorage } from '@rankforge/storage';
import { captureTarget, type CaptureInput, type CaptureOutput } from '../capture/capture.js';
import type { UrlPolicy } from '../capture/network.js';
import { log, type Logger } from '../lib/log.js';

export interface CompetitorCandidate {
  competitorId: string;
  url: string;
  rank: number;
  source: 'organic' | 'ai_cited';
}

export interface CompetitorOutcome {
  candidate: CompetitorCandidate;
  status: 'ok' | 'skipped';
  reason?: string;
  extraction?: Extraction;
  durationMs: number;
}

export interface CaptureCompetitorsOptions {
  auditId: string;
  candidates: CompetitorCandidate[];
  storage: ArtifactStorage;
  /** Parallel browser sessions (spec: up to 5). */
  concurrency?: number;
  /** Time budget per competitor in ms (spec: 25 s). */
  budgetMs?: number;
  /** Stop backfilling once this many competitors captured successfully (spec: 7+). */
  targetUsable?: number;
  /** Candidates 1..primaryCount are tried first; the rest only backfill (spec: ranks 1-10, then 11-15). */
  primaryCount?: number;
  urlPolicy?: UrlPolicy;
  logger?: Logger;
  /** Called as each competitor finishes so the studio can stream cards. */
  onOutcome?: (outcome: CompetitorOutcome) => Promise<void> | void;
  capture?: (input: CaptureInput) => Promise<CaptureOutput>;
}

function skipReason(err: unknown): string {
  const typed = toRankForgeError(err);
  if (typed instanceof BlockedSiteError) {
    return typed.reason === 'timeout' ? 'too slow' : typed.reason === 'challenge_page' ? 'bot check' : 'blocked';
  }
  return 'could not be read';
}

/**
 * CompetitorCaptureTool: captures up to `concurrency` competitors in parallel with a per-site time budget.
 * A blocked or slow site is marked skipped and replaced from the next ranks until enough are usable.
 */
export async function captureCompetitors(options: CaptureCompetitorsOptions): Promise<CompetitorOutcome[]> {
  const logger = options.logger ?? log;
  const concurrency = options.concurrency ?? 5;
  const budgetMs = options.budgetMs ?? 25_000;
  const targetUsable = options.targetUsable ?? 7;
  const primaryCount = options.primaryCount ?? 10;
  const capture = options.capture ?? captureTarget;

  const queue = [...options.candidates].sort((a, b) => a.rank - b.rank);
  const outcomes: CompetitorOutcome[] = [];
  let usable = 0;
  let started = 0;

  const runOne = async (candidate: CompetitorCandidate): Promise<void> => {
    const t0 = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const prefix = `${options.auditId}/competitors/${candidate.competitorId}`;
    try {
      const result = await Promise.race([
        capture({
          auditId: options.auditId,
          url: candidate.url,
          storage: options.storage,
          lite: true,
          artifactPrefix: prefix,
          renderTimeoutMs: Math.max(5_000, budgetMs - 8_000),
          urlPolicy: options.urlPolicy,
          logger,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new BlockedSiteError('Competitor exceeded its time budget.', 'timeout')), budgetMs);
        }),
      ]);
      usable++;
      const outcome: CompetitorOutcome = {
        candidate,
        status: 'ok',
        extraction: result.extraction,
        durationMs: Date.now() - t0,
      };
      outcomes.push(outcome);
      await options.onOutcome?.(outcome);
    } catch (err) {
      const outcome: CompetitorOutcome = {
        candidate,
        status: 'skipped',
        reason: skipReason(err),
        durationMs: Date.now() - t0,
      };
      logger('info', 'competitor skipped', {
        auditId: options.auditId,
        stage: 'competitors',
        url: candidate.url,
        reason: outcome.reason,
        durationMs: outcome.durationMs,
      });
      outcomes.push(outcome);
      await options.onOutcome?.(outcome);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const next = queue[0];
      if (!next) return;
      // Backfill candidates (beyond the primary set) only run while we still need usable competitors.
      if (started >= primaryCount && usable >= targetUsable) return;
      queue.shift();
      started++;
      await runOne(next);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return outcomes.sort((a, b) => a.candidate.rank - b.candidate.rank);
}
