import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';
import {
  BlockedSiteError,
  UserInputError,
  toRankForgeError,
  type Extraction,
} from '@rankforge/schema';
import { validateTargetUrl } from '@rankforge/ssrf';
import type { ArtifactStorage } from '@rankforge/storage';
import { AUTO_SCROLL_SCRIPT, NEUTRALISE_OVERLAYS_SCRIPT } from '../extract/layout-script.js';
import { buildExtraction, collectLayout, type LayoutData } from '../extract/index.js';
import { log as defaultLog, type Logger } from '../lib/log.js';
import { AssetRecorder, buildSnapshot } from './assets.js';
import { assertNotBlocked } from './blocked.js';
import { decideHydration, detectFrameworkMarkers, sentinelSurvives } from './hydration.js';
import { installNetworkRules, type NetworkStats, type UrlPolicy } from './network.js';
import { detectPlatform, fetchPlatformProductData } from './platform.js';

export const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const MAX_SCREENSHOT_HEIGHT = 8000;

let browserPromise: Promise<Browser> | null = null;

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}

export type CaptureStep = 'rendering' | 'snapshotting' | 'analysing';

export interface CaptureInput {
  auditId: string;
  url: string;
  /** When present the page is rendered from pasted HTML instead of fetched live (spec F1.3). */
  html?: string;
  storage: ArtifactStorage;
  /** Defaults to the shared SSRF guard. Tests inject a policy that permits loopback fixtures. */
  urlPolicy?: UrlPolicy;
  renderTimeoutMs?: number;
  fetchProductData?: boolean;
  /**
   * Competitor mode: desktop render, screenshot and extraction only. No snapshot, mobile render,
   * hydration test or platform product data.
   */
  lite?: boolean;
  /** Object key prefix for screenshots and extraction. Defaults to `{auditId}/target`. */
  artifactPrefix?: string;
  logger?: Logger;
  onProgress?: (step: CaptureStep) => Promise<void> | void;
}

export interface CaptureOutput {
  extraction: Extraction;
  timings: { renderMs: number; snapshotMs: number; analysisMs: number; totalMs: number };
}

interface RenderedPage {
  html: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  layout: LayoutData;
  frameworkMarkers: Awaited<ReturnType<typeof detectFrameworkMarkers>>;
  mobile: LayoutData | null;
  recorder: AssetRecorder;
  stats: NetworkStats;
  renderMs: number;
}

function prefix(input: Pick<CaptureInput, 'auditId' | 'artifactPrefix'>): string {
  return input.artifactPrefix ?? `${input.auditId}/target`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BlockedSiteError(`${label} timed out after ${ms} ms.`, 'timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function settle(page: Page, logger: Logger, auditId: string): Promise<void> {
  await page.waitForLoadState('load', { timeout: 12_000 }).catch((err: Error) => {
    logger('warn', 'load state not reached; continuing', { auditId, stage: 'capture', error: err.message });
  });
  await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => {
    logger('debug', 'network never went idle; continuing', { auditId, stage: 'capture' });
  });
}

async function openContext(
  browser: Browser,
  kind: 'desktop' | 'mobile',
  options: { storeUrl: string; imagesDisabled: boolean; urlPolicy?: UrlPolicy; recorder: AssetRecorder; html?: string }
): Promise<{ context: BrowserContext; stats: NetworkStats }> {
  const context = await browser.newContext(
    kind === 'desktop'
      ? { viewport: DESKTOP_VIEWPORT, userAgent: DESKTOP_UA, locale: 'en-IN', serviceWorkers: 'block' }
      : {
          viewport: MOBILE_VIEWPORT,
          userAgent: MOBILE_UA,
          locale: 'en-IN',
          isMobile: true,
          hasTouch: true,
          serviceWorkers: 'block',
        }
  );
  const stats = await installNetworkRules(context, {
    storeUrl: options.storeUrl,
    imagesDisabled: options.imagesDisabled,
    urlPolicy: options.urlPolicy,
  });
  options.recorder.attach(context);
  if (options.html !== undefined) {
    const body = options.html;
    await context.route(
      (u) => u.toString() === options.storeUrl,
      (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
    );
  }
  return { context, stats };
}

async function loadAndInspect(
  page: Page,
  input: CaptureInput,
  timeoutMs: number,
  logger: Logger,
  policy: UrlPolicy
): Promise<{ response: Response | null; html: string; finalUrl: string }> {
  const response = await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await settle(page, logger, input.auditId);
  await page.evaluate(AUTO_SCROLL_SCRIPT);
  await page.waitForTimeout(400);
  const hiddenOverlays = (await page.evaluate(NEUTRALISE_OVERLAYS_SCRIPT)) as number;
  if (hiddenOverlays > 0) {
    logger('info', 'hid transient overlays', { auditId: input.auditId, stage: 'capture', hiddenOverlays });
    await page.waitForTimeout(250);
  }

  const html = await page.content();
  const title = await page.title();
  const visibleTextLength = (await page.evaluate('document.body ? document.body.innerText.length : 0')) as number;
  assertNotBlocked({ status: response?.status() ?? 0, html, title, visibleTextLength });

  const finalUrl = page.url();
  const verdict = await policy(finalUrl);
  if (!verdict.isValid) {
    throw new UserInputError(
      verdict.error ?? 'The page redirected to a location that is not allowed.',
      'Use the public product page URL.'
    );
  }
  return { response, html, finalUrl };
}

async function renderOnce(input: CaptureInput, imagesDisabled: boolean, timeoutMs: number): Promise<RenderedPage> {
  const logger = input.logger ?? defaultLog;
  const policy: UrlPolicy = input.urlPolicy ?? ((u) => validateTargetUrl(u));
  const browser = await getBrowser();
  const recorder = new AssetRecorder();
  const started = Date.now();
  const contexts: BrowserContext[] = [];

  try {
    const desktop = await openContext(browser, 'desktop', {
      storeUrl: input.url,
      imagesDisabled,
      urlPolicy: input.urlPolicy,
      recorder,
      html: input.html,
    });
    contexts.push(desktop.context);
    const mobile = await openContext(browser, 'mobile', {
      storeUrl: input.url,
      imagesDisabled,
      urlPolicy: input.urlPolicy,
      recorder,
      html: input.html,
    });
    contexts.push(mobile.context);

    const desktopPage = await desktop.context.newPage();
    const mobilePage = await mobile.context.newPage();

    const mobileTask = (async (): Promise<LayoutData | null> => {
      if (input.lite) return null;
      try {
        await loadAndInspect(mobilePage, input, timeoutMs, logger, policy);
        const layout = await collectLayout(mobilePage);
        const clipHeight = Math.min(layout.pageHeight, MAX_SCREENSHOT_HEIGHT);
        const png = await mobilePage.screenshot({
          type: 'png',
          fullPage: true,
          clip: { x: 0, y: 0, width: MOBILE_VIEWPORT.width, height: clipHeight },
        });
        await input.storage.put(`${prefix(input)}/screens/mobile.png`, png, 'image/png');
        return layout;
      } catch (err) {
        logger('warn', 'mobile render failed; continuing with desktop only', {
          auditId: input.auditId,
          stage: 'capture',
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    })();

    const { response, html, finalUrl } = await loadAndInspect(desktopPage, input, timeoutMs, logger, policy);
    const layout = await collectLayout(desktopPage);
    const frameworkMarkers = await detectFrameworkMarkers(desktopPage);
    const clipHeight = Math.min(layout.pageHeight, MAX_SCREENSHOT_HEIGHT);
    const png = await desktopPage.screenshot({
      type: 'png',
      fullPage: true,
      clip: { x: 0, y: 0, width: DESKTOP_VIEWPORT.width, height: clipHeight },
    });
    await input.storage.put(`${prefix(input)}/screens/desktop.png`, png, 'image/png');

    const mobileLayout = await mobileTask;
    await recorder.settle();

    return {
      html,
      finalUrl,
      status: response?.status() ?? 0,
      headers: response?.headers() ?? {},
      layout,
      frameworkMarkers,
      mobile: mobileLayout,
      recorder,
      stats: {
        blocked: desktop.stats.blocked + mobile.stats.blocked,
        stubbed: desktop.stats.stubbed + mobile.stats.stubbed,
        ssrfBlocked: desktop.stats.ssrfBlocked + mobile.stats.ssrfBlocked,
      },
      renderMs: Date.now() - started,
    };
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => undefined)));
  }
}

/**
 * Renders the target page at 390 px and 1440 px, builds the offline snapshot, detects platform and
 * hydration mode, and writes `extraction.json` plus screenshots under `{auditId}/target/`.
 * One retry without images follows a timeout or navigation failure; blocks raise BlockedSiteError.
 */
export async function captureTarget(input: CaptureInput): Promise<CaptureOutput> {
  const logger = input.logger ?? defaultLog;
  const policy: UrlPolicy = input.urlPolicy ?? ((u) => validateTargetUrl(u));
  const timeoutMs = input.renderTimeoutMs ?? 45_000;
  const totalStart = Date.now();

  const verdict = await policy(input.url);
  if (!verdict.isValid) {
    throw new UserInputError(verdict.error ?? 'This URL is not allowed.', 'Provide a public product page URL.');
  }

  await input.onProgress?.('rendering');
  let rendered: RenderedPage;
  let imagesDisabled = false;
  try {
    rendered = await withTimeout(renderOnce(input, false, timeoutMs), timeoutMs + 5_000, 'Rendering');
  } catch (err) {
    const typed = toRankForgeError(err);
    const retriable =
      !(typed instanceof UserInputError) &&
      !(typed instanceof BlockedSiteError && typed.reason !== 'timeout');
    if (!retriable) throw typed;
    logger('warn', 'render failed; retrying without images', {
      auditId: input.auditId,
      stage: 'capture',
      error: typed.message,
    });
    imagesDisabled = true;
    try {
      rendered = await withTimeout(renderOnce(input, true, timeoutMs), timeoutMs + 5_000, 'Rendering');
    } catch (retryErr) {
      const second = toRankForgeError(retryErr);
      if (second instanceof BlockedSiteError || second instanceof UserInputError) throw second;
      throw new BlockedSiteError('The page took too long to load, even without images.', 'timeout', {
        error: second.message,
      });
    }
  }

  await input.onProgress?.('snapshotting');
  const snapshotStart = Date.now();
  const storage = input.storage;
  const snapshot = input.lite
    ? { html: rendered.html, stored: [] as Awaited<ReturnType<typeof buildSnapshot>>['stored'] }
    : await buildSnapshot({
        html: rendered.html,
        baseUrl: rendered.finalUrl,
        recorder: rendered.recorder,
        storage,
        auditId: input.auditId,
      });
  const snapshotMs = Date.now() - snapshotStart;

  await input.onProgress?.('analysing');
  const analysisStart = Date.now();
  const platformBase = detectPlatform({
    html: rendered.html,
    headers: rendered.headers,
    finalUrl: rendered.finalUrl,
  });
  const productDataTask =
    input.fetchProductData === false || input.lite
      ? Promise.resolve(undefined)
      : fetchPlatformProductData(platformBase.type, rendered.finalUrl).catch((err: Error) => {
          logger('warn', 'platform product data unavailable', {
            auditId: input.auditId,
            stage: 'capture',
            error: err.message,
          });
          return undefined;
        });

  const browser = await getBrowser();
  const survived = input.lite
    ? null
    : await sentinelSurvives({ browser, storage, auditId: input.auditId, html: snapshot.html });
  const hydration = decideHydration(rendered.frameworkMarkers, survived);
  const productData = await productDataTask;

  const cssTexts = [...rendered.recorder.assets.values()]
    .filter((a) => a.contentType.includes('text/css'))
    .map((a) => a.body.toString('utf8'));

  const extraction = buildExtraction({
    auditId: input.auditId,
    sourceUrl: input.url,
    finalUrl: rendered.finalUrl,
    html: snapshot.html,
    source: input.html !== undefined ? 'html_paste' : 'live',
    platform: { ...platformBase, productData },
    hydration,
    cssTexts,
    mobile: rendered.mobile,
    desktop: rendered.layout,
    stats: {
      blockedRequests: rendered.stats.blocked + rendered.stats.ssrfBlocked,
      stubbedRequests: rendered.stats.stubbed,
      assetCount: snapshot.stored.length,
      renderMs: rendered.renderMs,
      imagesDisabled,
    },
  });
  await storage.put(`${prefix(input)}/extraction.json`, JSON.stringify(extraction, null, 2), 'application/json');

  const analysisMs = Date.now() - analysisStart;
  const totalMs = Date.now() - totalStart;
  logger('info', 'capture complete', {
    auditId: input.auditId,
    stage: 'capture',
    durationMs: totalMs,
    renderMs: rendered.renderMs,
    snapshotMs,
    analysisMs,
    platform: extraction.platform.type,
    hydration: extraction.hydration.mode,
    assets: snapshot.stored.length,
  });
  return { extraction, timings: { renderMs: rendered.renderMs, snapshotMs, analysisMs, totalMs } };
}
