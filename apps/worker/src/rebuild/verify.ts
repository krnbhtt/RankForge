import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { PatchOp } from '@rankforge/schema';
import type { ArtifactStorage } from '@rankforge/storage';

const HOST = 'https://optimised.invalid';
const DAMAGE_PIXEL_PCT = 2;
const MAX_HEIGHT = 6000;

export interface OfflinePage {
  page: Page;
  context: BrowserContext;
  errors: () => number;
  close: () => Promise<void>;
}

/** Opens HTML in a fresh browser, serving the captured assets from storage and blocking store scripts' network use. */
export async function openOffline(
  browser: Browser,
  storage: ArtifactStorage,
  auditId: string,
  html: string,
  viewport: { width: number; height: number } = { width: 1440, height: 900 },
  mobile = false
): Promise<OfflinePage> {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'en-IN' });
  const page = await context.newPage();
  let errors = 0;
  page.on('pageerror', () => errors++);
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Content Security Policy|Failed to load resource/i.test(m.text())) errors++;
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === HOST) {
      const rel = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'index.html';
      if (rel === 'index.html') {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
        return;
      }
      const obj = await storage.get(`${auditId}/target/${rel}`).catch(() => null);
      if (!obj) {
        await route.fulfill({ status: 404, body: '' });
        return;
      }
      await route.fulfill({ status: 200, contentType: obj.contentType, body: obj.body });
      return;
    }
    if (['image', 'font', 'media', 'stylesheet'].includes(route.request().resourceType())) {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
  });
  await page.goto(`${HOST}/index.html`, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  return { page, context, errors: () => errors, close: () => context.close() };
}

async function fullScreenshot(page: Page): Promise<Buffer> {
  const height = Math.min((await page.evaluate('document.documentElement.scrollHeight')) as number, MAX_HEIGHT);
  const width = (await page.evaluate('window.innerWidth')) as number;
  return page.screenshot({ type: 'png', fullPage: true, clip: { x: 0, y: 0, width, height } });
}

/** Percentage of differing pixels in the top `cropHeight` rows of two screenshots. */
export function topDiffPercent(a: Buffer, b: Buffer, cropHeight: number): number {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  const w = Math.min(pa.width, pb.width);
  const h = Math.max(1, Math.min(pa.height, pb.height, Math.floor(cropHeight)));
  const crop = (img: PNG) => {
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(img, out, 0, 0, w, h, 0, 0);
    return out;
  };
  const diff = pixelmatch(crop(pa).data, crop(pb).data, undefined, w, h, { threshold: 0.1 });
  return Math.round((diff / (w * h)) * 10_000) / 100;
}

export interface SectionVerdict {
  sectionId: string;
  ok: boolean;
  reason?: string;
  newErrors: number;
  overflowGrowthPx: number;
  aboveRegionDiffPct?: number;
}

export interface VerifyReport {
  sections: SectionVerdict[];
  baselineErrors: number;
  finalErrors: number;
  interaction: string;
}

const INTERACTION_SCRIPT = `(() => {
  const thumb = document.querySelector('[class*="thumb" i] img, [class*="thumbnail" i] img, [data-thumb], [class*="gallery" i] button, [class*="slick-dots" i] button');
  const radio = document.querySelector('input[type="radio"]:not(:checked)');
  const select = Array.from(document.querySelectorAll('select')).find((s) => s.options.length > 1);
  const done = [];
  if (thumb) { thumb.click(); done.push('gallery'); }
  if (radio) { radio.click(); done.push('variant'); }
  else if (select) { select.selectedIndex = Math.min(1, select.options.length - 1); select.dispatchEvent(new Event('change', { bubbles: true })); done.push('variant'); }
  return done.length ? done.join('+') : 'none-found';
})()`;

export interface VerifyOptions {
  browser: Browser;
  storage: ArtifactStorage;
  auditId: string;
  /** Renders HTML for a list of operations (server or runtime mode). */
  render: (ops: PatchOp[]) => string;
  /** Operations grouped in application order; deterministic fixes first, then one entry per section. */
  fixOps: PatchOp[];
  sectionOps: PatchOp[];
}

/**
 * VerifyTool (spec F6.6): each section is applied on top of the ones before it in a fresh browser. A section is dropped
 * if it adds console errors, makes the page scroll sideways, or changes the pixels above where it was inserted by more
 * than 2%. The final page also gets a click test on the variant selector and image gallery.
 */
export async function verifyOptimised(options: VerifyOptions): Promise<VerifyReport> {
  const { browser, storage, auditId } = options;
  const baselineOps = [...options.fixOps];
  const base = await openOffline(browser, storage, auditId, options.render(baselineOps));
  const baseShot = await fullScreenshot(base.page);
  const baseOverflow = (await base.page.evaluate('document.documentElement.scrollWidth - window.innerWidth')) as number;
  const baselineErrors = base.errors();
  await base.close();

  const verdicts: SectionVerdict[] = [];
  const accepted: PatchOp[] = [...baselineOps];
  for (const op of options.sectionOps) {
    const trial = [...accepted, op];
    let verdict: SectionVerdict;
    const opened = await openOffline(browser, storage, auditId, options.render(trial)).catch((err: Error) => err);
    if (opened instanceof Error) {
      verdict = { sectionId: op.sectionId, ok: false, reason: `The page failed to load with this section: ${opened.message.slice(0, 120)}`, newErrors: 0, overflowGrowthPx: 0 };
    } else {
      const overflow = (await opened.page.evaluate('document.documentElement.scrollWidth - window.innerWidth')) as number;
      const newErrors = Math.max(0, opened.errors() - baselineErrors);
      const probe = (await opened.page.evaluate(
        `(() => { const el = document.querySelector('[data-rf-section="${op.sectionId}"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top + window.scrollY, fixed: getComputedStyle(el).position === 'fixed' }; })()`
      )) as { top: number; fixed: boolean } | null;
      let regionDiff: number | undefined;
      if (probe && !probe.fixed && probe.top > 150) {
        regionDiff = topDiffPercent(baseShot, await fullScreenshot(opened.page), probe.top - 20);
      }
      await opened.close();
      const overflowGrowth = Math.max(0, overflow - baseOverflow);
      let reason: string | undefined;
      if (newErrors > 0) reason = `It caused ${newErrors} new script error${newErrors === 1 ? '' : 's'}.`;
      else if (overflowGrowth > 4) reason = `It made the page scroll sideways by ${overflowGrowth}px.`;
      else if (regionDiff !== undefined && regionDiff > DAMAGE_PIXEL_PCT) reason = `It changed ${regionDiff}% of the pixels above where it was inserted.`;
      verdict = { sectionId: op.sectionId, ok: !reason, reason, newErrors, overflowGrowthPx: overflowGrowth, aboveRegionDiffPct: regionDiff };
    }
    verdicts.push(verdict);
    if (verdict.ok) accepted.push(op);
  }

  const final = await openOffline(browser, storage, auditId, options.render(accepted));
  const before = final.errors();
  const interaction = (await final.page.evaluate(INTERACTION_SCRIPT)) as string;
  await final.page.waitForTimeout(400);
  const finalErrors = final.errors();
  await final.close();
  return {
    sections: verdicts,
    baselineErrors,
    finalErrors,
    interaction: finalErrors > before ? 'script-error' : interaction,
  };
}
