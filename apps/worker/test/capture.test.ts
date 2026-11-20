import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { BlockedSiteError, ExtractionSchema, UserInputError } from '@rankforge/schema';
import { LocalDiskStorage } from '@rankforge/storage';
import { captureTarget, closeBrowser } from '../src/capture/capture.js';
import { silentLog } from '../src/lib/log.js';
import { allowLoopbackPolicy, startFixtureServer, type FixtureServer } from './helpers/fixture-server.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-capture-'));
const storage = new LocalDiskStorage(tmp);
let server: FixtureServer;

async function chromiumAvailable(): Promise<boolean> {
  try {
    const b = await chromium.launch({ headless: true });
    await b.close();
    return true;
  } catch {
    return false;
  }
}

const available = await chromiumAvailable();
const suite = available ? describe : describe.skip;

suite('captureTarget (real Chromium against a fixture store)', () => {
  beforeAll(async () => {
    server = await startFixtureServer();
  }, 30_000);

  afterAll(async () => {
    await closeBrowser();
    await server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const run = (auditId: string, pathName: string, extra: Record<string, unknown> = {}) =>
    captureTarget({
      auditId,
      url: `${server.origin}${pathName}`,
      storage,
      urlPolicy: allowLoopbackPolicy,
      logger: silentLog,
      fetchProductData: false,
      ...extra,
    });

  it('reproduces the product page and extracts a valid package', async () => {
    const { extraction, timings } = await run('cap_ok', '/products/blue-mug');
    expect(ExtractionSchema.safeParse(extraction).success).toBe(true);
    expect(extraction.meta.title).toContain('Blue Ceramic Mug');
    expect(extraction.content.h1).toBe('Blue Ceramic Mug');
    expect(extraction.platform.type).toBe('shopify');
    expect(extraction.price).toMatchObject({ selling: 1499, mrp: 1999, discountPercent: 25 });
    expect(extraction.reviews).toMatchObject({ ratingValue: 4.6, reviewCount: 128 });
    expect(extraction.variants.map((v) => v.name.toLowerCase())).toEqual(
      expect.arrayContaining(['colour', 'size'])
    );
    expect(extraction.images.some((i) => i.role === 'hero')).toBe(true);
    expect(extraction.images.filter((i) => i.role === 'gallery').length).toBeGreaterThanOrEqual(2);
    const desktopCta = extraction.ctaPositions.find((c) => c.viewport === 'desktop');
    const mobileCta = extraction.ctaPositions.find((c) => c.viewport === 'mobile');
    expect(desktopCta?.text).toMatch(/add to cart/i);
    expect(mobileCta).toBeDefined();
    expect(extraction.components.map((c) => c.kind)).toEqual(
      expect.arrayContaining(['gallery', 'addToCart', 'price', 'breadcrumb'])
    );
    expect(extraction.classWhitelist).toEqual(expect.arrayContaining(['btn', 'product__thumb', 'accordion']));
    expect(extraction.headingTree[0]?.text).toBe('Blue Ceramic Mug');
    expect(extraction.hydration.mode).toBe('server');
    expect(timings.totalMs).toBeLessThan(20_000);
  }, 60_000);

  it('blocks trackers and writes the artifact layout from spec 6.2', async () => {
    const { extraction } = await run('cap_layout', '/products/blue-mug');
    expect(extraction.stats.blockedRequests).toBeGreaterThanOrEqual(1);
    for (const key of [
      'cap_layout/target/index.html',
      'cap_layout/target/extraction.json',
      'cap_layout/target/screens/desktop.png',
      'cap_layout/target/screens/mobile.png',
    ]) {
      expect(await storage.exists(key), key).toBe(true);
    }
    const html = (await storage.get('cap_layout/target/index.html'))?.body.toString('utf8') ?? '';
    expect(html).not.toContain('googletagmanager');
    expect(html).not.toContain('cdn.shopify.com');
    expect(html).toMatch(/assets\/[0-9a-f]{20}\.css/);
    expect(html).toMatch(/assets\/[0-9a-f]{20}\.js/);
    expect(html).toContain('Content-Security-Policy');
    const css = [...html.matchAll(/assets\/([0-9a-f]{20}\.css)/g)][0]?.[1];
    const cssBody = (await storage.get(`cap_layout/target/assets/${css}`))?.body.toString('utf8') ?? '';
    expect(cssBody).not.toContain('/img/bg.png');
    expect(cssBody).toMatch(/url\(\S*[0-9a-f]{20}\.png\S*\)/);
    expect(server.requests.some((r) => r.url.includes('gtm'))).toBe(false);
  }, 60_000);

  it('stubs non-GET requests so the store never sees a cart mutation', async () => {
    server.requests.length = 0;
    const { extraction } = await run('cap_stub', '/products/blue-mug');
    expect(extraction.stats.stubbedRequests).toBe(0);
    expect(server.requests.filter((r) => r.method !== 'GET')).toEqual([]);
  }, 60_000);

  it('produces an offline snapshot whose gallery and variant selector still work', async () => {
    await run('cap_offline', '/products/blue-mug');
    const html = (await storage.get('cap_offline/target/index.html'))?.body.toString('utf8') ?? '';
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const host = 'https://offline.invalid';
      const external: string[] = [];
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== host) {
          external.push(url.toString());
          await route.abort();
          return;
        }
        const rel = url.pathname.replace(/^\//, '') || 'index.html';
        if (rel === 'index.html') {
          await route.fulfill({ status: 200, contentType: 'text/html', body: html });
          return;
        }
        const obj = await storage.get(`cap_offline/target/${rel}`);
        if (!obj) {
          await route.fulfill({ status: 404, body: '' });
          return;
        }
        await route.fulfill({ status: 200, contentType: obj.contentType, body: obj.body });
      });
      await page.goto(`${host}/index.html`, { waitUntil: 'load' });
      expect(external.filter((u) => !u.includes('127.0.0.1'))).toEqual([]);
      expect(external).toEqual([]);

      const before = await page.getAttribute('#main-image', 'src');
      await page.click('.product__thumb:nth-of-type(3)');
      expect(await page.getAttribute('#main-image', 'src')).not.toBe(before);
      await page.selectOption('#size', 'Large');
      expect(await page.textContent('#selected-variant')).toBe('Selected: Large');
      await context.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it.each([
    ['/forbidden', 'http_status'],
    ['/too-many', 'http_status'],
    ['/challenge', 'challenge_page'],
    ['/empty', 'empty_body'],
  ])('raises BlockedSiteError for %s', async (pathName, reason) => {
    const err = await run(`cap_block_${reason}`, pathName).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BlockedSiteError);
    expect((err as BlockedSiteError).reason).toBe(reason);
  }, 60_000);

  it('retries once without images when the render times out, then succeeds', async () => {
    const { extraction } = await run('cap_retry', '/slow-images', { renderTimeoutMs: 9_000 });
    expect(extraction.stats.imagesDisabled).toBe(true);
    expect(extraction.meta.title).toBe('Slow Images Product');
  }, 90_000);

  it('rejects private URLs with UserInputError under the default SSRF policy', async () => {
    const err = await captureTarget({
      auditId: 'cap_ssrf',
      url: 'http://169.254.169.254/latest/meta-data/',
      storage,
      logger: silentLog,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserInputError);
  });

  it('captures pasted HTML through the same pipeline', async () => {
    const pasted = `<html><head><title>Pasted Product</title></head><body><main><h1>Pasted Product</h1>${'<p>Descriptive product copy that is long enough to be treated as a real page by the checks. </p>'.repeat(10)}<button class="btn">Add to cart</button></main></body></html>`;
    const { extraction } = await run('cap_paste', '/products/pasted', { html: pasted });
    expect(extraction.source).toBe('html_paste');
    expect(extraction.meta.title).toBe('Pasted Product');
    expect(extraction.ctaPositions.some((c) => /add to cart/i.test(c.text))).toBe(true);
  }, 60_000);
});
