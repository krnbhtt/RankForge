export interface VisibilityInput {
  schema?: {
    hasProductSchema: boolean;
    hasOfferSchema: boolean;
    hasBrandSchema: boolean;
    hasBreadcrumbList: boolean;
  };
  entities?: {
    totalConsensusEntities: number;
    foundConsensusEntities: number;
  };
  cwv?: {
    lcpSeconds?: number;
    inpMs?: number;
    cls?: number;
  };
  queries?: {
    totalQueries: number;
    answeredQueries: number;
  };
  structure?: {
    hasTitle: boolean;
    isTitleLengthOptimal: boolean;
    hasMetaDescription: boolean;
    hasSingleH1: boolean;
    hasH2H3Hierarchy: boolean;
    hasCanonical: boolean;
  };
  images?: {
    allHaveAltText: boolean;
    descriptiveFilenames: boolean;
    imageCount: number;
    isHeroPreloaded: boolean;
  };
}

export interface VisibilityScoreResult {
  score: number; // 0 - 100
  breakdown: {
    product_schema: number; // max 25
    entity_coverage: number; // max 20
    core_web_vitals: number; // max 20
    query_sequence_coverage: number; // max 15
    on_page_structure: number; // max 10
    image_seo: number; // max 10
  };
}

export function calculateVisibilityScore(input: VisibilityInput): VisibilityScoreResult {
  // 1. Product Schema (max 25 pts)
  let schemaPoints = 0;
  if (input.schema) {
    if (input.schema.hasProductSchema) schemaPoints += 10;
    if (input.schema.hasOfferSchema) schemaPoints += 5;
    if (input.schema.hasBrandSchema) schemaPoints += 5;
    if (input.schema.hasBreadcrumbList) schemaPoints += 5;
  }

  // 2. Entity & Attribute Coverage (max 20 pts)
  let entityPoints = 0;
  if (input.entities && input.entities.totalConsensusEntities > 0) {
    const ratio = Math.min(1, Math.max(0, input.entities.foundConsensusEntities / input.entities.totalConsensusEntities));
    entityPoints = Math.round(ratio * 20 * 10) / 10;
  }

  // 3. Core Web Vitals (max 20 pts)
  let cwvPoints = 0;
  if (input.cwv) {
    // LCP (max 8 pts)
    if (input.cwv.lcpSeconds !== undefined) {
      if (input.cwv.lcpSeconds <= 2.5) {
        cwvPoints += 8;
      } else if (input.cwv.lcpSeconds <= 4.0) {
        // Linear scale between 2.5s (8 pts) and 4.0s (0 pts)
        const partial = 8 * (1 - (input.cwv.lcpSeconds - 2.5) / 1.5);
        cwvPoints += Math.max(0, partial);
      }
    }

    // INP (max 6 pts)
    if (input.cwv.inpMs !== undefined) {
      if (input.cwv.inpMs <= 200) {
        cwvPoints += 6;
      } else if (input.cwv.inpMs <= 500) {
        // Linear scale between 200ms (6 pts) and 500ms (0 pts)
        const partial = 6 * (1 - (input.cwv.inpMs - 200) / 300);
        cwvPoints += Math.max(0, partial);
      }
    }

    // CLS (max 6 pts)
    if (input.cwv.cls !== undefined) {
      if (input.cwv.cls <= 0.1) {
        cwvPoints += 6;
      } else if (input.cwv.cls <= 0.25) {
        // Linear scale between 0.1 (6 pts) and 0.25 (0 pts)
        const partial = 6 * (1 - (input.cwv.cls - 0.1) / 0.15);
        cwvPoints += Math.max(0, partial);
      }
    }
  }
  cwvPoints = Math.round(Math.min(20, cwvPoints) * 10) / 10;

  // 4. Query-sequence coverage (max 15 pts)
  let queryPoints = 0;
  if (input.queries && input.queries.totalQueries > 0) {
    const queryRatio = Math.min(1, Math.max(0, input.queries.answeredQueries / input.queries.totalQueries));
    queryPoints = Math.round(queryRatio * 15 * 10) / 10;
  }

  // 5. On-page structure (max 10 pts)
  let structurePoints = 0;
  if (input.structure) {
    if (input.structure.hasTitle) structurePoints += 1;
    if (input.structure.isTitleLengthOptimal) structurePoints += 1;
    if (input.structure.hasMetaDescription) structurePoints += 2;
    if (input.structure.hasSingleH1) structurePoints += 2;
    if (input.structure.hasH2H3Hierarchy) structurePoints += 2;
    if (input.structure.hasCanonical) structurePoints += 2;
  }
  structurePoints = Math.min(10, structurePoints);

  // 6. Image SEO (max 10 pts)
  let imagePoints = 0;
  if (input.images) {
    if (input.images.allHaveAltText) imagePoints += 3;
    if (input.images.descriptiveFilenames) imagePoints += 2;
    if (input.images.imageCount >= 4) imagePoints += 3;
    else if (input.images.imageCount > 0) imagePoints += Math.round((input.images.imageCount / 4) * 3);
    if (input.images.isHeroPreloaded) imagePoints += 2;
  }
  imagePoints = Math.min(10, imagePoints);

  const total = Math.min(
    100,
    Math.round((schemaPoints + entityPoints + cwvPoints + queryPoints + structurePoints + imagePoints) * 10) / 10
  );

  return {
    score: total,
    breakdown: {
      product_schema: schemaPoints,
      entity_coverage: entityPoints,
      core_web_vitals: cwvPoints,
      query_sequence_coverage: queryPoints,
      on_page_structure: structurePoints,
      image_seo: imagePoints,
    },
  };
}
