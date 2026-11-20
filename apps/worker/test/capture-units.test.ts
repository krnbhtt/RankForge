import { describe, expect, it } from 'vitest';
import { parseMoney, resolvePrice } from '../src/extract/index.js';
import { buildClassWhitelist, extractHeadingTree, extractJsonLd } from '../src/extract/static.js';
import {
  detectPlatform,
  mapShopifyProduct,
  mapWooProduct,
  shopifyHandle,
  wooSlug,
} from '../src/capture/platform.js';
import { decideHydration, injectSentinel } from '../src/capture/hydration.js';
import { withRetry } from '../src/lib/retry.js';

describe('parseMoney', () => {
  it.each([
    ['₹ 1,499.00', 1499, 'INR'],
    ['Rs. 2,999', 2999, 'INR'],
    ['$19.99', 19.99, 'USD'],
    ['€1.299,50', 1299.5, 'EUR'],
    ['£12,50', 12.5, 'GBP'],
    ['1 299,00 AED', 1299, 'AED'],
  ])('parses %s', (raw, amount, currency) => {
    expect(parseMoney(raw)).toEqual({ amount, currency });
  });
  it('returns undefined when there is no number', () => {
    expect(parseMoney('Sold out').amount).toBeUndefined();
  });
});

describe('resolvePrice', () => {
  it('picks the sale price, the struck MRP and the discount', () => {
    const p = resolvePrice(
      [
        { text: '₹ 1,999.00', struck: true, selector: 'a' },
        { text: '₹ 1,499.00', struck: false, selector: 'b' },
      ],
      '',
      []
    );
    expect(p).toMatchObject({ selling: 1499, mrp: 1999, discountPercent: 25, currency: 'INR' });
  });
  it('falls back to Product JSON-LD offers', () => {
    const p = resolvePrice([], '', [{ '@type': 'Product', offers: { price: '49.5', priceCurrency: 'USD' } }]);
    expect(p).toMatchObject({ selling: 49.5, currency: 'USD' });
  });
  it('ignores a struck value lower than the selling price', () => {
    const p = resolvePrice(
      [
        { text: '$10', struck: false, selector: 'a' },
        { text: '$5', struck: true, selector: 'b' },
      ],
      '',
      []
    );
    expect(p?.mrp).toBeUndefined();
  });
});

describe('static extraction', () => {
  it('nests headings by level and skips navigation', () => {
    const tree = extractHeadingTree(
      '<body><nav><h2>Menu</h2></nav><main><h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2></main></body>'
    );
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children.map((c) => c.text)).toEqual(['B', 'D']);
    expect(tree[0]?.children[0]?.children[0]?.text).toBe('C');
  });

  it('flattens @graph JSON-LD and skips invalid blocks', () => {
    const out = extractJsonLd(
      '<script type="application/ld+json">{"@graph":[{"@type":"Product"},{"@type":"BreadcrumbList"}]}</script><script type="application/ld+json">{bad</script>'
    );
    expect(out.map((n) => n['@type'])).toEqual(['Product', 'BreadcrumbList']);
  });

  it('whitelists only classes both used in the DOM and defined in CSS', () => {
    const list = buildClassWhitelist('<div class="btn unused-x"></div><p class="card"></p>', [
      '.btn{color:red}@media (min-width:1px){.card:hover{color:blue}.never-used{}}',
    ]);
    expect(list).toEqual(['btn', 'card']);
  });
});

describe('platform detection', () => {
  const base = { headers: {}, finalUrl: 'https://s.example.org/products/x' };
  it('detects Shopify', () => {
    const r = detectPlatform({ ...base, html: '<link href="https://cdn.shopify.com/s/a.css"><script>Shopify.theme={}</script>' });
    expect(r.type).toBe('shopify');
    expect(r.confidence).toBeGreaterThan(0.5);
  });
  it('detects WooCommerce', () => {
    const r = detectPlatform({
      ...base,
      finalUrl: 'https://s.example.org/product/x/',
      html: '<body class="single-product woocommerce"><link href="/wp-content/plugins/woocommerce/a.css">',
    });
    expect(r.type).toBe('woocommerce');
  });
  it('detects Magento', () => {
    const r = detectPlatform({ ...base, html: '<script type="text/x-magento-init">{}</script><script src="/static/version1700/frontend/Magento_Theme/x.js">' });
    expect(r.type).toBe('magento');
  });
  it('falls back to custom with low confidence', () => {
    const r = detectPlatform({ ...base, finalUrl: 'https://s.example.org/item/1', html: '<html></html>' });
    expect(r).toMatchObject({ type: 'custom', confidence: 0.3 });
  });
});

describe('platform product data', () => {
  it('maps Shopify product JSON', () => {
    const p = mapShopifyProduct({
      product: {
        title: 'T',
        handle: 'h',
        tags: 'a, b',
        variants: [{ id: 9, title: 'S', price: '10.00', compare_at_price: '12.00' }],
        options: [{ name: 'Size', values: ['S'] }],
      },
    });
    expect(p?.tags).toEqual(['a', 'b']);
    expect(p?.variants[0]).toMatchObject({ id: '9', compareAtPrice: '12.00' });
  });
  it('maps WooCommerce Store API with minor units', () => {
    const p = mapWooProduct([
      { id: 5, name: 'W', slug: 'w', prices: { price: '149900', regular_price: '199900', currency_code: 'INR', currency_minor_unit: 2 } },
    ]);
    expect(p?.variants[0]).toMatchObject({ price: '1499.00', compareAtPrice: '1999.00' });
    expect(p?.currency).toBe('INR');
  });
  it('returns null for empty responses', () => {
    expect(mapShopifyProduct({})).toBeNull();
    expect(mapWooProduct([])).toBeNull();
  });
  it('derives handles and slugs from URLs', () => {
    expect(shopifyHandle('https://s.org/collections/c/products/blue-mug?variant=1')).toBe('blue-mug');
    expect(wooSlug('https://s.org/product/herbal-tea/')).toBe('herbal-tea');
  });
});

describe('hydration decision', () => {
  it('uses survival when available', () => {
    expect(decideHydration({ framework: 'next', signals: [] }, true).mode).toBe('server');
    expect(decideHydration({ framework: 'none', signals: [] }, false).mode).toBe('runtime');
  });
  it('falls back to framework markers when the test cannot run', () => {
    expect(decideHydration({ framework: 'react', signals: [] }, null)).toMatchObject({
      mode: 'runtime',
      sentinelSurvived: null,
    });
    expect(decideHydration({ framework: 'none', signals: [] }, null).mode).toBe('server');
  });
  it('injects the sentinel into main and the first heading', () => {
    const out = injectSentinel('<body><main><h1 class="t">Hi</h1></main></body>');
    expect(out).toContain('data-rf-sentinel');
    expect(out).toMatch(/<h1 class="t">RF-SENTINEL/);
  });
});

describe('withRetry', () => {
  it('retries with backoff and jitter then succeeds', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('flaky');
        return 'ok';
      },
      { retries: 3, baseDelayMs: 100, sleep: async (ms) => void sleeps.push(ms), random: () => 0.5 }
    );
    expect(result).toBe('ok');
    expect(sleeps).toEqual([50, 100]);
  });
  it('throws the last error after exhausting retries and honours shouldRetry', async () => {
    await expect(
      withRetry(async () => Promise.reject(new Error('nope')), { retries: 2, baseDelayMs: 1, sleep: async () => undefined })
    ).rejects.toThrow('nope');
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('fatal');
        },
        { retries: 5, baseDelayMs: 1, shouldRetry: () => false, sleep: async () => undefined }
      )
    ).rejects.toThrow('fatal');
    expect(calls).toBe(1);
  });
});
