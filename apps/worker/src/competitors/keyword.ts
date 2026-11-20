import { z } from 'zod';
import type { AuditRecord, Extraction } from '@rankforge/schema';
import { generateJson, type SpendTracker } from '../ai/gemini.js';
import type { Logger } from '../lib/log.js';
import type { IAuditStore } from '@rankforge/audit-store';

export const KeywordCandidatesSchema = z.object({
  keywords: z
    .array(
      z.object({
        keyword: z.string().min(3).max(80),
        intent: z.enum(['transactional', 'commercial', 'informational']),
        rationale: z.string().max(200),
      })
    )
    .min(3)
    .max(5),
});

export interface KeywordDeps {
  store: IAuditStore;
  spend?: SpendTracker;
  logger?: Logger;
  /** How long to wait for the user to pick one (spec: 60 s). Tests pass 0. */
  waitMs?: number;
  pollMs?: number;
}

/**
 * keyword-resolution skill: uses the supplied keyword, otherwise proposes 3 to 5 candidates from the page and
 * waits for the user's pick (status awaiting_keyword); after the wait the top candidate is used automatically.
 */
export async function resolveKeyword(deps: KeywordDeps, audit: AuditRecord, extraction: Extraction): Promise<string> {
  if (audit.keyword?.trim()) return audit.keyword.trim();
  const { store } = deps;
  const headings = extraction.headingTree.flatMap((h) => [h.text, ...h.children.map((c) => c.text)]).slice(0, 12);
  const product = extraction.platform.productData;
  const result = await generateJson({
    role: 'flash',
    schema: KeywordCandidatesSchema,
    system:
      'You suggest the search keywords a shopper would type to find this kind of product. ' +
      'Prefer broad category-level phrases of 2 to 4 words that many online shops rank for (for example "ceramic coffee dripper" or "matte lipstick"). ' +
      'Do not include brand names, pack sizes, colours or model numbers.',
    prompt:
      `Title: ${extraction.meta.title}\nH1: ${extraction.content.h1}\nHeadings: ${headings.join(' | ')}\n` +
      `Type: ${product?.productType ?? ''}\nTags: ${(product?.tags ?? []).join(', ')}\nSuggest 3 to 5 keywords.`,
    spend: deps.spend,
    logger: deps.logger,
    auditId: audit.auditId,
    stage: 'keyword',
  });
  const candidates = result.keywords.map((k) => k.keyword);
  await store.updateAudit(audit.auditId, {
    status: 'awaiting_keyword',
    stage: 'keyword_resolution',
    progressPercent: 28,
    keywordCandidates: candidates,
    stageTimings: { awaiting_keyword: new Date().toISOString() },
  });

  const deadline = Date.now() + (deps.waitMs ?? 60_000);
  const pollMs = deps.pollMs ?? 1000;
  for (;;) {
    const current = await store.getAudit(audit.auditId);
    if (current?.keyword?.trim()) return current.keyword.trim();
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const chosen = candidates[0] as string;
  await store.updateAudit(audit.auditId, { keyword: chosen });
  return chosen;
}
