/** Replays verification on a finished audit's saved artifacts. Usage: tsx scripts/debug-verify.ts <auditId> */
import { LocalDiskStorage, findRepoRoot } from '@rankforge/storage';
import path from 'node:path';
import type { PatchOp } from '@rankforge/schema';
import { getBrowser, closeBrowser } from '../apps/worker/src/capture/capture.ts';
import { renderOptimised } from '../apps/worker/src/stages/rebuild-stage.ts';
import { verifyOptimised } from '../apps/worker/src/rebuild/verify.ts';

async function main() {
  const auditId = process.argv[2]!;
  const storage = new LocalDiskStorage(path.join(findRepoRoot(), '.data/artifacts'));
  const snapshot = (await storage.get(`${auditId}/target/index.html`))!.body.toString('utf8');
  const saved = JSON.parse((await storage.get(`${auditId}/optimised/patches.json`))!.body.toString('utf8')) as { ops: PatchOp[] };
  const extraction = JSON.parse((await storage.get(`${auditId}/target/extraction.json`))!.body.toString('utf8'));
  const cta = extraction.ctaPositions.find((c: { viewport: string }) => c.viewport === 'mobile') ?? extraction.ctaPositions[0];
  const report = await verifyOptimised({
    browser: await getBrowser(),
    storage,
    auditId,
    render: (ops) => renderOptimised(snapshot, ops, 'server').html,
    fixOps: saved.ops.filter((o) => o.sectionId.startsWith('fix_')),
    sectionOps: saved.ops.filter((o) => !o.sectionId.startsWith('fix_')),
    ctaSelector: cta?.aboveFold ? cta.selector : undefined,
  });
  console.log(JSON.stringify(report.sections, null, 1));
  console.log('cta', cta?.selector, cta?.aboveFold);
  await closeBrowser();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
