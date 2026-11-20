import { BlockedSiteError, toRankForgeError, type AuditRecord } from '@rankforge/schema';
import { artifactKeys, type ArtifactStorage } from '@rankforge/storage';
import type { captureTarget, CaptureStep } from '../capture/capture.js';
import { log as defaultLog, type Logger } from '../lib/log.js';
import type { IAuditStore } from '../store/audit-store.js';

export interface CaptureStageDeps {
  store: IAuditStore;
  storage: ArtifactStorage;
  capture: typeof captureTarget;
  logger?: Logger;
}

export type CaptureStageOutcome = 'captured' | 'blocked' | 'failed';

const STEP_PROGRESS: Record<CaptureStep, { stage: string; progress: number }> = {
  rendering: { stage: 'render_page', progress: 14 },
  snapshotting: { stage: 'proxy_assets', progress: 17 },
  analysing: { stage: 'extract_page', progress: 19 },
};

export const pastedHtmlKey = artifactKeys.pastedHtml;
export const extractionKey = artifactKeys.extraction;

/**
 * Runs the capture stage and checkpoints it to the audit record. Resumable: when an extraction already
 * exists and the audit was not blocked, the stage is skipped. Pasted HTML (if stored) replaces live fetch.
 */
export async function runCaptureStage(deps: CaptureStageDeps, audit: AuditRecord): Promise<CaptureStageOutcome> {
  const { store, storage, capture } = deps;
  const logger = deps.logger ?? defaultLog;
  const { auditId } = audit;

  if (audit.status !== 'blocked' && (await storage.exists(extractionKey(auditId)))) {
    logger('info', 'capture already checkpointed; skipping', { auditId, stage: 'capture' });
    return 'captured';
  }

  await store.updateAudit(auditId, {
    status: 'capturing',
    stage: 'scrape_target',
    progressPercent: 12,
    error: undefined,
    stageTimings: { capturing: new Date().toISOString() },
  });

  const pasted = await storage.get(pastedHtmlKey(auditId));
  const started = Date.now();
  try {
    const { extraction, timings } = await capture({
      auditId,
      url: audit.targetUrl,
      html: pasted ? pasted.body.toString('utf8') : undefined,
      storage,
      logger,
      onProgress: async (step) => {
        const { stage, progress } = STEP_PROGRESS[step];
        await store.updateAudit(auditId, { stage, progressPercent: progress });
      },
    });

    await store.updateAudit(auditId, {
      status: 'captured',
      stage: 'detect_platform',
      progressPercent: 20,
      platform: extraction.platform.type,
      patchMode: extraction.hydration.mode === 'server' ? 'static' : 'runtime',
      capture: {
        source: extraction.source,
        finalUrl: extraction.finalUrl,
        renderMs: timings.renderMs,
        snapshotMs: timings.snapshotMs,
        analysisMs: timings.analysisMs,
        totalMs: timings.totalMs,
        assetCount: extraction.stats.assetCount,
        hydrationMode: extraction.hydration.mode,
        imagesDisabled: extraction.stats.imagesDisabled,
        title: extraction.meta.title,
      },
      stageTimings: { captured: new Date().toISOString() },
    });
    return 'captured';
  } catch (err) {
    const typed = toRankForgeError(err);
    const blocked = typed instanceof BlockedSiteError;
    logger(blocked ? 'warn' : 'error', 'capture stage ended without a reproduction', {
      auditId,
      stage: 'capture',
      durationMs: Date.now() - started,
      code: typed.code,
      error: typed.message,
    });
    await store.updateAudit(auditId, {
      status: blocked ? 'blocked' : 'failed',
      error: typed.toAuditError(),
      stageTimings: { [blocked ? 'blocked' : 'failed']: new Date().toISOString() },
    });
    return blocked ? 'blocked' : 'failed';
  }
}
