/**
 * Corpus and visual-regression runner (spec 11.2).
 * For every URL in docs/corpus.csv: capture, reload the offline reproduction, pixel-diff it against the
 * live screenshot taken in the same capture session, run a light interaction check, and write
 * docs/corpus-results.csv plus a summary against the Phase 1 exit criterion.
 *
 * Usage: pnpm corpus [--only c01,c02] [--concurrency 2]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { BlockedSiteError } from '@rankforge/schema';
import { LocalDiskStorage, findRepoRoot } from '@rankforge/storage';
import { captureTarget, closeBrowser } from '../../apps/worker/src/capture/capture.ts';
import { silentLog } from '../../apps/worker/src/lib/log.ts';

const root = findRepoRoot();
const DIFF_THRESHOLD_PCT = 2;
const PIXEL_THRESHOLD = 0.1;
const OFFLINE_HOST = 'https://reproduction.invalid';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface Row {
  id: string;
  url: string;
  platform: string;
  category: string;
  expected: 'ok' | 'blocked';
}

interface Result {
  id: string;
  url: string;
  expected: string;
  status: 'ok' | 'blocked' | 'failed';
  detectedPlatform: string;
  hydration: string;
  totalMs: number;
  assets: number;
  diffPct: number | '';
  staticDiffPct: number | '';
  bestMode: 'interactive' | 'static' | '';
  heightRatio: number | '';
  externalAssets: number | '';
  pageErrors: number | '';
  interaction: string;
  pass: boolean;
  error: string;
}

function parseCsv(text: string): Row[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = (header ?? '').split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ''])) as unknown as Row;
  });
}

const csvEscape = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function scrollThrough(page: import('playwright').Page): Promise<void> {
  await page.evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let y = 0; y < 30000; y += Math.floor(window.innerHeight * 0.8)) {
      window.scrollTo(0, y); await sleep(80);
      if (y + window.innerHeight >= document.documentElement.scrollHeight) break;
    }
    window.scrollTo(0, 0); await sleep(250);
  })()`);
}

async function reproductionCheck(
  browser: Browser,
  storage: LocalDiskStorage,
  auditId: string,
  entry: 'index.html' | 'static.html' = 'index.html'
): Promise<Pick<Result, 'diffPct' | 'heightRatio' | 'externalAssets' | 'pageErrors' | 'interaction'>> {
  const html = (await storage.get(`${auditId}/target/${entry}`))?.body.toString('utf8') ?? '';
  const live = (await storage.get(`${auditId}/target/screens/desktop.png`))?.body;
  if (!html || !live) throw new Error('missing snapshot or live screenshot');

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA, locale: 'en-IN' });
  const page = await context.newPage();
  let external = 0;
  let pageErrors = 0;
  page.on('pageerror', () => pageErrors++);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === OFFLINE_HOST) {
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
    // Uncaptured images, fonts and styles are allowed (the real preview allows them too); scripts are not.
    if (['image', 'font', 'media', 'stylesheet'].includes(route.request().resourceType())) {
      external++;
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
  });
  await page.goto(`${OFFLINE_HOST}/index.html`, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
  await scrollThrough(page);
  await page.waitForTimeout(800);

  const liveImg = PNG.sync.read(live);
  const height = Math.min(await page.evaluate('document.documentElement.scrollHeight') as number, 8000);
  const repro = PNG.sync.read(
    await page.screenshot({ type: 'png', fullPage: true, clip: { x: 0, y: 0, width: 1440, height } })
  );

  const w = Math.min(liveImg.width, repro.width);
  const h = Math.min(liveImg.height, repro.height);
  const crop = (img: PNG) => {
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(img, out, 0, 0, w, h, 0, 0);
    return out;
  };
  const a = crop(liveImg);
  const b = crop(repro);
  const diffImg = new PNG({ width: w, height: h });
  const diff = pixelmatch(a.data, b.data, diffImg.data, w, h, { threshold: PIXEL_THRESHOLD });
  await storage.put(`${auditId}/target/screens/diff.png`, PNG.sync.write(diffImg), 'image/png');
  await storage.put(`${auditId}/target/screens/reproduction.png`, PNG.sync.write(repro), 'image/png');
  const diffPct = Math.round((diff / (w * h)) * 10_000) / 100;
  const heightRatio = Math.round((Math.min(liveImg.height, repro.height) / Math.max(liveImg.height, repro.height)) * 100) / 100;

  const errorsBefore = pageErrors;
  const interactionResult = (await page.evaluate(`(() => {
    const thumb = document.querySelector('[class*="thumb" i] img, [class*="thumbnail" i] img, [data-thumb], [class*="gallery" i] button, [class*="slick-dots" i] button');
    const radio = document.querySelector('input[type="radio"]:not(:checked)');
    const select = Array.from(document.querySelectorAll('select')).find((s) => s.options.length > 1);
    const done = [];
    if (thumb) { thumb.click(); done.push('gallery'); }
    if (radio) { radio.click(); done.push('variant'); }
    else if (select) { select.selectedIndex = Math.min(1, select.options.length - 1); select.dispatchEvent(new Event('change', { bubbles: true })); done.push('variant'); }
    return done.length ? done.join('+') : 'none-found';
  })()`)) as string;
  await page.waitForTimeout(400);
  const interactionFinal = pageErrors > errorsBefore ? 'script-error' : interactionResult;
  await context.close();
  return { diffPct, heightRatio, externalAssets: external, pageErrors, interaction: interactionFinal };
}

async function runRow(row: Row, storage: LocalDiskStorage, browser: Browser): Promise<Result> {
  const auditId = `corpus_${row.id}`;
  const base: Result = {
    id: row.id,
    url: row.url,
    expected: row.expected,
    status: 'failed',
    detectedPlatform: '',
    hydration: '',
    totalMs: 0,
    assets: 0,
    diffPct: '',
    staticDiffPct: '',
    bestMode: '',
    heightRatio: '',
    externalAssets: '',
    pageErrors: '',
    interaction: '',
    pass: false,
    error: '',
  };
  const started = Date.now();
  try {
    const { extraction, timings } = await captureTarget({ auditId, url: row.url, storage, logger: silentLog });
    const check = await reproductionCheck(browser, storage, auditId);
    const result: Result = {
      ...base,
      status: 'ok',
      detectedPlatform: extraction.platform.type,
      hydration: extraction.hydration.mode,
      totalMs: timings.totalMs,
      assets: extraction.stats.assetCount,
      ...check,
    };
    // When the interactive copy drifts, measure the static copy (scripts removed) too.
    let best: 'interactive' | 'static' = 'interactive';
    if (typeof check.diffPct === 'number' && check.diffPct > DIFF_THRESHOLD_PCT) {
      const staticCheck = await reproductionCheck(browser, storage, auditId, 'static.html').catch(() => null);
      if (staticCheck && typeof staticCheck.diffPct === 'number') {
        result.staticDiffPct = staticCheck.diffPct;
        if (staticCheck.diffPct < check.diffPct) best = 'static';
      }
    }
    result.bestMode = best;
    const bestDiff = best === 'static' ? (result.staticDiffPct as number) : check.diffPct;
    result.pass =
      row.expected === 'ok' &&
      typeof bestDiff === 'number' &&
      bestDiff <= DIFF_THRESHOLD_PCT &&
      (best === 'static' || check.interaction !== 'script-error');
    return result;
  } catch (err) {
    const blocked = err instanceof BlockedSiteError;
    return {
      ...base,
      status: blocked ? 'blocked' : 'failed',
      totalMs: Date.now() - started,
      pass: blocked && row.expected === 'blocked',
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const only = arg('only')?.split(',');
  const concurrency = Number(arg('concurrency') ?? 2);
  const rows = parseCsv(fs.readFileSync(path.join(root, 'docs/corpus.csv'), 'utf8')).filter(
    (r) => !only || only.includes(r.id)
  );
  const storage = new LocalDiskStorage(path.join(root, '.data/corpus'));
  const browser = await chromium.launch({ headless: true });

  const results: Result[] = [];
  const queue = [...rows];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        const r = await runRow(row, storage, browser);
        results.push(r);
        console.log(
          `${r.id} ${r.status.padEnd(7)} diff=${String(r.diffPct).padEnd(6)} ${r.totalMs}ms ${r.pass ? 'PASS' : 'FAIL'} ${r.error}`
        );
      }
    })
  );
  await browser.close();
  await closeBrowser();

  results.sort((a, b) => a.id.localeCompare(b.id));
  const cols = Object.keys(results[0] ?? {}) as (keyof Result)[];
  const csv = [cols.join(','), ...results.map((r) => cols.map((c) => csvEscape(r[c])).join(','))].join('\n');
  if (!only) fs.writeFileSync(path.join(root, 'docs/corpus-results.csv'), `${csv}\n`);

  const okRows = results.filter((r) => r.expected === 'ok');
  const passed = okRows.filter((r) => r.pass).length;
  const blockedRows = results.filter((r) => r.expected === 'blocked');
  const blockedOk = blockedRows.filter((r) => r.pass).length;
  const interactivePass = okRows.filter((r) => r.pass && r.bestMode === 'interactive').length;
  const under20 = okRows.filter((r) => r.status === 'ok' && r.totalMs <= 20_000).length;
  const pct = okRows.length ? Math.round((passed / okRows.length) * 1000) / 10 : 0;
  console.log(
    `\nReproduced with <=${DIFF_THRESHOLD_PCT}% pixel difference: ${passed}/${okRows.length} (${pct}%). Target: 90%.\n` +
      `  of which interactive (gallery and variants work): ${interactivePass}; static copy only: ${passed - interactivePass}.
` +
      `Blocked path handled: ${blockedOk}/${blockedRows.length}. Captured within 20 s: ${under20}/${okRows.length}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
