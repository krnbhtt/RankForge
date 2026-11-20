import { Router, type Request, type Response } from 'express';
import { featureFlags } from '@rankforge/config';
import {
  AuditErrorSchema,
  BlueprintSchema,
  ExtractionSchema,
  RunAuditTaskInputSchema,
  toRankForgeError,
  type AuditRecord,
} from '@rankforge/schema';
import { validateTargetUrl } from '@rankforge/ssrf';
import { artifactKeys, createStorageFromEnv, type ArtifactStorage } from '@rankforge/storage';
import { SpendTracker } from '../ai/gemini.js';
import { captureTarget } from '../capture/capture.js';
import { log } from '../lib/log.js';
import { runCaptureStage } from '../pipeline/capture-stage.js';
import { getAuditStore } from '../store/audit-store.js';
import { runAnalysisStage } from '../stages/analysis-stage.js';
import { blueprintKey, runBlueprintStage } from '../stages/blueprint-stage.js';
import { runCompetitorsStage } from '../stages/competitors-stage.js';
import { runRebuildStage } from '../stages/rebuild-stage.js';
import { runVerifyStage } from '../stages/verify-stage.js';

export interface TaskRunnerDeps {
  capture: typeof captureTarget;
  storage: () => ArtifactStorage;
}

/**
 * Endpoint: POST /internal/tasks/run (Cloud Tasks target, spec 6.3).
 * Runs the whole audit as one job and keeps the HTTP request open for its duration (spec 8.6). Every stage
 * checkpoints to the audit store; failures become typed errors with a recovery action.
 */
export function createTasksRouter(deps: TaskRunnerDeps): ReturnType<typeof Router> {
  const router = Router();

  router.post('/internal/tasks/run', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const parsed = RunAuditTaskInputSchema.safeParse(req.body);
    if (!parsed.success) {
      const error = AuditErrorSchema.parse({
        code: 'UserInputError',
        message: 'Invalid run audit task payload',
        recoveryAction: 'Verify auditId and targetUrl format',
        details: { issues: parsed.error.issues },
        timestamp: new Date().toISOString(),
      });
      return res.status(400).json({ success: false, error });
    }
    const { auditId, targetUrl, keyword } = parsed.data;

    // Defense in depth: the web tier already checked, the worker checks again.
    const ssrf = await validateTargetUrl(targetUrl);
    if (!ssrf.isValid) {
      const error = AuditErrorSchema.parse({
        code: 'UserInputError',
        message: `SSRF validation failed: ${ssrf.error || 'Target URL is not permitted'}`,
        recoveryAction: 'Provide a valid public HTTP or HTTPS product URL',
        details: { targetUrl, error: ssrf.error },
        timestamp: new Date().toISOString(),
      });
      return res.status(400).json({ success: false, error });
    }

    const store = getAuditStore();
    const spend = new SpendTracker(featureFlags.COST_CAP_INR);
    log('info', 'audit run starting', { auditId, stage: 'run', targetUrl });

    try {
      let audit = await store.getAudit(auditId);
      if (!audit) {
        const now = new Date().toISOString();
        audit = {
          auditId,
          wsId: 'default',
          userId: 'anonymous',
          targetUrl,
          keyword,
          keywordCandidates: [],
          imageConsent: false,
          status: 'queued',
          stage: 'init',
          progressPercent: 5,
          platform: 'unknown',
          patchMode: 'static',
          stageTimings: { queued: now },
          createdAt: now,
          updatedAt: now,
          totalCostInr: 0,
        } satisfies AuditRecord;
        await store.createAudit(audit);
      }
      await store.updateAudit(auditId, { status: 'queued', stage: 'init', progressPercent: 5, stageTimings: { queued: new Date().toISOString() } });

      const storage = deps.storage();
      const outcome = await runCaptureStage({ store, storage, capture: deps.capture, logger: log }, (await store.getAudit(auditId)) ?? audit);
      if (outcome !== 'captured') {
        const failed = await store.getAudit(auditId);
        return res.status(200).json({ success: false, auditId, finalStatus: outcome, elapsedMs: Date.now() - startTime, error: failed?.error });
      }

      const target = ExtractionSchema.parse(JSON.parse((await storage.get(artifactKeys.extraction(auditId)))?.body.toString('utf8') ?? '{}'));
      const afterCapture = (await store.getAudit(auditId)) ?? audit;

      const competitors = await runCompetitorsStage({ store, storage, spend, logger: log }, afterCapture, target);
      const analysed = (await store.getAudit(auditId)) ?? afterCapture;
      await runAnalysisStage({ store, storage, spend, logger: log }, analysed, target, {
        consensus: competitors.consensus,
        keyword: competitors.keyword,
        queries: await store.getQueries(auditId),
        competitorIds: competitors.outcomes.filter((o) => o.status === 'ok').map((o) => o.candidate.competitorId),
      });

      const withScores = (await store.getAudit(auditId)) ?? analysed;
      await runBlueprintStage({ store, storage, spend, logger: log }, withScores, target);
      const blueprint = BlueprintSchema.parse(JSON.parse((await storage.get(blueprintKey(auditId)))?.body.toString('utf8') ?? '{}'));

      const blueprinted = (await store.getAudit(auditId)) ?? withScores;
      const rebuild = await runRebuildStage({ store, storage, spend, logger: log }, blueprinted, target, blueprint);
      const rebuilt = (await store.getAudit(auditId)) ?? blueprinted;
      await runVerifyStage({ store, storage, logger: log }, rebuilt, target, rebuild, blueprint);
      await store.updateAudit(auditId, { totalCostInr: spend.totalInr });

      const finalAudit = await store.getAudit(auditId);
      const elapsedMs = Date.now() - startTime;
      log('info', 'audit run complete', { auditId, stage: 'run', durationMs: elapsedMs, costInr: spend.totalInr });
      return res.status(200).json({
        success: true,
        auditId,
        finalStatus: finalAudit?.status ?? 'complete',
        elapsedMs,
        costInr: spend.totalInr,
        scores: finalAudit?.scores
          ? {
              baseline: finalAudit.scores.baseline && {
                visibility: finalAudit.scores.baseline.visibility.current,
                conversion: finalAudit.scores.baseline.conversion.current,
                ppi: finalAudit.scores.baseline.ppi.current,
              },
              optimized: finalAudit.scores.optimized && {
                visibility: finalAudit.scores.optimized.visibility.current,
                conversion: finalAudit.scores.optimized.conversion.current,
                ppi: finalAudit.scores.optimized.ppi.current,
              },
            }
          : undefined,
      });
    } catch (err) {
      const typed = toRankForgeError(err);
      log('error', 'audit run failed', { auditId, stage: 'run', code: typed.code, error: typed.message });
      await store
        .updateAudit(auditId, {
          status: 'failed',
          error: typed.toAuditError(),
          totalCostInr: spend.totalInr,
          stageTimings: { failed: new Date().toISOString() },
        })
        .catch((updateErr: Error) => log('error', 'could not record the failure', { auditId, error: updateErr.message }));
      return res.status(200).json({ success: false, auditId, finalStatus: 'failed', elapsedMs: Date.now() - startTime, error: typed.toAuditError() });
    }
  });

  return router;
}

export const tasksRouter = createTasksRouter({
  capture: captureTarget,
  storage: () => createStorageFromEnv(),
});
