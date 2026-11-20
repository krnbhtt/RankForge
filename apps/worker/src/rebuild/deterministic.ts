import * as cheerio from 'cheerio';
import type { Blueprint, BlueprintSectionSpec, Extraction, PatchOp } from '@rankforge/schema';
import { escapeForHtml } from './applier.js';

const HEAD_SECTION = 'fix_head';
const SCHEMA_SECTION = 'fix_schema';
const IMAGE_SECTION = 'fix_images';

function productName(extraction: Extraction): string {
  return (extraction.platform.productData?.title || extraction.content.h1 || extraction.meta.title).trim();
}

function brandName(extraction: Extraction): string {
  const vendor = extraction.platform.productData?.vendor?.trim();
  if (vendor) return vendor;
  const og = extraction.meta.title.split(/[|–—-]/).map((s) => s.trim()).filter(Boolean);
  if (og.length > 1) return og[og.length - 1] as string;
  return new URL(extraction.finalUrl).hostname.replace(/^www\./, '');
}

/** A 30 to 60 character title built from the product name and brand. */
export function buildTitle(extraction: Extraction): string {
  const name = productName(extraction);
  const brand = brandName(extraction);
  let title = name.toLowerCase().includes(brand.toLowerCase()) ? name : `${name} | ${brand}`;
  if (title.length > 60) title = `${name.slice(0, 60 - 3 - Math.min(brand.length, 20))}... | ${brand.slice(0, 20)}`.slice(0, 60);
  if (title.length < 30) title = `${title} - Buy Online`.slice(0, 60);
  return title;
}

/** A 70 to 160 character description taken from the page's own copy. */
export function buildMetaDescription(extraction: Extraction): string {
  const source = (
    extraction.platform.productData?.descriptionHtml
      ? cheerio.load(extraction.platform.productData.descriptionHtml).text()
      : extraction.content.text
  )
    .replace(/\s+/g, ' ')
    .trim();
  const base = source.length >= 70 ? source : `${productName(extraction)}. ${source}`.trim();
  let out = base.slice(0, 157);
  if (base.length > 157) out = out.replace(/\s+\S*$/, '') + '...';
  return out.length >= 70 ? out : `${out} Buy online with delivery to your door.`.slice(0, 160);
}

/** Product and BreadcrumbList structured data built only from captured and platform data. */
export function buildStructuredData(extraction: Extraction, breadcrumb: { name: string; url: string }[]): Record<string, unknown>[] {
  const data = extraction.platform.productData;
  const images = [...new Set([...extraction.images.filter((i) => i.role !== 'other').map((i) => i.src), ...(data?.images.map((i) => i.src) ?? [])])]
    .filter((u) => /^https?:/.test(u))
    .slice(0, 8);
  const variant = data?.variants[0];
  const price = extraction.price?.selling ?? (variant?.price ? Number(variant.price) : undefined);
  const currency = extraction.price?.currency ?? data?.currency ?? 'INR';

  const product: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: productName(extraction),
    ...(images.length ? { image: images } : {}),
    description: buildMetaDescription(extraction),
    ...(variant?.sku ? { sku: variant.sku } : {}),
    brand: { '@type': 'Brand', name: brandName(extraction) },
    url: extraction.finalUrl,
  };
  if (price !== undefined && Number.isFinite(price)) {
    product.offers = {
      '@type': 'Offer',
      url: extraction.finalUrl,
      price: String(price),
      priceCurrency: currency,
      ...(variant?.available === true ? { availability: 'https://schema.org/InStock' } : variant?.available === false ? { availability: 'https://schema.org/OutOfStock' } : {}),
    };
  }
  // Ratings are published only when the page itself shows real ones.
  if (extraction.reviews.ratingValue !== undefined && (extraction.reviews.reviewCount ?? 0) > 0) {
    product.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: String(extraction.reviews.ratingValue),
      reviewCount: String(extraction.reviews.reviewCount),
    };
  }
  const graph: Record<string, unknown>[] = [product];
  if (breadcrumb.length >= 2) {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumb.map((b, i) => ({ '@type': 'ListItem', position: i + 1, name: b.name, item: b.url })),
    });
  }
  return graph;
}

function readBreadcrumb(html: string, extraction: Extraction): { name: string; url: string }[] {
  const crumb = extraction.components.find((c) => c.kind === 'breadcrumb');
  if (!crumb) return [];
  const $ = cheerio.load(html);
  const out: { name: string; url: string }[] = [];
  $(`${crumb.selector} a`).each((_, a) => {
    const name = $(a).text().replace(/\s+/g, ' ').trim();
    const href = $(a).attr('href') ?? '';
    if (name && /^https?:/.test(href)) out.push({ name, url: href });
  });
  const current = productName(extraction);
  if (out.length > 0) out.push({ name: current, url: extraction.finalUrl });
  return out;
}

/** Operations that need no writing: head, alt text and structured data (spec 4.2 step 8 and F6.4). */
export function buildDeterministicOps(blueprint: Blueprint, extraction: Extraction, snapshotHtml: string): PatchOp[] {
  const ops: PatchOp[] = [];
  const has = (f: Blueprint['deterministicFixes'][number]) => blueprint.deterministicFixes.includes(f);

  if (has('title')) {
    ops.push({
      op: 'setHeadMeta',
      target: 'title',
      html: buildTitle(extraction),
      tag: 'Ranking',
      reason: `The title was ${extraction.meta.title.length} characters; 30 to 60 reads best in search results.`,
      sample: false,
      sectionId: HEAD_SECTION,
    });
  }
  if (has('meta_description')) {
    ops.push({
      op: 'setHeadMeta',
      target: 'meta[name="description"]',
      html: buildMetaDescription(extraction),
      tag: 'Ranking',
      reason: 'The page had no meta description; this one is taken from the product copy.',
      sample: false,
      sectionId: HEAD_SECTION,
    });
  }
  if (has('image_alt')) {
    ops.push({
      op: 'setAttr',
      target: 'img:not([alt]), img[alt=""]',
      attr: { name: 'alt', value: `${productName(extraction)} - image {n}` },
      all: true,
      tag: 'Ranking',
      reason: 'Images without alt text are invisible to search engines and screen readers.',
      sample: false,
      sectionId: IMAGE_SECTION,
    });
  }
  if (has('product_schema') || has('breadcrumb_schema')) {
    const breadcrumb = readBreadcrumb(snapshotHtml, extraction);
    const graph = buildStructuredData(extraction, has('breadcrumb_schema') || breadcrumb.length ? breadcrumb : []);
    if (has('product_schema')) {
      ops.push({
        op: 'injectJsonLd',
        target: 'head',
        html: JSON.stringify(graph[0]),
        replaceType: 'Product',
        tag: 'Ranking',
        reason: 'Complete Product structured data (name, images, brand, price and availability) built from the page and platform data.',
        sample: false,
        sectionId: SCHEMA_SECTION,
      });
    }
    const crumbs = graph.find((n) => n['@type'] === 'BreadcrumbList');
    if (has('breadcrumb_schema') && crumbs) {
      ops.push({
        op: 'injectJsonLd',
        target: 'head',
        html: JSON.stringify(crumbs),
        replaceType: 'BreadcrumbList',
        tag: 'Ranking',
        reason: 'BreadcrumbList structured data built from the breadcrumb trail on the page.',
        sample: false,
        sectionId: SCHEMA_SECTION,
      });
    }
  }
  return ops;
}

/** Sticky buy bar: deterministic template, no model. The button forwards the click to the store's own button. */
export function stickyCtaHtml(extraction: Extraction): string {
  const cta = extraction.ctaPositions.find((c) => c.viewport === 'mobile') ?? extraction.ctaPositions[0];
  const price = extraction.price?.raw ? escapeForHtml(extraction.price.raw.slice(0, 30)) : '';
  return (
    `<div class="rf-sticky" role="region" aria-label="Buy bar"><div><strong>${escapeForHtml(productName(extraction).slice(0, 60))}</strong>` +
    `${price ? `<div>${price}</div>` : ''}</div>` +
    `<button type="button" data-rf-click="${escapeForHtml(cta?.selector ?? '')}">${escapeForHtml((cta?.text || 'Add to cart').slice(0, 24))}</button></div>`
  );
}

/** Price note: states what the price includes. Illustrative, so it carries the Sample chip. */
export function priceNoteHtml(): string {
  return `<div class="rf-section" role="note"><p>Inclusive of all taxes <span class="rf-sample-chip">Sample</span></p></div>`;
}

export function sectionOps(spec: BlueprintSectionSpec, html: string): PatchOp {
  return {
    op: spec.anchor.position,
    target: spec.anchor.selector,
    fallbackTarget: spec.anchor.fallbackSelector,
    alternates: spec.anchor.alternates?.map((a) => ({ op: a.position, target: a.selector })),
    html,
    tag: spec.tag,
    reason: spec.justifications[0]?.note ?? spec.name,
    sample: spec.sample,
    sectionId: spec.sectionId,
  };
}
