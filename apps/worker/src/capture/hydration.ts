import type { Browser, Page } from 'playwright';
import type { HydrationInfo } from '@rankforge/schema';
import type { ArtifactStorage } from '@rankforge/storage';
import { contentTypeForKey } from '@rankforge/storage';
import { FRAMEWORK_MARKERS_SCRIPT } from '../extract/layout-script.js';

type Framework = HydrationInfo['framework'];

/** Reads framework markers from a live page. */
export async function detectFrameworkMarkers(page: Page): Promise<{ framework: Framework; signals: string[] }> {
  return (await page.evaluate(FRAMEWORK_MARKERS_SCRIPT)) as { framework: Framework; signals: string[] };
}

const SENTINEL_ATTR = 'data-rf-sentinel';
const SENTINEL_TEXT = 'RF-SENTINEL-7f3a';
const SNAPSHOT_HOST = 'https://rf-snapshot.invalid';

/**
 * Inserts the sentinel edits into snapshot HTML: a marker element as the first child of the
 * main container and a marker appended to the first heading. Done on the string so the edits
 * exist before any store script runs, exactly like a server-mode patch.
 */
export function injectSentinel(html: string): string {
  const marker = `<div ${SENTINEL_ATTR}="1" style="display:none">${SENTINEL_TEXT}</div>`;
  let out = html.replace(/(<main\b[^>]*>)/i, `$1${marker}`);
  if (out === html) out = html.replace(/(<body\b[^>]*>)/i, `$1${marker}`);
  out = out.replace(/(<h1\b[^>]*>)/i, `$1${SENTINEL_TEXT} `);
  return out;
}

export interface SurvivalOptions {
  browser: Browser;
  storage: ArtifactStorage;
  auditId: string;
  html: string;
  settleMs?: number;
  timeoutMs?: number;
}

/**
 * Loads the snapshot with sentinel edits already in the HTML, lets the store scripts run, and
 * reports whether the edits are still present. Survival means server-mode patching is safe.
 * Returns null if the test could not run.
 */
export async function sentinelSurvives(options: SurvivalOptions): Promise<boolean | null> {
  const { browser, storage, auditId } = options;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: true });
  try {
    const page = await context.newPage();
    await page.route(`${SNAPSHOT_HOST}/**`, async (route) => {
      const url = new URL(route.request().url());
      const relative = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'index.html';
      if (relative === 'index.html') {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: injectSentinel(options.html),
        });
        return;
      }
      const stored = await storage.get(`${auditId}/target/${relative}`).catch(() => null);
      if (!stored) {
        await route.fulfill({ status: 404, body: '' });
        return;
      }
      await route.fulfill({ status: 200, contentType: stored.contentType || contentTypeForKey(relative), body: stored.body });
    });
    await page.route((u) => u.origin !== SNAPSHOT_HOST, (route) => route.abort('blockedbyclient'));
    await page.goto(`${SNAPSHOT_HOST}/index.html`, { waitUntil: 'load', timeout: options.timeoutMs ?? 12000 });
    await page.waitForTimeout(options.settleMs ?? 800);
    return await page.evaluate(
      ({ attr, text }) => {
        const el = document.querySelector(`[${attr}]`);
        const h1 = document.querySelector('h1');
        const markerPresent = !!el && el.isConnected;
        const headingMarked = !h1 || !(h1.textContent ?? '').length || (h1.textContent ?? '').includes(text);
        return markerPresent && headingMarked;
      },
      { attr: SENTINEL_ATTR, text: SENTINEL_TEXT }
    );
  } catch {
    return null;
  } finally {
    await context.close();
  }
}

export function decideHydration(
  markers: { framework: Framework; signals: string[] },
  survived: boolean | null
): HydrationInfo {
  if (survived === null) {
    return {
      mode: markers.framework === 'none' ? 'server' : 'runtime',
      framework: markers.framework,
      signals: [...markers.signals, 'sentinel test unavailable; decided from framework markers'],
      sentinelSurvived: null,
    };
  }
  return {
    mode: survived ? 'server' : 'runtime',
    framework: markers.framework,
    signals: [...markers.signals, survived ? 'sentinel edits survived store scripts' : 'sentinel edits were discarded by store scripts'],
    sentinelSurvived: survived,
  };
}
