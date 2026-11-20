import { createHash } from 'node:crypto';
import * as path from 'node:path';
import * as cheerio from 'cheerio';
import { generate, parse, walk, type CssNode } from 'css-tree';
import type { BrowserContext } from 'playwright';
import { contentTypeForKey, type ArtifactStorage } from '@rankforge/storage';
import { isTrackerUrl } from './trackers.js';

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const CAPTURED_TYPES = new Set(['stylesheet', 'script', 'font', 'image', 'media']);

export interface RecordedAsset {
  url: string;
  body: Buffer;
  contentType: string;
}

export interface StoredAsset {
  url: string;
  fileName: string;
  contentType: string;
  byteSize: number;
}

function stripHash(url: string): string {
  const i = url.indexOf('#');
  return i === -1 ? url : url.slice(0, i);
}

function extensionFor(url: string, contentType: string): string {
  const fromPath = path.extname(new URL(url).pathname).toLowerCase();
  if (fromPath && /^\.[a-z0-9]{1,5}$/.test(fromPath)) return fromPath;
  const byType: Record<string, string> = {
    'text/css': '.css',
    'text/javascript': '.js',
    'application/javascript': '.js',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/svg+xml': '.svg',
    'image/gif': '.gif',
    'font/woff2': '.woff2',
    'font/woff': '.woff',
    'font/ttf': '.ttf',
  };
  return byType[contentType.split(';')[0]?.trim().toLowerCase() ?? ''] ?? '.bin';
}

/** Records response bodies of render-relevant resources while a page loads. */
export class AssetRecorder {
  readonly assets = new Map<string, RecordedAsset>();
  private totalBytes = 0;
  /** Responses whose body could not be read (redirects, aborted loads); they are not proxied. */
  unavailable = 0;
  private pending: Promise<void>[] = [];

  attach(context: BrowserContext): void {
    context.on('response', (response) => {
      const task = (async () => {
        try {
          const request = response.request();
          if (!CAPTURED_TYPES.has(request.resourceType())) return;
          if (response.status() !== 200) return;
          const url = stripHash(response.url());
          if (isTrackerUrl(url) || this.assets.has(url)) return;
          const body = await response.body();
          if (body.length === 0 || body.length > MAX_ASSET_BYTES) return;
          if (this.totalBytes + body.length > MAX_TOTAL_BYTES) return;
          this.totalBytes += body.length;
          this.assets.set(url, {
            url,
            body,
            contentType: response.headers()['content-type'] ?? 'application/octet-stream',
          });
        } catch {
          this.unavailable++;
        }
      })();
      this.pending.push(task);
    });
  }

  async settle(): Promise<void> {
    await Promise.all(this.pending);
    this.pending = [];
  }
}

function resolveUrl(raw: string, baseUrl: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('javascript:')) {
    return null;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

function parseSrcset(value: string): { url: string; descriptor: string }[] {
  return value
    .split(/,(?=\s*\S)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url = '', ...rest] = part.split(/\s+/);
      return { url, descriptor: rest.join(' ') };
    });
}

export interface SnapshotResult {
  html: string;
  stored: StoredAsset[];
}

const SNAPSHOT_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; " +
  "img-src * data: blob:; font-src * data:; media-src * data: blob:; connect-src 'self'; form-action 'none'; frame-src 'none'";

/**
 * Builds the offline-viewable snapshot: names every recorded asset by content hash, rewrites
 * HTML and CSS references to the local copies, strips trackers and executable network hooks,
 * and stores everything under `{auditId}/target/`.
 */
export async function buildSnapshot(args: {
  html: string;
  baseUrl: string;
  recorder: AssetRecorder;
  storage: ArtifactStorage;
  auditId: string;
}): Promise<SnapshotResult> {
  const { html, baseUrl, recorder, storage, auditId } = args;
  await recorder.settle();

  const names = new Map<string, StoredAsset>();
  for (const asset of recorder.assets.values()) {
    const hash = createHash('sha256').update(asset.body).digest('hex').slice(0, 20);
    const fileName = `${hash}${extensionFor(asset.url, asset.contentType)}`;
    names.set(asset.url, {
      url: asset.url,
      fileName,
      contentType: asset.contentType,
      byteSize: asset.body.length,
    });
  }

  const localFor = (raw: string, base: string, prefix: string): string | null => {
    const abs = resolveUrl(raw, base);
    if (!abs) return null;
    const hit = names.get(stripHash(abs));
    if (!hit) return null;
    const hash = abs.includes('#') ? abs.slice(abs.indexOf('#')) : '';
    return `${prefix}${hit.fileName}${hash}`;
  };

  const rewriteCssText = (css: string, cssBase: string, prefix: string): string => {
    let ast: CssNode;
    try {
      ast = parse(css, { positions: false, parseCustomProperty: true });
    } catch {
      return css;
    }
    walk(ast, (node) => {
      if (node.type === 'Url') {
        const local = localFor(node.value, cssBase, prefix);
        if (local) {
          node.value = local;
        } else {
          const abs = resolveUrl(node.value, cssBase);
          if (abs) node.value = abs;
        }
      }
      if (node.type === 'Atrule' && node.name === 'import' && node.prelude) {
        walk(node.prelude, (inner) => {
          if (inner.type === 'String') {
            const local = localFor(inner.value, cssBase, prefix);
            inner.value = local ?? resolveUrl(inner.value, cssBase) ?? inner.value;
          }
        });
      }
    });
    return generate(ast);
  };

  const $ = cheerio.load(html);
  const declaredBase = $('base[href]').first().attr('href');
  const docBase = declaredBase ? (resolveUrl(declaredBase, baseUrl) ?? baseUrl) : baseUrl;
  $('base').remove();
  $('meta[http-equiv="refresh" i]').remove();
  $('meta[http-equiv="Content-Security-Policy" i]').remove();

  const rewriteAttr = (el: cheerio.Cheerio<never>, attr: string, prefix: string) => {
    const value = el.attr(attr);
    if (!value) return;
    const local = localFor(value, docBase, prefix);
    if (local) {
      el.attr(attr, local);
      return;
    }
    const abs = resolveUrl(value, docBase);
    if (abs) el.attr(attr, abs);
  };

  const rewriteSrcsetAttr = (el: cheerio.Cheerio<never>, attr: string) => {
    const value = el.attr(attr);
    if (!value) return;
    const parts = parseSrcset(value).map(({ url, descriptor }) => {
      const local = localFor(url, docBase, 'assets/') ?? resolveUrl(url, docBase) ?? url;
      return descriptor ? `${local} ${descriptor}` : local;
    });
    el.attr(attr, parts.join(', '));
  };

  $('link[href]').each((_, node) => {
    const el = $(node) as unknown as cheerio.Cheerio<never>;
    const rel = (el.attr('rel') ?? '').toLowerCase();
    if (/(^|\s)(stylesheet|icon|apple-touch-icon|shortcut)(\s|$)/.test(rel)) {
      rewriteAttr(el, 'href', 'assets/');
    } else if (/(preload|prefetch|preconnect|dns-prefetch|modulepreload|manifest)/.test(rel)) {
      el.remove();
      return;
    } else {
      rewriteAttr(el, 'href', 'assets/');
    }
    el.removeAttr('integrity');
    el.removeAttr('crossorigin');
  });

  $('script[src]').each((_, node) => {
    const el = $(node) as unknown as cheerio.Cheerio<never>;
    const src = el.attr('src') ?? '';
    const abs = resolveUrl(src, docBase);
    if (!abs || isTrackerUrl(abs)) {
      el.remove();
      return;
    }
    const local = localFor(src, docBase, 'assets/');
    if (!local) {
      el.remove();
      return;
    }
    el.attr('src', local);
    el.removeAttr('integrity');
    el.removeAttr('crossorigin');
    el.removeAttr('nonce');
  });
  $('script:not([src])').removeAttr('nonce');

  $('img, source, video, audio, track, input[type="image"], iframe[src]').each((_, node) => {
    const el = $(node) as unknown as cheerio.Cheerio<never>;
    rewriteAttr(el, 'src', 'assets/');
    rewriteAttr(el, 'poster', 'assets/');
    rewriteSrcsetAttr(el, 'srcset');
  });
  $('iframe').remove();

  $('image[href], use[href], image[xlink\\:href], use[xlink\\:href]').each((_, node) => {
    const el = $(node) as unknown as cheerio.Cheerio<never>;
    rewriteAttr(el, 'href', 'assets/');
    rewriteAttr(el, 'xlink:href', 'assets/');
  });

  $('[data-src], [data-srcset], [data-bgset], [data-background], [data-bg], [data-original]').each((_, node) => {
    const el = $(node) as unknown as cheerio.Cheerio<never>;
    for (const attr of ['data-src', 'data-background', 'data-bg', 'data-original']) {
      rewriteAttr(el, attr, 'assets/');
    }
    rewriteSrcsetAttr(el, 'data-srcset');
    rewriteSrcsetAttr(el, 'data-bgset');
  });

  $('[style]').each((_, node) => {
    const el = $(node);
    const style = el.attr('style');
    if (style && style.includes('url(')) {
      el.attr('style', style.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, _q, raw: string) => {
        const local = localFor(raw, docBase, 'assets/') ?? resolveUrl(raw, docBase);
        return local ? `url("${local}")` : m;
      }));
    }
  });

  $('style').each((_, node) => {
    const el = $(node);
    const css = el.html();
    if (css && (css.includes('url(') || css.includes('@import'))) {
      el.text(rewriteCssText(css, docBase, 'assets/'));
    }
  });

  $('a[href]').each((_, node) => {
    const el = $(node);
    const href = el.attr('href') ?? '';
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const abs = resolveUrl(href, docBase);
    if (abs) el.attr('href', abs);
  });
  $('form').each((_, node) => {
    $(node).attr('action', '#');
    $(node).attr('onsubmit', 'return false');
  });

  if ($('head').length === 0) $('html').prepend('<head></head>');
  $('head').prepend(
    `<meta http-equiv="Content-Security-Policy" content="${SNAPSHOT_CSP}"><base target="_blank">`
  );

  const rewrittenHtml = $.html();

  const stored: StoredAsset[] = [];
  for (const asset of recorder.assets.values()) {
    const info = names.get(asset.url);
    if (!info) continue;
    let body = asset.body;
    const isCss = asset.contentType.includes('text/css') || info.fileName.endsWith('.css');
    if (isCss) {
      body = Buffer.from(rewriteCssText(asset.body.toString('utf8'), asset.url, ''), 'utf8');
    }
    await storage.put(
      `${auditId}/target/assets/${info.fileName}`,
      body,
      asset.contentType || contentTypeForKey(info.fileName)
    );
    stored.push({ ...info, byteSize: body.length });
  }

  await storage.put(`${auditId}/target/index.html`, rewrittenHtml, 'text/html; charset=utf-8');
  return { html: rewrittenHtml, stored };
}
