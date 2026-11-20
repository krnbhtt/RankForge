import type { IAuditStore } from '@rankforge/audit-store';
import {
  BlueprintSchema,
  ConsensusModelSchema,
  type AuditBlueprintSection,
  type AuditRecord,
  type Blueprint,
  type Extraction,
} from '@rankforge/schema';
import { artifactKeys, type ArtifactStorage } from '@rankforge/storage';
import type { SpendTracker } from '../ai/gemini.js';
import type { EntityGapResult } from '../analysis/entity-gap.js';
import { arbitrate } from '../blueprint/arbiter.js';
import { evaluatePlaybook } from '../blueprint/playbook.js';
import { adviseStructure } from '../blueprint/structure.js';
import { log as defaultLog, type Logger } from '../lib/log.js';
import { analysisKey } from './analysis-stage.js';
import { consensusKey } from './competitors-stage.js';

export const blueprintKey = (auditId: string) => `${auditId}/blueprint.json`;

export interface BlueprintStageDeps {
  store: IAuditStore;
  storage: ArtifactStorage;
  spend: SpendTracker;
  logger?: Logger;
  advise?: typeof adviseStructure;
}

interface SavedAnalysis {
  schema: { rules: { id: string }[] };
  onPage: { rules: { id: string }[] };
  gap: EntityGapResult;
}

async function readJson<T>(storage: ArtifactStorage, key: string): Promise<T> {
  const obj = await storage.get(key);
  if (!obj) throw new Error(`Missing artifact ${key}`);
  return JSON.parse(obj.body.toString('utf8')) as T;
}

/**
 * Stage 7 of the pipeline: CRO playbook, structure advice and arbiter. Writes the blueprint to the store and
 * storage and moves the audit to `blueprinted`. Works without the model: the playbook defaults are used.
 */
export async function runBlueprintStage(
  deps: BlueprintStageDeps,
  audit: AuditRecord,
  target: Extraction
): Promise<Blueprint> {
  const { store, storage, spend } = deps;
  const logger = deps.logger ?? defaultLog;
  const auditId = audit.auditId;
  const started = Date.now();

  await store.updateAudit(auditId, { stage: 'cro_playbook', progressPercent: 76, stageTimings: { blueprinting: new Date().toISOString() } });

  const analysis = await readJson<SavedAnalysis>(storage, analysisKey(auditId));
  const consensus = ConsensusModelSchema.parse(await readJson(storage, consensusKey(auditId)));
  const findings = await store.getFindings(auditId);
  const html = (await storage.get(artifactKeys.targetIndex(auditId)))?.body.toString('utf8') ?? '';
  const keyword = audit.keyword ?? target.meta.title;

  const planned = evaluatePlaybook({ extraction: target, findings, consensus, gap: analysis.gap });
  const advice = await (deps.advise ?? adviseStructure)(planned, consensus, target, { keyword, spend, logger, auditId });
  const blueprint = arbitrate({
    auditId,
    keyword,
    planned,
    advice,
    components: target.components,
    html,
    ruleIds: [...analysis.schema.rules.map((r) => r.id), ...analysis.onPage.rules.map((r) => r.id)],
  });

  const docs: AuditBlueprintSection[] = blueprint.sections.map((s) => ({
    sectionId: s.sectionId,
    auditId,
    order: s.order,
    name: s.name,
    strategy: s.justifications[0]?.note ?? '',
    action: `${s.anchor.position === 'insertAfter' ? 'Insert after' : 'Insert before'} ${s.anchor.componentKind ?? s.anchor.selector}`,
    status: 'pending',
    spec: s,
  }));
  await store.saveBlueprint(auditId, docs);
  await storage.put(blueprintKey(auditId), JSON.stringify(BlueprintSchema.parse(blueprint), null, 2), 'application/json');
  await store.updateAudit(auditId, {
    status: 'blueprinted',
    stage: 'structure_blueprint',
    progressPercent: 80,
    totalCostInr: spend.totalInr,
    stageTimings: { blueprinted: new Date().toISOString() },
  });
  logger('info', 'blueprint stage complete', {
    auditId,
    stage: 'blueprint',
    durationMs: Date.now() - started,
    sections: blueprint.sections.length,
    fixes: blueprint.deterministicFixes.length,
    generatedBy: blueprint.generatedBy,
  });
  return blueprint;
}
