import type { Extraction } from '@rankforge/schema';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface RuleResult {
  id: string;
  severity: Severity;
  title: string;
  /** What was measured, quoted from the page. Always non-empty. */
  evidence: string;
  /** Points lost in the component this rule belongs to. */
  penaltyPoints: number;
}

export interface SchemaAudit {
  hasProductSchema: boolean;
  hasOfferSchema: boolean;
  hasBrandSchema: boolean;
  hasBreadcrumbList: boolean;
  rules: RuleResult[];
  typesFound: string[];
}

function typesOf(node: Record<string, unknown>): string[] {
  const t = node['@type'];
  return (Array.isArray(t) ? t : [t]).filter((v): v is string => typeof v === 'string');
}

const present = (v: unknown): boolean =>
  v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '') && !(Array.isArray(v) && v.length === 0);

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

const firstOf = (v: unknown): Record<string, unknown> | undefined => (Array.isArray(v) ? asObject(v[0]) : asObject(v));

/**
 * Validates Product, Offer, Brand and BreadcrumbList JSON-LD against the properties Google requires or
 * recommends for product rich results (spec F4.3). Pure code: no model involved.
 */
export function auditProductSchema(jsonLd: Extraction['jsonLd']): SchemaAudit {
  const typesFound = [...new Set(jsonLd.flatMap(typesOf))];
  const product = jsonLd.find((n) => typesOf(n).includes('Product'));
  const breadcrumb = jsonLd.find((n) => typesOf(n).includes('BreadcrumbList'));
  const rules: RuleResult[] = [];

  const add = (id: string, severity: Severity, title: string, evidence: string, penaltyPoints: number) =>
    rules.push({ id, severity, title, evidence, penaltyPoints });

  if (!product) {
    add(
      'schema.product.missing',
      'critical',
      'No Product structured data',
      `JSON-LD types found on the page: ${typesFound.length ? typesFound.join(', ') : 'none'}.`,
      10
    );
  } else {
    for (const prop of ['name', 'image']) {
      if (!present(product[prop])) {
        add(`schema.product.${prop}`, 'high', `Product schema is missing "${prop}"`, `Product JSON-LD has no ${prop} property.`, 3);
      }
    }
    for (const prop of ['description', 'sku', 'aggregateRating', 'review']) {
      const alt = prop === 'sku' ? product.gtin ?? product.gtin13 ?? product.mpn : undefined;
      if (!present(product[prop]) && !present(alt)) {
        add(
          `schema.product.${prop}`,
          'low',
          `Product schema is missing recommended "${prop}"`,
          `Product JSON-LD has no ${prop}${prop === 'sku' ? ' (or gtin/mpn)' : ''}.`,
          1
        );
      }
    }
  }

  const offer = firstOf(product?.offers);
  if (product && !offer) {
    add('schema.offer.missing', 'critical', 'Product has no Offer', 'Product JSON-LD has no offers property.', 5);
  } else if (offer) {
    const price = offer.price ?? offer.lowPrice;
    if (!present(price)) add('schema.offer.price', 'high', 'Offer has no price', 'Offer JSON-LD has no price or lowPrice.', 2);
    if (!present(offer.priceCurrency)) {
      add('schema.offer.currency', 'high', 'Offer has no priceCurrency', 'Offer JSON-LD has no priceCurrency.', 2);
    }
    if (!present(offer.availability)) {
      add('schema.offer.availability', 'medium', 'Offer has no availability', 'Offer JSON-LD has no availability.', 1);
    }
  }

  const brand = product?.brand;
  const hasBrand = Boolean(brand && (typeof brand === 'string' ? brand.trim() : present(asObject(brand)?.name)));
  if (product && !hasBrand) {
    add('schema.brand.missing', 'medium', 'Product has no Brand', 'Product JSON-LD has no brand name.', 5);
  }

  if (!breadcrumb) {
    add('schema.breadcrumb.missing', 'medium', 'No BreadcrumbList structured data', 'No BreadcrumbList JSON-LD found on the page.', 5);
  }

  return {
    hasProductSchema: Boolean(product),
    hasOfferSchema: Boolean(offer),
    hasBrandSchema: hasBrand,
    hasBreadcrumbList: Boolean(breadcrumb),
    rules,
    typesFound,
  };
}
