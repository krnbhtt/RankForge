import { z } from 'zod';
import { withRetry } from '../lib/retry.js';
import type { Logger } from '../lib/log.js';
import { log } from '../lib/log.js';

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export interface CoreWebVitals {
  lcpSeconds?: number;
  inpMs?: number;
  cls?: number;
  /** Where the numbers come from. */
  source: 'field' | 'lab' | 'mixed';
}

const NumericAudit = z.object({ numericValue: z.number().optional() }).partial();
const PsiSchema = z.object({
  lighthouseResult: z
    .object({ audits: z.record(z.string(), NumericAudit).default({}) })
    .optional(),
  loadingExperience: z
    .object({
      metrics: z
        .record(z.string(), z.object({ percentile: z.number().optional() }))
        .optional(),
    })
    .optional(),
});

/** Maps a PageSpeed Insights response to Core Web Vitals, preferring field data over lab data. */
export function parsePsi(json: unknown): CoreWebVitals | null {
  const parsed = PsiSchema.safeParse(json);
  if (!parsed.success) return null;
  const lab = parsed.data.lighthouseResult?.audits ?? {};
  const field = parsed.data.loadingExperience?.metrics ?? {};

  const labLcp = lab['largest-contentful-paint']?.numericValue;
  const labCls = lab['cumulative-layout-shift']?.numericValue;
  const fieldLcp = field.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
  const fieldCls = field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;
  const fieldInp = field.INTERACTION_TO_NEXT_PAINT?.percentile;

  const lcpMs = fieldLcp ?? labLcp;
  const cls = fieldCls !== undefined ? fieldCls / 100 : labCls;
  if (lcpMs === undefined && cls === undefined && fieldInp === undefined) return null;

  const usedField = fieldLcp !== undefined || fieldCls !== undefined || fieldInp !== undefined;
  const usedLab = (fieldLcp === undefined && labLcp !== undefined) || (fieldCls === undefined && labCls !== undefined);
  return {
    lcpSeconds: lcpMs !== undefined ? Math.round((lcpMs / 1000) * 100) / 100 : undefined,
    inpMs: fieldInp,
    cls: cls !== undefined ? Math.round(cls * 1000) / 1000 : undefined,
    source: usedField && usedLab ? 'mixed' : usedField ? 'field' : 'lab',
  };
}

export interface PsiOptions {
  url: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  timeoutMs?: number;
}

/**
 * Core Web Vitals through the PageSpeed Insights API (mobile strategy). Returns null when the service is
 * unavailable so the audit can continue and report the metric as not measured.
 */
export async function fetchCoreWebVitals(options: PsiOptions): Promise<CoreWebVitals | null> {
  const logger = options.logger ?? log;
  const doFetch = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey ?? process.env.PSI_API_KEY;
  const url = new URL(PSI_ENDPOINT);
  url.searchParams.set('url', options.url);
  url.searchParams.set('strategy', 'mobile');
  url.searchParams.set('category', 'performance');
  if (apiKey) url.searchParams.set('key', apiKey);

  try {
    const json = await withRetry(
      async () => {
        const res = await doFetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 60_000) });
        if (res.status === 429 || res.status >= 500) throw new Error(`PSI HTTP ${res.status}`);
        if (!res.ok) return null;
        return (await res.json()) as unknown;
      },
      { retries: 1, baseDelayMs: 1500, maxDelayMs: 4000, shouldRetry: (e) => e instanceof Error && /HTTP 5|HTTP 429|timeout|aborted|fetch failed/i.test(e.message) }
    );
    return json ? parsePsi(json) : null;
  } catch (err) {
    logger('warn', 'PageSpeed Insights unavailable; Core Web Vitals not measured', {
      stage: 'analysis',
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
