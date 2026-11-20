export interface ConversionInput {
  atc?: {
    isAboveFoldMobile: boolean;
    hasStickyAtc: boolean;
    hasClearVariantSelection: boolean;
  };
  reassurance?: {
    hasDeliveryEstimateOrPincode: boolean;
    hasCodAndUpi: boolean;
    hasReturnsSummaryNearCta: boolean;
  };
  trust?: {
    hasReviewCountNearTitle: boolean;
    visibleReviewCount: number; // >= 4 is max
    hasTrustBadges: boolean;
    toneAndTrustScore: number; // 0 - 4
  };
  pricing?: {
    hasMrp: boolean;
    hasSellingPrice: boolean;
    hasDiscountBadge: boolean;
    hasTaxesInclusiveNotice: boolean;
  };
  usability?: {
    tapTargets48pxPlus: boolean;
    noIntrusiveInterstitials: boolean;
    readableFontSizes: boolean;
    noLayoutShiftNearCta: boolean;
  };
}

export interface ConversionScoreResult {
  score: number; // 0 - 100
  breakdown: {
    add_to_cart: number; // max 25
    delivery_payment_returns: number; // max 20
    trust_and_proof: number; // max 20
    price_and_offer_clarity: number; // max 15
    friction_and_mobile_usability: number; // max 20
  };
}

export function calculateConversionScore(input: ConversionInput): ConversionScoreResult {
  // 1. Add-to-cart experience (max 25 pts)
  let atcPoints = 0;
  if (input.atc) {
    if (input.atc.isAboveFoldMobile) atcPoints += 10;
    if (input.atc.hasStickyAtc) atcPoints += 8;
    if (input.atc.hasClearVariantSelection) atcPoints += 7;
  }

  // 2. Delivery, payment and returns reassurance (max 20 pts)
  let reassurancePoints = 0;
  if (input.reassurance) {
    if (input.reassurance.hasDeliveryEstimateOrPincode) reassurancePoints += 7;
    if (input.reassurance.hasCodAndUpi) reassurancePoints += 7;
    if (input.reassurance.hasReturnsSummaryNearCta) reassurancePoints += 6;
  }

  // 3. Trust and proof (max 20 pts)
  let trustPoints = 0;
  if (input.trust) {
    if (input.trust.hasReviewCountNearTitle) trustPoints += 5;
    if (input.trust.visibleReviewCount >= 4) {
      trustPoints += 6;
    } else if (input.trust.visibleReviewCount > 0) {
      trustPoints += Math.round((input.trust.visibleReviewCount / 4) * 6);
    }
    if (input.trust.hasTrustBadges) trustPoints += 5;
    if (input.trust.toneAndTrustScore > 0) {
      trustPoints += Math.min(4, Math.max(0, input.trust.toneAndTrustScore));
    }
  }

  // 4. Price and offer clarity (max 15 pts)
  let pricePoints = 0;
  if (input.pricing) {
    if (input.pricing.hasMrp) pricePoints += 4;
    if (input.pricing.hasSellingPrice) pricePoints += 4;
    if (input.pricing.hasDiscountBadge) pricePoints += 4;
    if (input.pricing.hasTaxesInclusiveNotice) pricePoints += 3;
  }

  // 5. Friction and mobile usability (max 20 pts)
  let usabilityPoints = 0;
  if (input.usability) {
    if (input.usability.tapTargets48pxPlus) usabilityPoints += 6;
    if (input.usability.noIntrusiveInterstitials) usabilityPoints += 5;
    if (input.usability.readableFontSizes) usabilityPoints += 5;
    if (input.usability.noLayoutShiftNearCta) usabilityPoints += 4;
  }

  const total = Math.min(
    100,
    Math.round(
      (atcPoints + reassurancePoints + trustPoints + pricePoints + usabilityPoints) * 10
    ) / 10
  );

  return {
    score: total,
    breakdown: {
      add_to_cart: atcPoints,
      delivery_payment_returns: reassurancePoints,
      trust_and_proof: trustPoints,
      price_and_offer_clarity: pricePoints,
      friction_and_mobile_usability: usabilityPoints,
    },
  };
}
