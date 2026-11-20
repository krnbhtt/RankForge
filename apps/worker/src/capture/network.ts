import type { BrowserContext } from 'playwright';
import { validateTargetUrl, type SsrfValidationResult } from '@rankforge/ssrf';
import { isSameSite, isTrackerUrl } from './trackers.js';

export type UrlPolicy = (url: string) => Promise<SsrfValidationResult>;

export interface NetworkStats {
  blocked: number;
  stubbed: number;
  ssrfBlocked: number;
}

export interface NetworkRuleOptions {
  /** The store page being captured; non-GET requests to its domain are stubbed. */
  storeUrl: string;
  imagesDisabled: boolean;
  /** Defaults to the shared SSRF guard. Tests may inject a policy that permits loopback fixtures. */
  urlPolicy?: UrlPolicy;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Installs request rules on a browser context:
 * - trackers are aborted,
 * - non-GET requests to the store's own domain get a stub 200 so nothing is ever mutated,
 * - other non-GET requests are aborted,
 * - every remaining URL (including redirect hops) must pass the SSRF policy.
 */
export async function installNetworkRules(
  context: BrowserContext,
  options: NetworkRuleOptions
): Promise<NetworkStats> {
  const stats: NetworkStats = { blocked: 0, stubbed: 0, ssrfBlocked: 0 };
  const policy = options.urlPolicy ?? ((u: string) => validateTargetUrl(u));
  const hostCache = new Map<string, Promise<SsrfValidationResult>>();

  const checkHost = (url: string): Promise<SsrfValidationResult> => {
    const parsed = new URL(url);
    const key = `${parsed.protocol}//${parsed.host}`;
    let cached = hostCache.get(key);
    if (!cached) {
      cached = policy(url);
      hostCache.set(key, cached);
    }
    return cached;
  };

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();

    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) {
      await route.continue();
      return;
    }

    if (isTrackerUrl(url)) {
      stats.blocked++;
      await route.abort('blockedbyclient');
      return;
    }

    if (!SAFE_METHODS.has(request.method())) {
      if (isSameSite(url, options.storeUrl)) {
        stats.stubbed++;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } else {
        stats.blocked++;
        await route.abort('blockedbyclient');
      }
      return;
    }

    if (options.imagesDisabled && request.resourceType() === 'image') {
      stats.blocked++;
      await route.abort('blockedbyclient');
      return;
    }

    const verdict = await checkHost(url);
    if (!verdict.isValid) {
      stats.ssrfBlocked++;
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  return stats;
}
