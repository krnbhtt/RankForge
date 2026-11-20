import { z } from 'zod';
import { QuotaError, UpstreamModelError, SerpResultSchema, type SerpResult } from '@rankforge/schema';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { findRepoRoot } from '@rankforge/storage';
import { withRetry } from '../lib/retry.js';

const SEARCH_API = 'https://www.searchapi.io/api/v1/search';

const RawSerpSchema = z.object({
  organic_results: z
    .array(
      z.object({
        position: z.number().optional(),
        title: z.string().optional(),
        link: z.string().optional(),
        snippet: z.string().optional(),
        domain: z.string().optional(),
      })
    )
    .default([]),
  related_questions: z.array(z.object({ question: z.string().optional(), answer: z.string().optional() })).default([]),
  related_searches: z.array(z.object({ query: z.string().optional() })).default([]),
});

function isGoogleGoto(link: string): boolean {
  try {
    const u = new URL(link);
    return u.hostname.endsWith('google.com') && u.pathname.startsWith('/goto');
  } catch {
    return false;
  }
}

function isHttpUrl(link: string): boolean {
  try {
    const u = new URL(link);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Google wraps some results in /goto redirect links. One manual hop reveals the real URL; the destination
 * is never fetched here and must still pass the SSRF guard before capture.
 */
export async function resolveGoogleGoto(link: string, doFetch: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await doFetch(link, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'Mozilla/5.0' } });
    await res.body?.cancel();
    const location = res.headers.get('location');
    return location && isHttpUrl(location) && !isGoogleGoto(location) ? location : null;
  } catch {
    return null;
  }
}

export interface SerpOptions {
  keyword: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Country and language for the search. */
  gl?: string;
  hl?: string;
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`SERP API HTTP ${status}`);
  }
}

const FRESH_MS = 24 * 3600_000;

function cacheFile(keyword: string, gl: string, hl: string): string {
  const dir = process.env.SERP_CACHE_DIR ?? path.join(findRepoRoot(), '.data', 'serp-cache');
  const key = createHash('sha256').update(`${keyword.toLowerCase().trim()}|${gl}|${hl}`).digest('hex').slice(0, 24);
  return path.join(dir, `${key}.json`);
}

function readCache(file: string): { savedAt: number; result: SerpResult } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { savedAt: number; result: unknown };
    return { savedAt: parsed.savedAt, result: SerpResultSchema.parse(parsed.result) };
  } catch {
    return null;
  }
}

/** Writes a SERP result into the cache (used on every successful fetch and to seed showcase keywords). */
export function writeSerpCache(result: SerpResult, gl = 'in', hl = 'en'): void {
  const file = cacheFile(result.keyword, gl, hl);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ savedAt: Date.now(), result }), 'utf8');
}

/**
 * SerpTool: top organic results (up to 15, so skipped competitors can be backfilled from ranks 11 to 15),
 * People Also Ask and related searches, through the SearchAPI.io Google engine.
 */
export async function fetchSerp(options: SerpOptions): Promise<SerpResult> {
  const gl = options.gl ?? 'in';
  const hl = options.hl ?? 'en';
  const file = cacheFile(options.keyword, gl, hl);
  const cached = readCache(file);
  if (cached && Date.now() - cached.savedAt < FRESH_MS) return cached.result;
  try {
    const fresh = await fetchSerpLive(options);
    if (fresh.organic.length > 0) writeSerpCache(fresh, gl, hl);
    return fresh;
  } catch (err) {
    // Quota or outage: a stale cached result is better than failing a live demo.
    if (cached) return cached.result;
    throw err;
  }
}

async function fetchSerpLive(options: SerpOptions): Promise<SerpResult> {
  const merged = await fetchSerpPage(options, 1);
  const seenDomains = new Set(merged.organic.map((o) => o.domain));
  for (let page = 2; page <= 2 && merged.organic.length < 20; page++) {
    const next = await fetchSerpPage(options, page).catch(() => null);
    if (!next) break;
    for (const o of next.organic) {
      if (seenDomains.has(o.domain)) continue;
      seenDomains.add(o.domain);
      merged.organic.push({ ...o, position: merged.organic.length + 1 });
    }
    if (!merged.peopleAlsoAsk.length) merged.peopleAlsoAsk = next.peopleAlsoAsk;
    if (!merged.relatedSearches.length) merged.relatedSearches = next.relatedSearches;
  }
  // Still thin (many results are marketplaces, videos or the same shop): widen with the top related searches.
  for (const related of merged.relatedSearches.slice(0, 2)) {
    if (merged.organic.length >= 20) break;
    const extra = await fetchSerpPage({ ...options, keyword: related }, 1).catch(() => null);
    if (!extra) continue;
    for (const o of extra.organic) {
      if (seenDomains.has(o.domain)) continue;
      seenDomains.add(o.domain);
      merged.organic.push({ ...o, position: merged.organic.length + 1 });
    }
  }
  return SerpResultSchema.parse(merged);
}

async function fetchSerpPage(options: SerpOptions, page: number): Promise<SerpResult> {
  const apiKey = options.apiKey ?? process.env.SERP_API_KEY;
  if (!apiKey) throw new UpstreamModelError('Search data is not configured.', { reason: 'missing SERP_API_KEY' });
  const doFetch = options.fetchImpl ?? fetch;
  const url = new URL(SEARCH_API);
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', options.keyword);
  url.searchParams.set('num', '15');
  url.searchParams.set('gl', options.gl ?? 'in');
  url.searchParams.set('hl', options.hl ?? 'en');
  if (page > 1) url.searchParams.set('page', String(page));

  let json: unknown;
  try {
    json = await withRetry(
      async () => {
        const res = await doFetch(url, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 429 || res.status >= 500) throw new HttpStatusError(res.status);
        if (res.status === 401 || res.status === 403) {
          throw new UpstreamModelError('The search data service rejected our credentials.', { status: res.status });
        }
        if (res.status === 402) throw new QuotaError('The search data quota is used up.', { status: 402 });
        if (!res.ok) throw new UpstreamModelError(`The search data service failed (HTTP ${res.status}).`);
        return (await res.json()) as unknown;
      },
      {
        retries: 3,
        baseDelayMs: 600,
        maxDelayMs: 6000,
        shouldRetry: (err) => err instanceof HttpStatusError || (err instanceof Error && /timeout|aborted|fetch failed/i.test(err.message)),
      }
    );
  } catch (err) {
    if (err instanceof HttpStatusError) {
      if (err.status === 429) throw new QuotaError('The search data service is busy right now.', { status: 429 });
      throw new UpstreamModelError('The search data service is temporarily unavailable.', { status: err.status });
    }
    if (err instanceof Error && /timeout|aborted|fetch failed/i.test(err.message)) {
      throw new UpstreamModelError('The search data service did not answer in time.');
    }
    throw err;
  }

  const raw = RawSerpSchema.parse(json);
  const resolvedLinks: (string | null)[] = [];
  for (let i = 0; i < raw.organic_results.length; i += 4) {
    const batch = raw.organic_results.slice(i, i + 4);
    resolvedLinks.push(
      ...(await Promise.all(
        batch.map(async (r) => {
          const link = r.link;
          if (!link || !isHttpUrl(link)) return null;
          return isGoogleGoto(link) ? resolveGoogleGoto(link, doFetch) : link;
        })
      ))
    );
  }
  const seen = new Set<string>();
  const organic = raw.organic_results
    .map((r, index) => {
      const link = resolvedLinks[index];
      if (!link) return null;
      return {
        position: r.position ?? index + 1,
        url: link,
        title: r.title ?? '',
        snippet: r.snippet ?? '',
        domain: r.domain ?? new URL(link).hostname.replace(/^www\./, ''),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .filter((r) => {
      const key = r.domain;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return SerpResultSchema.parse({
    keyword: options.keyword,
    organic,
    peopleAlsoAsk: raw.related_questions
      .filter((q) => q.question)
      .map((q) => ({ question: q.question as string, answer: q.answer })),
    relatedSearches: raw.related_searches.map((s) => s.query).filter((q): q is string => Boolean(q)),
  });
}
