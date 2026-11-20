import type { ConversionInput, VisibilityInput } from '@rankforge/scoring';
import type { Extraction } from '@rankforge/schema';
import type { CoreWebVitals } from './psi.js';
import type { EntityGapResult } from './entity-gap.js';
import type { OnPageAudit } from './onpage-audit.js';
import type { SchemaAudit } from './schema-audit.js';
import type { TrustCategoryResult } from './trust-category.js';
import type { VisualRubric } from './visual-cro.js';
import { detectTrustElements } from '../competitors/profile.js';

export interface AnalysisSignals {
  schema: SchemaAudit;
  onPage: OnPageAudit;
  cwv: CoreWebVitals | null;
  gap: EntityGapResult;
  trust: TrustCategoryResult | null;
}

/** Maps measured facts to the visibility scoring input (spec 7.1). */
export function buildVisibilityInput(s: AnalysisSignals): VisibilityInput {
  const answered = s.gap.querySequence.filter((q) => q.answered).length;
  return {
    schema: {
      hasProductSchema: s.schema.hasProductSchema,
      hasOfferSchema: s.schema.hasOfferSchema,
      hasBrandSchema: s.schema.hasBrandSchema,
      hasBreadcrumbList: s.schema.hasBreadcrumbList,
    },
    entities: {
      totalConsensusEntities: s.gap.consensusEntities.length,
      foundConsensusEntities: s.gap.found.length,
    },
    cwv: s.cwv ? { lcpSeconds: s.cwv.lcpSeconds, inpMs: s.cwv.inpMs, cls: s.cwv.cls } : undefined,
    queries: { totalQueries: s.gap.querySequence.length, answeredQueries: answered },
    structure: s.onPage.structure,
    images: s.onPage.images,
  };
}

const TAX_NOTICE = /inclusive of (all )?(taxes|gst)|incl\.? (of )?(gst|taxes?)|taxes? included|incl\. tax/i;
const DISCOUNT_TEXT = /\d+ ?% ?off|save \d|you save|discount/i;

/** Maps measured facts, plus the visual rubric when available, to the conversion scoring input (spec 7.2). */
export function buildConversionInput(
  extraction: Extraction,
  s: Pick<AnalysisSignals, 'cwv' | 'trust'>,
  rubric?: VisualRubric
): ConversionInput {
  const text = extraction.content.text;
  const trust = new Set(detectTrustElements(text));
  const mobileCtas = extraction.ctaPositions.filter((c) => c.viewport === 'mobile');
  const ctas = mobileCtas.length ? mobileCtas : extraction.ctaPositions;
  const price = extraction.price;
  const heights = ctas.map((c) => c.heightPx).filter((h): h is number => typeof h === 'number');

  return {
    atc: {
      isAboveFoldMobile: ctas.some((c) => c.aboveFold),
      hasStickyAtc: extraction.ctaPositions.some((c) => c.sticky),
      hasClearVariantSelection: extraction.variants.length === 0 ? true : rubric ? rubric.variantSelectorClear : true,
    },
    reassurance: {
      hasDeliveryEstimateOrPincode: trust.has('delivery') || trust.has('free_shipping'),
      hasCodAndUpi: trust.has('cod') && trust.has('upi'),
      hasReturnsSummaryNearCta: trust.has('returns') && (rubric ? rubric.reassuranceNearCta : true),
    },
    trust: {
      hasReviewCountNearTitle: (extraction.reviews.reviewCount ?? 0) > 0 && (rubric ? rubric.reviewsNearTitle : true),
      visibleReviewCount: extraction.reviews.items.length,
      hasTrustBadges: trust.has('certification') || trust.has('secure_payment') || trust.has('guarantee') || Boolean(rubric?.trustBadgesVisible),
      toneAndTrustScore: s.trust?.toneAndTrustScore ?? 2,
    },
    pricing: {
      hasMrp: price?.mrp !== undefined,
      hasSellingPrice: price?.selling !== undefined,
      hasDiscountBadge: price?.discountPercent !== undefined || DISCOUNT_TEXT.test(text),
      hasTaxesInclusiveNotice: TAX_NOTICE.test(text),
    },
    usability: {
      tapTargets48pxPlus: heights.length > 0 && heights.every((h) => h >= 48),
      noIntrusiveInterstitials: (extraction.pageSignals?.hiddenOverlays ?? 0) === 0,
      readableFontSizes: extraction.designTokens.baseFontSizePx >= 14,
      noLayoutShiftNearCta: s.cwv?.cls === undefined ? true : s.cwv.cls <= 0.1,
    },
  };
}
