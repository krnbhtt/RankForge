import { describe, it, expect } from 'vitest';
import {
  calculateVisibilityScore,
  calculateConversionScore,
  calculatePPI,
  generateScoreCard,
  compareScores,
} from '../src/index.js';

describe('Visibility Scoring Engine', () => {
  it('returns 0 for empty visibility input', () => {
    const result = calculateVisibilityScore({});
    expect(result.score).toBe(0);
    expect(result.breakdown.product_schema).toBe(0);
    expect(result.breakdown.entity_coverage).toBe(0);
    expect(result.breakdown.core_web_vitals).toBe(0);
    expect(result.breakdown.query_sequence_coverage).toBe(0);
    expect(result.breakdown.on_page_structure).toBe(0);
    expect(result.breakdown.image_seo).toBe(0);
  });

  it('calculates perfect 100 visibility score when all rules pass', () => {
    const result = calculateVisibilityScore({
      schema: {
        hasProductSchema: true,
        hasOfferSchema: true,
        hasBrandSchema: true,
        hasBreadcrumbList: true,
      },
      entities: {
        totalConsensusEntities: 10,
        foundConsensusEntities: 10,
      },
      cwv: {
        lcpSeconds: 2.1,
        inpMs: 150,
        cls: 0.05,
      },
      queries: {
        totalQueries: 5,
        answeredQueries: 5,
      },
      structure: {
        hasTitle: true,
        isTitleLengthOptimal: true,
        hasMetaDescription: true,
        hasSingleH1: true,
        hasH2H3Hierarchy: true,
        hasCanonical: true,
      },
      images: {
        allHaveAltText: true,
        descriptiveFilenames: true,
        imageCount: 5,
        isHeroPreloaded: true,
      },
    });

    expect(result.breakdown.product_schema).toBe(25);
    expect(result.breakdown.entity_coverage).toBe(20);
    expect(result.breakdown.core_web_vitals).toBe(20);
    expect(result.breakdown.query_sequence_coverage).toBe(15);
    expect(result.breakdown.on_page_structure).toBe(10);
    expect(result.breakdown.image_seo).toBe(10);
    expect(result.score).toBe(100);
  });

  it('correctly applies partial credit for Core Web Vitals linear scales', () => {
    // LCP: 3.25s (halfway between 2.5 and 4.0 => 4 pts out of 8)
    // INP: 350ms (halfway between 200 and 500 => 3 pts out of 6)
    // CLS: 0.175 (halfway between 0.10 and 0.25 => 3 pts out of 6)
    // Expected CWV: 4 + 3 + 3 = 10 pts
    const result = calculateVisibilityScore({
      cwv: {
        lcpSeconds: 3.25,
        inpMs: 350,
        cls: 0.175,
      },
    });

    expect(result.breakdown.core_web_vitals).toBe(10);
  });
});

describe('Conversion Scoring Engine', () => {
  it('returns 0 for empty conversion input', () => {
    const result = calculateConversionScore({});
    expect(result.score).toBe(0);
    expect(result.breakdown.add_to_cart).toBe(0);
    expect(result.breakdown.delivery_payment_returns).toBe(0);
    expect(result.breakdown.trust_and_proof).toBe(0);
    expect(result.breakdown.price_and_offer_clarity).toBe(0);
    expect(result.breakdown.friction_and_mobile_usability).toBe(0);
  });

  it('calculates perfect 100 conversion score when all criteria are met', () => {
    const result = calculateConversionScore({
      atc: {
        isAboveFoldMobile: true,
        hasStickyAtc: true,
        hasClearVariantSelection: true,
      },
      reassurance: {
        hasDeliveryEstimateOrPincode: true,
        hasCodAndUpi: true,
        hasReturnsSummaryNearCta: true,
      },
      trust: {
        hasReviewCountNearTitle: true,
        visibleReviewCount: 4,
        hasTrustBadges: true,
        toneAndTrustScore: 4,
      },
      pricing: {
        hasMrp: true,
        hasSellingPrice: true,
        hasDiscountBadge: true,
        hasTaxesInclusiveNotice: true,
      },
      usability: {
        tapTargets48pxPlus: true,
        noIntrusiveInterstitials: true,
        readableFontSizes: true,
        noLayoutShiftNearCta: true,
      },
    });

    expect(result.breakdown.add_to_cart).toBe(25);
    expect(result.breakdown.delivery_payment_returns).toBe(20);
    expect(result.breakdown.trust_and_proof).toBe(20);
    expect(result.breakdown.price_and_offer_clarity).toBe(15);
    expect(result.breakdown.friction_and_mobile_usability).toBe(20);
    expect(result.score).toBe(100);
  });

  it('evaluates India-specific trust signals (COD, UPI, delivery estimate, MRP)', () => {
    const result = calculateConversionScore({
      reassurance: {
        hasDeliveryEstimateOrPincode: true,
        hasCodAndUpi: true,
        hasReturnsSummaryNearCta: false,
      },
      pricing: {
        hasMrp: true,
        hasSellingPrice: true,
        hasDiscountBadge: false,
        hasTaxesInclusiveNotice: false,
      },
    });

    expect(result.breakdown.delivery_payment_returns).toBe(14);
    expect(result.breakdown.price_and_offer_clarity).toBe(8);
  });
});

describe('Page Performance Index (PPI) Engine', () => {
  it('calculates PPI accurately as (Visibility * Conversion) / 100', () => {
    expect(calculatePPI(80, 50)).toBe(40);
    expect(calculatePPI(100, 100)).toBe(100);
    expect(calculatePPI(0, 100)).toBe(0);
    expect(calculatePPI(100, 0)).toBe(0);
    expect(calculatePPI(65.4, 72.1)).toBe(47.2);
  });

  it('generates a full scorecard with deltas', () => {
    const card = generateScoreCard(
      {
        structure: {
          hasTitle: true,
          isTitleLengthOptimal: true,
          hasMetaDescription: true,
          hasSingleH1: true,
          hasH2H3Hierarchy: true,
          hasCanonical: true,
        },
      },
      {
        pricing: {
          hasMrp: true,
          hasSellingPrice: true,
          hasDiscountBadge: true,
          hasTaxesInclusiveNotice: true,
        },
      }
    );

    expect(card.visibility.current).toBe(10);
    expect(card.conversion.current).toBe(15);
    expect(card.ppi.current).toBe(1.5);
  });

  it('compares baseline and optimized states with delta attribution', () => {
    const comparison = compareScores({
      baseline: {
        visibility: {
          structure: {
            hasTitle: true,
            isTitleLengthOptimal: false,
            hasMetaDescription: false,
            hasSingleH1: false,
            hasH2H3Hierarchy: false,
            hasCanonical: false,
          },
        },
        conversion: {},
      },
      optimized: {
        visibility: {
          schema: {
            hasProductSchema: true,
            hasOfferSchema: true,
            hasBrandSchema: true,
            hasBreadcrumbList: true,
          },
          structure: {
            hasTitle: true,
            isTitleLengthOptimal: true,
            hasMetaDescription: true,
            hasSingleH1: true,
            hasH2H3Hierarchy: true,
            hasCanonical: true,
          },
        },
        conversion: {
          reassurance: {
            hasDeliveryEstimateOrPincode: true,
            hasCodAndUpi: true,
            hasReturnsSummaryNearCta: true,
          },
        },
      },
      attributions: [
        {
          ruleId: 'product_schema',
          ruleName: 'Product schema injection',
          category: 'visibility',
          delta: 25,
          reason: 'Injected valid Product, Offer, Brand, and BreadcrumbList JSON-LD schema',
        },
        {
          ruleId: 'reassurance',
          ruleName: 'India trust block',
          category: 'conversion',
          delta: 20,
          reason: 'Added COD, UPI, delivery estimate, and 7-day easy returns block near CTA',
        },
      ],
    });

    expect(comparison.baselineScoreCard.visibility.current).toBe(1);
    expect(comparison.optimizedScoreCard.visibility.current).toBe(35);
    expect(comparison.deltas.visibility).toBe(34);
    expect(comparison.deltas.conversion).toBe(20);
    expect(comparison.optimizedScoreCard.attributions.length).toBe(2);
  });
});
