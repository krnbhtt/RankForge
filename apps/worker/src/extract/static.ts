import * as cheerio from 'cheerio';
import { parse, walk } from 'css-tree';
import type { ExtractedReviews, HeadingNode, PageMeta } from '@rankforge/schema';

export function extractMeta(html: string): PageMeta {
  const $ = cheerio.load(html);
  const meta = (name: string) =>
    $(`meta[name="${name}" i], meta[property="${name}" i]`).first().attr('content')?.trim() || undefined;
  return {
    title: $('head title').first().text().trim() || $('title').first().text().trim(),
    description: meta('description') ?? '',
    canonical: $('link[rel="canonical" i]').first().attr('href')?.trim() || undefined,
    robots: meta('robots'),
    lang: $('html').attr('lang')?.trim() || undefined,
    ogTitle: meta('og:title'),
    ogImage: meta('og:image'),
    viewport: meta('viewport'),
  };
}

export function extractJsonLd(html: string): Record<string, unknown>[] {
  const $ = cheerio.load(html);
  const out: Record<string, unknown>[] = [];
  $('script[type="application/ld+json" i]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const push = (node: unknown) => {
      if (node && typeof node === 'object' && !Array.isArray(node)) {
        const obj = node as Record<string, unknown>;
        const graph = obj['@graph'];
        if (Array.isArray(graph)) graph.forEach(push);
        else out.push(obj);
      } else if (Array.isArray(node)) {
        node.forEach(push);
      }
    };
    push(parsed);
  });
  return out;
}

function mainRoot($: cheerio.CheerioAPI) {
  const main = $('main, [role="main"]').first();
  return main.length ? main : $('body');
}

export function extractContent(html: string): { h1: string; text: string; wordCount: number } {
  const $ = cheerio.load(html);
  const root = mainRoot($).clone();
  root.find('script, style, noscript, template, svg, nav, header, footer, [aria-hidden="true"], [hidden]').remove();
  const text = root.text().replace(/\s+/g, ' ').trim();
  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
  return { h1, text, wordCount: text ? text.split(' ').length : 0 };
}

export function extractHeadingTree(html: string): HeadingNode[] {
  const $ = cheerio.load(html);
  const root = mainRoot($);
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];
  root.find('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const $el = $(el);
    if ($el.closest('nav, header, footer, [hidden], [aria-hidden="true"]').length) return;
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (!text) return;
    const level = Number((el as unknown as { tagName: string }).tagName.slice(1));
    const node: HeadingNode = { level, text, children: [] };
    while (stack.length && (stack[stack.length - 1] as HeadingNode).level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  });
  return roots;
}

function asNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && String(value ?? '').length > 0 ? n : undefined;
}

/** Reads aggregate rating and review samples from Product JSON-LD, falling back to common DOM patterns. */
export function extractReviews(html: string, jsonLd: Record<string, unknown>[]): ExtractedReviews {
  const product = jsonLd.find((n) => {
    const t = n['@type'];
    return t === 'Product' || (Array.isArray(t) && t.includes('Product'));
  });
  const reviews: ExtractedReviews = { items: [] };
  const agg = product?.aggregateRating as Record<string, unknown> | undefined;
  if (agg) {
    const rating = asNumber(agg.ratingValue);
    const count = asNumber(agg.reviewCount ?? agg.ratingCount);
    if (rating !== undefined && rating <= 5) reviews.ratingValue = rating;
    if (count !== undefined) reviews.reviewCount = Math.round(count);
  }
  const ldReviews = product?.review;
  for (const r of Array.isArray(ldReviews) ? ldReviews : ldReviews ? [ldReviews] : []) {
    const rv = r as Record<string, unknown>;
    const body = String(rv.reviewBody ?? rv.description ?? '').trim();
    if (!body) continue;
    const author = rv.author as { name?: string } | string | undefined;
    const rating = asNumber((rv.reviewRating as Record<string, unknown> | undefined)?.ratingValue);
    reviews.items.push({
      text: body,
      author: typeof author === 'string' ? author : author?.name,
      rating: rating !== undefined && rating <= 5 ? rating : undefined,
    });
  }

  const $ = cheerio.load(html);
  if (reviews.ratingValue === undefined) {
    const v = asNumber($('[itemprop="ratingValue"]').first().attr('content') ?? $('[itemprop="ratingValue"]').first().text());
    if (v !== undefined && v <= 5) reviews.ratingValue = v;
  }
  if (reviews.reviewCount === undefined) {
    const v = asNumber($('[itemprop="reviewCount"]').first().attr('content') ?? $('[itemprop="reviewCount"]').first().text());
    if (v !== undefined) reviews.reviewCount = Math.round(v);
  }
  if (reviews.items.length === 0) {
    $('[itemprop="review"], [class*="review-item" i], [class*="jdgm-rev__body" i], .woocommerce-review__comment, [class*="review-content" i]')
      .slice(0, 12)
      .each((_, el) => {
        const text = $(el).find('[itemprop="reviewBody"]').first().text() || $(el).text();
        const clean = text.replace(/\s+/g, ' ').trim();
        if (clean.length > 15) reviews.items.push({ text: clean.slice(0, 600) });
      });
  }
  return reviews;
}

/** Collects class names that are both used in the DOM and defined by a captured stylesheet. */
export function buildClassWhitelist(html: string, cssTexts: string[], limit = 4000): string[] {
  const defined = new Set<string>();
  for (const css of cssTexts) {
    try {
      const ast = parse(css, { positions: false, parseValue: false, parseAtrulePrelude: false });
      walk(ast, (node) => {
        if (node.type === 'Rule' && node.prelude.type === 'Raw') {
          for (const m of node.prelude.value.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)) {
            if (m[1]) defined.add(m[1]);
          }
        }
        if (node.type === 'ClassSelector') defined.add(node.name);
      });
    } catch {
      continue;
    }
  }
  const $ = cheerio.load(html);
  const used = new Set<string>();
  $('[class]').each((_, el) => {
    for (const c of ($(el).attr('class') ?? '').split(/\s+/)) if (c) used.add(c);
  });
  return [...used].filter((c) => defined.has(c)).sort().slice(0, limit);
}
