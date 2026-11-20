/**
 * Deny list of analytics, advertising and session-replay hosts. Reproductions must never
 * phone home to these, and blocking them also speeds up rendering.
 */
const TRACKER_HOST_SUFFIXES = [
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'googleadservices.com',
  'googlesyndication.com',
  'doubleclick.net',
  'connect.facebook.net',
  'facebook.com',
  'facebook.net',
  'analytics.tiktok.com',
  'business-api.tiktok.com',
  'hotjar.com',
  'hotjar.io',
  'clarity.ms',
  'klaviyo.com',
  'fullstory.com',
  'segment.com',
  'segment.io',
  'mixpanel.com',
  'amplitude.com',
  'heapanalytics.com',
  'criteo.com',
  'criteo.net',
  'snapchat.com',
  'sc-static.net',
  'pinterest.com',
  'pinimg.com/ct',
  'ads-twitter.com',
  'static.ads-twitter.com',
  'linkedin.com',
  'bat.bing.com',
  'taboola.com',
  'outbrain.com',
  'newrelic.com',
  'nr-data.net',
  'sentry.io',
  'clevertap.com',
  'webengage.com',
  'moengage.com',
  'omnisnippet1.com',
  'privy.com',
  'gorgias.chat',
  'tidio.co',
  'intercom.io',
  'crisp.chat',
  'zdassets.com',
  'shopify.com/monorail',
  'monorail-edge.shopifysvc.com',
];

/** Path fragments that mark a tracking endpoint on otherwise first-party hosts. */
const TRACKER_PATH_FRAGMENTS = ['/gtag/js', '/gtm.js', '/collect?v=', '/g/collect', '/fbevents.js', '/pixel'];

function matchesSuffix(host: string, entry: string): boolean {
  const [domain] = entry.split('/');
  if (!domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

export function isTrackerUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  for (const entry of TRACKER_HOST_SUFFIXES) {
    if (!matchesSuffix(host, entry)) continue;
    const slash = entry.indexOf('/');
    if (slash === -1) return true;
    if (url.pathname.startsWith(entry.slice(slash))) return true;
  }
  const lowerPath = `${url.pathname}${url.search}`.toLowerCase();
  return TRACKER_PATH_FRAGMENTS.some((f) => lowerPath.includes(f));
}

/** True when `candidate` is the store's own domain or one of its subdomains (or vice versa for www). */
export function isSameSite(candidate: string, storeUrl: string): boolean {
  try {
    const a = new URL(candidate).hostname.toLowerCase().replace(/^www\./, '');
    const b = new URL(storeUrl).hostname.toLowerCase().replace(/^www\./, '');
    return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
  } catch {
    return false;
  }
}
