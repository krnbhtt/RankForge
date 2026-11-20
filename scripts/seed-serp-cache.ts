/**
 * Seeds the SERP cache from an audit that already fetched real SERP data (its competitors and question list).
 * Usage: tsx scripts/seed-serp-cache.ts <auditId> [webOrigin]
 */
import { writeSerpCache } from '../apps/worker/src/competitors/serp.ts';

async function main() {
  const auditId = process.argv[2];
  const origin = process.argv[3] ?? 'http://localhost:3000';
  if (!auditId) throw new Error('Usage: seed-serp-cache <auditId> [webOrigin]');
  const res = await fetch(`${origin}/api/audits/${auditId}`);
  const d = (await res.json()) as {
    audit: { keyword?: string };
    competitors: { url: string; rank: number; title?: string }[];
    queries: { query: string; source: string; step: number }[];
  };
  if (!d.audit.keyword) throw new Error('The audit has no keyword');
  const organic = d.competitors
    .sort((a, b) => a.rank - b.rank)
    .map((c, i) => ({ position: i + 1, url: c.url, title: (c.title ?? '').replace(/^Skipped: .*/, ''), snippet: '', domain: new URL(c.url).hostname.replace(/^www\./, '') }));
  writeSerpCache({
    keyword: d.audit.keyword,
    organic,
    peopleAlsoAsk: d.queries.filter((q) => q.source === 'paa').map((q) => ({ question: q.query })),
    relatedSearches: d.queries.filter((q) => q.source === 'related').map((q) => q.query),
  });
  console.log(`Seeded "${d.audit.keyword}" with ${organic.length} results.`);
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
