import {
  PlatformProductDataSchema,
  type PlatformInfo,
  type PlatformProductData,
  type PlatformType,
} from '@rankforge/schema';
import { safeFetch } from '@rankforge/ssrf';
import { withRetry } from '../lib/retry.js';

interface Rule {
  signal: string;
  weight: number;
  test: (ctx: DetectInput) => boolean;
}

export interface DetectInput {
  html: string;
  headers: Record<string, string>;
  finalUrl: string;
}

const RULES: Record<Exclude<PlatformType, 'custom' | 'unknown'>, Rule[]> = {
  shopify: [
    { signal: 'cdn.shopify.com assets', weight: 3, test: (c) => c.html.includes('cdn.shopify.com') },
    { signal: 'Shopify global object', weight: 3, test: (c) => /Shopify\.(theme|shop|locale)\b/.test(c.html) },
    { signal: 'shopify-checkout-api-token meta', weight: 2, test: (c) => c.html.includes('shopify-checkout-api-token') },
    { signal: 'x-shopid header', weight: 3, test: (c) => 'x-shopid' in c.headers || 'x-shopify-stage' in c.headers },
    { signal: '/products/ path', weight: 1, test: (c) => /\/products\/[^/]+/.test(new URL(c.finalUrl).pathname) },
  ],
  woocommerce: [
    { signal: 'woocommerce plugin assets', weight: 3, test: (c) => c.html.includes('/wp-content/plugins/woocommerce') },
    { signal: 'woocommerce body class', weight: 3, test: (c) => /<body[^>]*class="[^"]*\bwoocommerce\b/.test(c.html) },
    { signal: 'wc-ajax endpoint', weight: 2, test: (c) => c.html.includes('wc-ajax') || c.html.includes('wc_add_to_cart_params') },
    { signal: 'single-product body class', weight: 1, test: (c) => /<body[^>]*class="[^"]*\bsingle-product\b/.test(c.html) },
  ],
  magento: [
    { signal: 'Magento_ module paths', weight: 3, test: (c) => /Magento_[A-Za-z]+\//.test(c.html) },
    { signal: 'data-mage-init attribute', weight: 3, test: (c) => c.html.includes('data-mage-init') || c.html.includes('text/x-magento-init') },
    { signal: 'static/version asset path', weight: 2, test: (c) => /\/static\/version\d+\//.test(c.html) },
    { signal: 'mage/ requirejs config', weight: 2, test: (c) => c.html.includes('mage/requirejs') },
  ],
  bigcommerce: [
    { signal: 'bigcommerce CDN', weight: 3, test: (c) => c.html.includes('cdn11.bigcommerce.com') },
    { signal: 'BCData global', weight: 2, test: (c) => c.html.includes('BCData') },
  ],
};

const MIN_SCORE = 3;

export function detectPlatform(input: DetectInput): PlatformInfo {
  let best: { type: PlatformType; score: number; max: number; signals: string[] } | null = null;
  for (const [type, rules] of Object.entries(RULES) as [PlatformType, Rule[]][]) {
    const hits = rules.filter((r) => {
      try {
        return r.test(input);
      } catch {
        return false;
      }
    });
    const score = hits.reduce((n, r) => n + r.weight, 0);
    const max = rules.reduce((n, r) => n + r.weight, 0);
    if (score >= MIN_SCORE && (!best || score > best.score)) {
      best = { type, score, max, signals: hits.map((h) => h.signal) };
    }
  }
  if (!best) return { type: 'custom', confidence: 0.3, signals: [] };
  return {
    type: best.type,
    confidence: Math.min(1, Math.round((best.score / (best.max * 0.6)) * 100) / 100),
    signals: best.signals,
  };
}

const PRODUCT_DATA_TIMEOUT_MS = 8000;

function fetchJson(url: string): Promise<unknown | null> {
  return withRetry(
    async () => {
      const res = await safeFetch(url, {
        timeoutMs: PRODUCT_DATA_TIMEOUT_MS,
        headers: { accept: 'application/json', 'user-agent': 'RankForgeBot/1.0 (+product audit)' },
      });
      if (res.status === 404 || res.status === 403 || res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('json')) return null;
      return (await res.json()) as unknown;
    },
    { retries: 1, baseDelayMs: 300 }
  ).catch(() => null);
}

export function shopifyHandle(finalUrl: string): string | null {
  const m = new URL(finalUrl).pathname.match(/\/products\/([^/?#]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

interface ShopifyProductJson {
  product?: {
    title?: string;
    handle?: string;
    vendor?: string;
    product_type?: string;
    tags?: string | string[];
    body_html?: string;
    images?: { src?: string; alt?: string | null }[];
    options?: { name?: string; values?: string[] }[];
    variants?: {
      id?: number | string;
      title?: string;
      price?: string;
      compare_at_price?: string | null;
      sku?: string;
      available?: boolean;
    }[];
  };
}

export function mapShopifyProduct(json: unknown): PlatformProductData | null {
  const p = (json as ShopifyProductJson | null)?.product;
  if (!p?.title) return null;
  const tags = Array.isArray(p.tags) ? p.tags : (p.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const parsed = PlatformProductDataSchema.safeParse({
    source: 'shopify_json',
    title: p.title,
    handle: p.handle,
    vendor: p.vendor,
    productType: p.product_type,
    tags,
    descriptionHtml: p.body_html ?? '',
    images: (p.images ?? []).filter((i) => i.src).map((i) => ({ src: i.src as string, alt: i.alt ?? '' })),
    variants: (p.variants ?? []).map((v) => ({
      id: v.id ?? '',
      title: v.title ?? '',
      price: v.price,
      compareAtPrice: v.compare_at_price ?? undefined,
      sku: v.sku || undefined,
      available: v.available,
    })),
    options: (p.options ?? []).map((o) => ({ name: o.name ?? '', values: o.values ?? [] })),
  });
  return parsed.success ? parsed.data : null;
}

interface WooStoreProduct {
  id?: number;
  name?: string;
  slug?: string;
  description?: string;
  sku?: string;
  prices?: { price?: string; regular_price?: string; currency_code?: string; currency_minor_unit?: number };
  images?: { src?: string; alt?: string }[];
  categories?: { name?: string }[];
  tags?: { name?: string }[];
  is_in_stock?: boolean;
  attributes?: { name?: string; terms?: { name?: string }[] }[];
}

export function mapWooProduct(json: unknown): PlatformProductData | null {
  const first = Array.isArray(json) ? (json[0] as WooStoreProduct | undefined) : undefined;
  if (!first?.name) return null;
  const minor = first.prices?.currency_minor_unit ?? 2;
  const fmt = (v?: string) => (v ? (Number(v) / 10 ** minor).toFixed(minor) : undefined);
  const parsed = PlatformProductDataSchema.safeParse({
    source: 'woocommerce_store_api',
    title: first.name,
    handle: first.slug,
    productType: first.categories?.[0]?.name,
    tags: (first.tags ?? []).map((t) => t.name).filter(Boolean),
    descriptionHtml: first.description ?? '',
    images: (first.images ?? []).filter((i) => i.src).map((i) => ({ src: i.src as string, alt: i.alt ?? '' })),
    variants: [
      {
        id: first.id ?? '',
        title: first.name,
        price: fmt(first.prices?.price),
        compareAtPrice: first.prices?.regular_price !== first.prices?.price ? fmt(first.prices?.regular_price) : undefined,
        sku: first.sku || undefined,
        available: first.is_in_stock,
      },
    ],
    options: (first.attributes ?? []).map((a) => ({
      name: a.name ?? '',
      values: (a.terms ?? []).map((t) => t.name ?? '').filter(Boolean),
    })),
    currency: first.prices?.currency_code,
  });
  return parsed.success ? parsed.data : null;
}

export function wooSlug(finalUrl: string): string | null {
  const segments = new URL(finalUrl).pathname.split('/').filter(Boolean);
  const idx = segments.findIndex((s) => s === 'product' || s === 'products' || s === 'shop');
  const candidate = idx >= 0 ? segments[idx + 1] : segments[segments.length - 1];
  return candidate ? decodeURIComponent(candidate) : null;
}

/** Fetches platform product data where a public API exists. Returns undefined when unavailable. */
export async function fetchPlatformProductData(
  platform: PlatformType,
  finalUrl: string
): Promise<PlatformProductData | undefined> {
  const origin = new URL(finalUrl).origin;
  if (platform === 'shopify') {
    const handle = shopifyHandle(finalUrl);
    if (!handle) return undefined;
    const json = await fetchJson(`${origin}/products/${encodeURIComponent(handle)}.json`);
    return json ? (mapShopifyProduct(json) ?? undefined) : undefined;
  }
  if (platform === 'woocommerce') {
    const slug = wooSlug(finalUrl);
    if (!slug) return undefined;
    const json = await fetchJson(`${origin}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(slug)}`);
    return json ? (mapWooProduct(json) ?? undefined) : undefined;
  }
  return undefined;
}
