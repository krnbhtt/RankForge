import type { IAuditStore } from '@rankforge/audit-store';
import type { AuditPatch, AuditRecord, Blueprint, Extraction, PatchOp } from '@rankforge/schema';
import { artifactKeys, type ArtifactStorage } from '@rankforge/storage';
import type { SpendTracker } from '../ai/gemini.js';
import { log as defaultLog, type Logger } from '../lib/log.js';
import { applyPatchOps, applyRuntimeMode, type ApplyFailure } from '../rebuild/applier.js';
import { buildDeterministicOps, sectionOps } from '../rebuild/deterministic.js';
import { RF_STYLES, sanitizeAndValidateSection } from '../rebuild/sanitize.js';
import { writeSection } from '../rebuild/writer.js';

export const optimisedKey = (auditId: string) => `${auditId}/optimised/index.html`;
export const patchesKey = (auditId: string) => `${auditId}/optimised/patches.json`;

export interface RebuildStageDeps {
  store: IAuditStore;
  storage: ArtifactStorage;
  spend: SpendTracker;
  logger?: Logger;
  write?: typeof writeSection;
  /** Operations produced outside the blueprint (generated images); verified like any other section. */
  extraOps?: PatchOp[];
}

export interface RebuildResult {
  ops: PatchOp[];
  applied: PatchOp[];
  dropped: { sectionId: string; reason: string }[];
  mode: 'server' | 'runtime';
}

const CLICK_FORWARD =
  `<script data-rf-helper>document.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('[data-rf-click]'):null;if(!b)return;var t=document.querySelector(b.getAttribute('data-rf-click'));if(t)t.click()});</script>`;

/** Adds RankForge's own styles and click helper to the optimised document. */
export function finaliseOptimisedHtml(html: string): string {
  const withStyle = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `<style data-rf>${RF_STYLES}</style></head>`) : `<style data-rf>${RF_STYLES}</style>${html}`;
  return /<\/body>/i.test(withStyle) ? withStyle.replace(/<\/body>/i, `${CLICK_FORWARD}</body>`) : withStyle + CLICK_FORWARD;
}

/** Applies operations to the snapshot in the chosen mode and adds RankForge's styles and helpers. */
export function renderOptimised(snapshot: string, ops: PatchOp[], mode: 'server' | 'runtime'): { html: string; failed: ApplyFailure[]; applied: PatchOp[] } {
  const result = applyPatchOps(snapshot, ops);
  const html = mode === 'runtime' ? applyRuntimeMode(snapshot, ops) : result.html;
  return { html: finaliseOptimisedHtml(html), failed: result.failed, applied: result.applied };
}

function toPatchDocs(auditId: string, ops: PatchOp[], failures: Map<PatchOp, string>): AuditPatch[] {
  const now = new Date().toISOString();
  return ops.map((op, i) => ({
    patchId: `${op.sectionId}_${i + 1}`,
    auditId,
    sectionId: op.sectionId,
    op: op.op,
    targetSelector: op.target,
    htmlPayload: op.html,
    tag: op.tag,
    reason: op.reason,
    isSample: op.sample,
    status: failures.has(op) ? ('failed' as const) : ('applied' as const),
    failureReason: failures.get(op),
    opJson: JSON.stringify(op),
    createdAt: now,
  }));
}

/**
 * Stage 8: section-by-section rebuild. Deterministic fixes are applied first, then each blueprint section is written,
 * sanitised, turned into a patch operation and applied. The optimised page and the patch documents are rewritten after
 * every section, so the studio can show each section as it lands. A section that cannot be written or applied is
 * dropped with a recorded reason; the rest continue.
 */
export async function runRebuildStage(
  deps: RebuildStageDeps,
  audit: AuditRecord,
  target: Extraction,
  blueprint: Blueprint
): Promise<RebuildResult> {
  const { store, storage, spend } = deps;
  const logger = deps.logger ?? defaultLog;
  const auditId = audit.auditId;
  const started = Date.now();
  const mode: 'server' | 'runtime' = audit.patchMode === 'runtime' ? 'runtime' : 'server';

  await store.updateAudit(auditId, {
    status: 'rebuilding',
    stage: 'generate_patches',
    progressPercent: 85,
    stageTimings: { rebuilding: new Date().toISOString() },
  });

  const snapshot = (await storage.get(artifactKeys.targetIndex(auditId)))?.body.toString('utf8');
  if (!snapshot) throw new Error('The reproduction is missing; cannot rebuild.');
  const whitelist = [...new Set([...target.classWhitelist, ...target.components.flatMap((c) => c.classes)])];

  const ops: PatchOp[] = [...buildDeterministicOps(blueprint, target, snapshot), ...(deps.extraOps ?? [])];
  const failures = new Map<PatchOp, string>();
  const dropped: RebuildResult['dropped'] = [];

  const render = () => renderOptimised(snapshot, ops.filter((o) => !failures.has(o)), mode);
  const persist = async (): Promise<PatchOp[]> => {
    const r = render();
    for (const f of r.failed) failures.set(f.op, f.reason);
    await storage.put(optimisedKey(auditId), r.html, 'text/html; charset=utf-8');
    await store.savePatches(auditId, toPatchDocs(auditId, ops, failures));
    return r.applied;
  };

  await persist();

  for (const spec of blueprint.sections) {
    await store.saveBlueprint(
      auditId,
      (await store.getBlueprint(auditId)).map((b) => (b.sectionId === spec.sectionId ? { ...b, status: 'in_progress' as const } : b))
    );
    let raw: string;
    try {
      raw = await (deps.write ?? writeSection)(spec, target, whitelist, { spend, logger, auditId });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger('warn', 'section could not be written; skipping', { auditId, stage: 'rebuild', sectionId: spec.sectionId, error: reason });
      dropped.push({ sectionId: spec.sectionId, reason: `Writing failed: ${reason}` });
      continue;
    }
    const validated = sanitizeAndValidateSection(raw, whitelist);
    if (validated.removedClasses.length || validated.strippedUnsafe) {
      logger('info', 'section repaired', {
        auditId,
        stage: 'rebuild',
        sectionId: spec.sectionId,
        removedClasses: validated.removedClasses.length,
        strippedUnsafe: validated.strippedUnsafe,
        scopedStyle: validated.usedScopedStyle,
      });
    }
    const op = sectionOps(spec, validated.html);
    ops.push(op);
    const applied = await persist();
    if (!applied.includes(op)) {
      dropped.push({ sectionId: spec.sectionId, reason: failures.get(op) ?? 'The patch could not be applied.' });
    }
    await store.saveBlueprint(
      auditId,
      (await store.getBlueprint(auditId)).map((b) =>
        b.sectionId === spec.sectionId ? { ...b, status: applied.includes(op) ? ('completed' as const) : ('pending' as const) } : b
      )
    );
  }

  const finalApplied = await persist();
  await storage.put(patchesKey(auditId), JSON.stringify({ mode, ops, failures: [...failures].map(([o, r]) => ({ sectionId: o.sectionId, reason: r })), dropped }, null, 2), 'application/json');
  await store.updateAudit(auditId, { progressPercent: 90, totalCostInr: spend.totalInr });
  logger('info', 'rebuild stage complete', {
    auditId,
    stage: 'rebuild',
    durationMs: Date.now() - started,
    mode,
    ops: ops.length,
    applied: finalApplied.length,
    dropped: dropped.length,
  });
  return { ops, applied: finalApplied, dropped, mode };
}
