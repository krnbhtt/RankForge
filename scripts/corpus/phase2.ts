/** Live Phase 2 check: for corpus URLs, capture the target then discover and capture competitors. Usage: tsx scripts/corpus/phase2.ts c07 c11 */
import fs from 'node:fs';
import path from 'node:path';
import { LocalDiskStorage, findRepoRoot } from '@rankforge/storage';
import { FileAuditStore } from '@rankforge/audit-store';
import { SpendTracker } from '../../apps/worker/src/ai/gemini.ts';
import { captureTarget, closeBrowser } from '../../apps/worker/src/capture/capture.ts';
import { runCompetitorsStage } from '../../apps/worker/src/stages/competitors-stage.ts';
import { log } from '../../apps/worker/src/lib/log.ts';

for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const [k, ...v] = l.split('='); if (k) process.env[k] = v.join('='); }
const root = findRepoRoot();

async function main() {
  const rows = fs.readFileSync(path.join(root, 'docs/corpus.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const storage = new LocalDiskStorage(path.join(root, '.data/phase2'));
  const store = new FileAuditStore(path.join(root, '.data/phase2-audits'));
  const out: unknown[] = [];
  for (const id of process.argv.slice(2)) {
    const row = rows.find((r) => r[0] === id);
    if (!row) continue;
    const auditId = `p2_${id}`;
    const started = Date.now();
    const spend = new SpendTracker(25);
    const now = new Date().toISOString();
    await store.createAudit({ auditId, wsId: 'default', userId: 'u', targetUrl: row[1]!, keywordCandidates: [], imageConsent: false, status: 'captured', stage: 'x', progressPercent: 20, platform: 'unknown', patchMode: 'static', stageTimings: {}, createdAt: now, updatedAt: now, totalCostInr: 0 } as never);
    const target = await captureTarget({ auditId, url: row[1]!, storage, logger: () => undefined });
    const audit = (await store.getAudit(auditId))!;
    const t1 = Date.now();
    const res = await runCompetitorsStage({ store, storage, spend, keywordWaitMs: 0, logger: (lvl, msg, f) => { if (lvl !== 'debug' && msg !== 'gemini call') log(lvl, msg, f); } }, audit, target.extraction);
    const usable = res.outcomes.filter((o) => o.status === 'ok').length;
    const summary = { id, keyword: res.keyword, candidates: res.outcomes.length, usable, skipped: res.outcomes.filter((o) => o.status === 'skipped').map((o) => `${new URL(o.candidate.url).hostname}:${o.reason}`), competitorsStageSec: Math.round((Date.now() - t1) / 100) / 10, lowConfidence: res.consensus.lowConfidence, topEntities: res.consensus.entities.slice(0, 6).map((e) => `${e.name}(${e.frequency})`), sections: res.consensus.sectionSequence.slice(0, 5).map((s) => s.heading), trust: res.consensus.trustElements.slice(0, 5).map((t) => `${t.kind}(${t.frequency})`), spendInr: spend.totalInr, groundingNote: res.grounding.unavailableReason ?? 'ok', totalSec: Math.round((Date.now() - started) / 100) / 10 };
    console.log(JSON.stringify(summary));
    out.push(summary);
  }
  fs.writeFileSync(path.join(root, '.logs/phase2-live.json'), JSON.stringify(out, null, 1));
  await closeBrowser();
}
main().catch((e) => { console.error('ERR', e.code ?? '', e.message, JSON.stringify(e.details ?? {}).slice(0, 300)); process.exit(1); });
