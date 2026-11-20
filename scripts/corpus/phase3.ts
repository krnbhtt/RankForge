/** Live Phase 3 check on saved Phase 2 output. Usage: tsx scripts/corpus/phase3.ts c07 [runs] */
import fs from 'node:fs';
import path from 'node:path';
import { FileAuditStore } from '@rankforge/audit-store';
import { ConsensusModelSchema, ExtractionSchema } from '@rankforge/schema';
import { LocalDiskStorage, findRepoRoot } from '@rankforge/storage';
import { SpendTracker } from '../../apps/worker/src/ai/gemini.ts';
import { runAnalysisStage } from '../../apps/worker/src/stages/analysis-stage.ts';
import { log } from '../../apps/worker/src/lib/log.ts';

for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const [k, ...v] = l.split('='); if (k) process.env[k] = v.join('='); }
const root = findRepoRoot();

async function main() {
  const id = process.argv[2] ?? 'c07';
  const runs = Number(process.argv[3] ?? 2);
  const storage = new LocalDiskStorage(path.join(root, '.data/phase2'));
  const srcStore = new FileAuditStore(path.join(root, '.data/phase2-audits'));
  const srcId = `p2_${id}`;
  if (process.argv.includes('--recapture')) {
    const row = fs.readFileSync(path.join(root, 'docs/corpus.csv'), 'utf8').trim().split(String.fromCharCode(10)).slice(1).map((l) => l.split(',')).find((r) => r[0] === id)!;
    const { captureTarget, closeBrowser } = await import('../../apps/worker/src/capture/capture.ts');
    await captureTarget({ auditId: srcId, url: row[1]!, storage, logger: () => undefined });
    await closeBrowser();
  }
  const src = (await srcStore.getFullRecord(srcId))!;
  const target = ExtractionSchema.parse(JSON.parse((await storage.get(`${srcId}/target/extraction.json`))!.body.toString('utf8')));
  const consensus = ConsensusModelSchema.parse(JSON.parse((await storage.get(`${srcId}/competitors/consensus.json`))!.body.toString('utf8')));
  const okIds = src.competitors.filter((c) => c.status === 'ok').map((c) => c.competitorId);
  const results: { v: number; c: number; p: number; findings: number; sec: number; spend: number; visual: number; averaged: number[] }[] = [];
  for (let i = 1; i <= runs; i++) {
    const auditId = `p3_${id}_r${i}`;
    // Reuse the Phase 2 artifacts by copying the audit record under a new id.
    const store = new FileAuditStore(path.join(root, '.data/phase3-audits'));
    await store.createAudit({ ...src.audit, auditId, status: 'competitors', scores: undefined } as never);
    await store.saveQueries(auditId, src.queries.map((q) => ({ ...q, auditId })));
    for (const dir of ['target', 'competitors']) { /* artifacts are read from the Phase 2 prefix below */ void dir; }
    const aliasStorage = {
      put: (k: string, b: Buffer | string, t: string) => storage.put(k, b, t),
      exists: (k: string) => storage.exists(k.replace(auditId, srcId)),
      get: (k: string) => storage.get(k.replace(auditId, srcId)),
    };
    const spend = new SpendTracker(25);
    const t0 = Date.now();
    const res = await runAnalysisStage({ store, storage: aliasStorage as never, spend, logger: (lvl, msg, f) => { if (lvl !== 'debug' && msg !== 'gemini call') log(lvl, msg, f); } }, (await store.getAudit(auditId))!, target, { consensus, keyword: src.audit.keyword ?? id, queries: src.queries, competitorIds: okIds });
    const r = { v: res.scoreCard.visibility.current, c: res.scoreCard.conversion.current, p: res.scoreCard.ppi.current, findings: res.findings.length, sec: Math.round((Date.now() - t0) / 100) / 10, spend: spend.totalInr, visual: res.visualRuns, averaged: res.conversionRuns };
    console.log(JSON.stringify({ run: i, ...r, breakdown: { vis: res.scoreCard.visibility.breakdown, conv: res.scoreCard.conversion.breakdown } }));
    results.push(r);
    if (i === 1) {
      console.log(JSON.stringify(res.findings.map((f) => `[${f.tag}/${f.severity}] ${f.title} :: ${f.evidence?.slice(0, 110)}`), null, 1));
      console.log('category', JSON.stringify(res.trust), 'cwv', JSON.stringify(res.cwv));
    }
  }
  if (results.length > 1) {
    const d = (k: 'v' | 'c' | 'p') => Math.max(...results.map((r) => r[k])) - Math.min(...results.map((r) => r[k]));
    console.log(`SPREAD visibility=${d('v')} conversion=${d('c')} ppi=${d('p')}`);
  }
}
main().catch((e) => { console.error('ERR', e.code ?? '', e.message, JSON.stringify(e.details ?? {}).slice(0, 300)); process.exit(1); });
