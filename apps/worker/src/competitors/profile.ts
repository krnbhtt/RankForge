import type {
  CompetitorProfile,
  Extraction,
  ImageType,
  TrustElementKind,
} from '@rankforge/schema';

const TRUST_PATTERNS: [TrustElementKind, RegExp][] = [
  ['cod', /cash on delivery|\bcod\b|pay on delivery/i],
  ['upi', /\bupi\b|google pay|gpay|phonepe|paytm/i],
  ['returns', /\b(easy |free |hassle[- ]free )?returns?\b|\b\d+[- ]day (return|replacement|refund)|refund policy|exchange/i],
  ['delivery', /delivery (by|in|within|estimate)|ships? (in|within)|estimated delivery|pincode|pin code|delivered (by|in)/i],
  ['free_shipping', /free (shipping|delivery)/i],
  ['warranty', /\bwarranty\b/i],
  ['guarantee', /money[- ]back|satisfaction guarantee|\bguarantee(d)?\b/i],
  ['secure_payment', /secure (payment|checkout)|ssl|100% secure|safe (payment|checkout)/i],
  ['certification', /\b(iso|bis|fssai|ce|fda|gots|oeko-tex|cruelty[- ]free|vegan|dermatologically tested|certified|bpa[- ]free|food[- ]grade)\b/i],
  ['reviews', /\b\d+(\.\d+)? ?(out of 5|\/ ?5|stars?)|\breviews?\b|\bratings?\b/i],
];

export function detectTrustElements(text: string): TrustElementKind[] {
  return TRUST_PATTERNS.filter(([, re]) => re.test(text)).map(([kind]) => kind);
}

const IMAGE_TYPE_PATTERNS: [ImageType, RegExp][] = [
  ['size_chart', /size (chart|guide)|measurement|dimensions?/i],
  ['infographic', /infographic|features?|benefits?|how (it|to)|diagram|comparison/i],
  ['packaging', /packag|box|unboxing|what'?s in the box|contents/i],
  ['lifestyle', /lifestyle|in use|model|wearing|styled|kitchen|home|outdoor|being used|worn by/i],
  ['detail', /detail|close[- ]?up|texture|zoom|macro|stitch/i],
];

export function classifyImages(images: Extraction['images']): ImageType[] {
  const found = new Set<ImageType>();
  for (const img of images) {
    const hay = `${img.alt} ${img.src.split('/').pop() ?? ''}`;
    const hit = IMAGE_TYPE_PATTERNS.find(([, re]) => re.test(hay));
    found.add(hit ? hit[0] : 'product');
  }
  return [...found];
}

function schemaTypes(jsonLd: Extraction['jsonLd']): string[] {
  const types = new Set<string>();
  for (const node of jsonLd) {
    const t = node['@type'];
    for (const v of Array.isArray(t) ? t : [t]) if (typeof v === 'string') types.add(v);
  }
  return [...types];
}

function normaliseHeading(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function collectH2s(tree: Extraction['headingTree']): string[] {
  const out: string[] = [];
  const walk = (nodes: Extraction['headingTree']) => {
    for (const n of nodes) {
      if (n.level === 2 || n.level === 3) out.push(normaliseHeading(n.text));
      walk(n.children);
    }
  };
  walk(tree);
  return out.filter(Boolean);
}

/** Derives the features the consensus model needs from one extraction. Pure and deterministic. */
export function buildProfile(competitorId: string, extraction: Extraction, entities: string[] = []): CompetitorProfile {
  const mobileCta = extraction.ctaPositions.find((c) => c.viewport === 'mobile') ?? extraction.ctaPositions[0];
  const desktopCta = extraction.ctaPositions.find((c) => c.viewport === 'desktop');
  return {
    competitorId,
    url: extraction.finalUrl,
    sections: collectH2s(extraction.headingTree),
    entities: [...new Set(entities.map((e) => e.toLowerCase().trim()).filter(Boolean))],
    schemaTypes: schemaTypes(extraction.jsonLd),
    trust: detectTrustElements(extraction.content.text),
    imageTypes: classifyImages(extraction.images),
    wordCount: extraction.content.wordCount,
    imageCount: extraction.images.length,
    ctaAboveFoldMobile: Boolean((mobileCta ?? desktopCta)?.aboveFold),
    ctaSticky: extraction.ctaPositions.some((c) => c.sticky),
  };
}
