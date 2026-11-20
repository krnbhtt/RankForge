import type { Page } from 'playwright';
import {
  EXTRACTION_VERSION,
  ExtractionSchema,
  type CtaPosition,
  type Extraction,
  type ExtractedPrice,
  type HydrationInfo,
  type PlatformInfo,
} from '@rankforge/schema';
import { LAYOUT_SCRIPT } from './layout-script.js';
import {
  buildClassWhitelist,
  extractContent,
  extractHeadingTree,
  extractJsonLd,
  extractMeta,
  extractReviews,
} from './static.js';

export interface LayoutData {
  images: Extraction['images'];
  priceCandidates: { text: string; struck: boolean; selector: string }[];
  priceCurrency: string;
  variants: Extraction['variants'];
  ctas: { text: string; selector: string; top: number; aboveFold: boolean; sticky: boolean; heightPx?: number }[];
  designTokens: Extraction['designTokens'];
  components: Extraction['components'];
  pageHeight: number;
}

export async function collectLayout(page: Page): Promise<LayoutData> {
  return (await page.evaluate(LAYOUT_SCRIPT)) as LayoutData;
}

const CURRENCY_SYMBOLS: [RegExp, string][] = [
  [/₹|\bRs\.?\b|\bINR\b/i, 'INR'],
  [/€|\bEUR\b/i, 'EUR'],
  [/£|\bGBP\b/i, 'GBP'],
  [/\bAED\b/i, 'AED'],
  [/\bCAD\b|C\$/i, 'CAD'],
  [/\bAUD\b|A\$/i, 'AUD'],
  [/\$|\bUSD\b/i, 'USD'],
];

export function parseMoney(raw: string): { amount: number | undefined; currency: string | undefined } {
  const currency = CURRENCY_SYMBOLS.find(([re]) => re.test(raw))?.[1];
  const numeric = raw.match(/\d[\d.,\s]*/)?.[0]?.replace(/\s/g, '').replace(/[.,]+$/, '');
  if (!numeric) return { amount: undefined, currency };
  const lastDot = numeric.lastIndexOf('.');
  const lastComma = numeric.lastIndexOf(',');
  let normalised: string;
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    normalised = numeric
      .split(decimalSep === '.' ? ',' : '.')
      .join('')
      .replace(decimalSep, '.');
  } else if (lastComma !== -1) {
    const after = numeric.length - lastComma - 1;
    normalised = after === 2 ? numeric.replace(',', '.') : numeric.replace(/,/g, '');
  } else {
    normalised = numeric;
  }
  const amount = Number(normalised);
  return { amount: Number.isFinite(amount) ? amount : undefined, currency };
}

export function resolvePrice(
  candidates: LayoutData['priceCandidates'],
  currencyHint: string,
  jsonLd: Record<string, unknown>[]
): ExtractedPrice | undefined {
  const parsed = candidates
    .map((c) => ({ ...c, ...parseMoney(c.text) }))
    .filter((c) => c.amount !== undefined && c.amount > 0);
  const selling = parsed.find((c) => !c.struck);
  const struckValues = parsed.filter((c) => c.struck && selling && (c.amount as number) > (selling.amount as number));
  const mrp = struckValues[0];

  let sellingAmount = selling?.amount;
  let currency = currencyHint || selling?.currency;
  let raw = selling?.text;
  if (sellingAmount === undefined) {
    const product = jsonLd.find((n) => n['@type'] === 'Product');
    const offers = product?.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
    const offer = Array.isArray(offers) ? offers[0] : offers;
    const price = offer?.price ?? offer?.lowPrice;
    if (price !== undefined) {
      sellingAmount = Number(price);
      currency = currency ?? (offer?.priceCurrency as string | undefined);
      raw = String(price);
    }
  }
  if (sellingAmount === undefined || !Number.isFinite(sellingAmount) || !raw) return undefined;
  const mrpAmount = mrp?.amount;
  return {
    raw,
    currency,
    selling: sellingAmount,
    mrp: mrpAmount,
    discountPercent:
      mrpAmount && mrpAmount > sellingAmount ? Math.round(((mrpAmount - sellingAmount) / mrpAmount) * 100) : undefined,
  };
}

export interface BuildExtractionInput {
  auditId: string;
  sourceUrl: string;
  finalUrl: string;
  html: string;
  source: Extraction['source'];
  platform: PlatformInfo;
  hydration: HydrationInfo;
  cssTexts: string[];
  mobile: LayoutData | null;
  desktop: LayoutData;
  stats: Extraction['stats'];
  pageSignals?: Extraction['pageSignals'];
  now?: Date;
}

/** Assembles and validates the extraction package from static HTML analysis and layout data. */
export function buildExtraction(input: BuildExtractionInput): Extraction {
  const { html, desktop, mobile } = input;
  const jsonLd = extractJsonLd(html);

  const ctaPositions: CtaPosition[] = [
    ...desktop.ctas.map((c) => ({ ...c, viewport: 'desktop' as const })),
    ...(mobile?.ctas ?? []).map((c) => ({ ...c, viewport: 'mobile' as const })),
  ];

  const extraction: Extraction = {
    version: EXTRACTION_VERSION,
    auditId: input.auditId,
    sourceUrl: input.sourceUrl,
    finalUrl: input.finalUrl,
    capturedAt: (input.now ?? new Date()).toISOString(),
    source: input.source,
    platform: input.platform,
    hydration: input.hydration,
    meta: extractMeta(html),
    content: extractContent(html),
    headingTree: extractHeadingTree(html),
    jsonLd,
    images: desktop.images,
    price: resolvePrice(desktop.priceCandidates, desktop.priceCurrency, jsonLd),
    variants: desktop.variants,
    reviews: extractReviews(html, jsonLd),
    ctaPositions,
    designTokens: desktop.designTokens,
    components: desktop.components,
    classWhitelist: buildClassWhitelist(html, input.cssTexts),
    pageSignals: input.pageSignals,
    stats: input.stats,
  };
  return ExtractionSchema.parse(extraction);
}
