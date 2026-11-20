import { GroundingResultSchema, QuotaError, UpstreamModelError, type AiCitedSource, type GroundingResult } from '@rankforge/schema';
import { safeFetch } from '@rankforge/ssrf';
import { generateGrounded, type SpendTracker } from '../ai/gemini.js';
import { log, type Logger } from '../lib/log.js';

const REDIRECT_HOST = 'vertexaisearch.cloud.google.com';
const MAX_SOURCES = 10;

export interface GroundingOptions {
  keyword: string;
  spend?: SpendTracker;
  logger?: Logger;
  auditId?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Overridable for tests. Defaults to the redirect-safe fetch. */
  resolveUrl?: (url: string) => Promise<string | null>;
}

/** Follows a Google grounding redirect to the real page URL, SSRF-checked on every hop. */
export async function resolveGroundingRedirect(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== REDIRECT_HOST) return url;
    const res = await safeFetch(url, { timeoutMs: 8000, headers: { 'user-agent': 'Mozilla/5.0' } });
    await res.body?.cancel();
    // safeFetch returns the last non-redirect response; its URL is the destination.
    return res.url && res.url !== url ? res.url : null;
  } catch {
    return null;
  }
}

/**
 * GroundingAgent (skill ai-citation-discovery): asks Gemini with Search Grounding which pages answer a
 * shopper's question, then resolves the cited sources to real URLs for the GEO view.
 */
export async function discoverAiCitedSources(options: GroundingOptions): Promise<GroundingResult> {
  const logger = options.logger ?? log;
  let raw: Awaited<ReturnType<typeof generateGrounded>>;
  try {
    raw = await generateGrounded({
    role: 'flash',
    prompt:
      `A shopper searches for "${options.keyword}". Briefly explain what matters when buying this product, ` +
      'and rely on product pages, buying guides and brand pages from the web.',
    spend: options.spend,
    logger,
    auditId: options.auditId,
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
    });
  } catch (err) {
    if (err instanceof QuotaError || err instanceof UpstreamModelError) {
      logger('warn', 'grounding unavailable; continuing without AI-cited sources', {
        auditId: options.auditId,
        stage: 'discovery',
        code: err.code,
      });
      return GroundingResultSchema.parse({
        keyword: options.keyword,
        sources: [],
        unavailableReason: 'AI-cited sources are unavailable right now (search grounding has no quota).',
      });
    }
    throw err;
  }

  const chunks = raw.groundingMetadata?.groundingChunks ?? [];
  const resolve = options.resolveUrl ?? resolveGroundingRedirect;
  const resolved = await Promise.all(
    chunks
      .filter((c) => c.web?.uri)
      .slice(0, MAX_SOURCES * 2)
      .map(async (c): Promise<AiCitedSource | null> => {
        const url = await resolve(c.web?.uri as string);
        return url ? { url, title: c.web?.title ?? '' } : null;
      })
  );

  const seen = new Set<string>();
  const sources = resolved
    .filter((s): s is AiCitedSource => s !== null)
    .filter((s) => {
      const host = new URL(s.url).hostname;
      if (seen.has(host)) return false;
      seen.add(host);
      return true;
    })
    .slice(0, MAX_SOURCES);

  logger('info', 'grounding resolved', { auditId: options.auditId, stage: 'discovery', cited: chunks.length, resolved: sources.length });
  return GroundingResultSchema.parse({
    keyword: options.keyword,
    sources,
    searchEntryPointHtml: raw.groundingMetadata?.searchEntryPoint?.renderedContent,
    searchQueries: raw.groundingMetadata?.webSearchQueries ?? [],
  });
}
