import * as dns from 'node:dns';
import { isPrivateIp, parseIpv6 } from './ip.js';

export { isPrivateIp, parseIpv6 };

export interface SsrfValidationResult {
  isValid: boolean;
  error?: string;
  resolvedIp?: string;
  resolvedIps?: string[];
}

export type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) => {
  const results = await dns.promises.lookup(hostname, { all: true });
  return results.map((r) => r.address);
};

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata', 'instance-data']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal'];

export interface ValidateOptions {
  resolver?: Resolver;
}

/**
 * Validates a URL against the SSRF policy: http/https only, no internal hostnames,
 * and every address the hostname resolves to must be public.
 */
export async function validateTargetUrl(
  rawUrl: string,
  options: ValidateOptions = {}
): Promise<SsrfValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { isValid: false, error: 'Malformed URL. Please provide a valid HTTP or HTTPS URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      error: `Invalid protocol '${parsed.protocol}'. Only HTTP and HTTPS are permitted.`,
    };
  }

  if (parsed.username || parsed.password) {
    return { isValid: false, error: 'URLs containing credentials are prohibited.' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');

  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s))) {
    return {
      isValid: false,
      error: `Internal or private hostnames (${hostname}) are prohibited for security reasons.`,
    };
  }

  if (isPrivateIp(hostname)) {
    return {
      isValid: false,
      error: `Private or loopback IP addresses (${hostname}) are prohibited.`,
    };
  }

  const literalV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  const literalV6 = hostname.startsWith('[') || hostname.includes(':');
  if (literalV4 || literalV6) {
    return { isValid: true, resolvedIp: hostname.replace(/^\[|\]$/g, ''), resolvedIps: [hostname] };
  }

  const resolve = options.resolver ?? defaultResolver;
  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch (err) {
    return {
      isValid: false,
      error: `Failed to resolve domain name '${hostname}': ${(err as Error).message}`,
    };
  }
  if (addresses.length === 0) {
    return { isValid: false, error: `Domain name '${hostname}' did not resolve to any address.` };
  }
  const bad = addresses.find((a) => isPrivateIp(a));
  if (bad) {
    return {
      isValid: false,
      error: `Hostname ${hostname} resolves to private IP ${bad}, which is prohibited.`,
    };
  }
  return { isValid: true, resolvedIp: addresses[0], resolvedIps: addresses };
}

export class SsrfBlockedError extends Error {
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  resolver?: Resolver;
  fetchImpl?: typeof fetch;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch that validates the URL and every redirect hop before connecting.
 * Redirects are followed manually so a public host cannot bounce to a private one.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const doFetch = options.fetchImpl ?? fetch;
  let current = rawUrl;
  let method = options.method ?? 'GET';
  let body = options.body;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await validateTargetUrl(current, { resolver: options.resolver });
    if (!check.isValid) {
      throw new SsrfBlockedError(check.error ?? 'URL blocked by SSRF policy', current);
    }
    const res = await doFetch(current, {
      method,
      headers: options.headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const location = res.headers.get('location');
    if (!REDIRECT_STATUSES.has(res.status) || !location) {
      return res;
    }
    await res.body?.cancel();
    current = new URL(location, current).toString();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
    }
  }
  throw new SsrfBlockedError(`Too many redirects (more than ${maxRedirects})`, current);
}
