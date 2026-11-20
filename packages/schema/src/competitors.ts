import { z } from 'zod';

/** One organic result from the SERP API. */
export const SerpOrganicResultSchema = z.object({
  position: z.number().int().min(1),
  url: z.string().url(),
  title: z.string(),
  snippet: z.string().default(''),
  domain: z.string(),
});
export type SerpOrganicResult = z.infer<typeof SerpOrganicResultSchema>;

export const SerpResultSchema = z.object({
  keyword: z.string(),
  organic: z.array(SerpOrganicResultSchema),
  peopleAlsoAsk: z.array(z.object({ question: z.string(), answer: z.string().optional() })),
  relatedSearches: z.array(z.string()),
});
export type SerpResult = z.infer<typeof SerpResultSchema>;

/** A source cited by an AI answer, with the grounding redirect already resolved. */
export const AiCitedSourceSchema = z.object({
  url: z.string().url(),
  title: z.string(),
});
export type AiCitedSource = z.infer<typeof AiCitedSourceSchema>;

export const GroundingResultSchema = z.object({
  keyword: z.string(),
  sources: z.array(AiCitedSourceSchema),
  /** Google requires the Search entry point to be displayed alongside grounded answers. */
  searchEntryPointHtml: z.string().optional(),
  searchQueries: z.array(z.string()).default([]),
  /** Set when grounding could not run (for example no quota); the audit continues without AI-cited sources. */
  unavailableReason: z.string().optional(),
});
export type GroundingResult = z.infer<typeof GroundingResultSchema>;

export const TrustElementKindEnum = z.enum([
  'reviews',
  'certification',
  'cod',
  'upi',
  'returns',
  'delivery',
  'warranty',
  'secure_payment',
  'free_shipping',
  'guarantee',
]);
export type TrustElementKind = z.infer<typeof TrustElementKindEnum>;

export const ImageTypeEnum = z.enum(['lifestyle', 'infographic', 'size_chart', 'packaging', 'detail', 'product']);
export type ImageType = z.infer<typeof ImageTypeEnum>;

/** Features derived from one competitor page; the consensus model is computed from these. */
export const CompetitorProfileSchema = z.object({
  competitorId: z.string(),
  url: z.string().url(),
  sections: z.array(z.string()),
  entities: z.array(z.string()),
  schemaTypes: z.array(z.string()),
  trust: z.array(TrustElementKindEnum),
  imageTypes: z.array(ImageTypeEnum),
  wordCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  ctaAboveFoldMobile: z.boolean(),
  ctaSticky: z.boolean(),
});
export type CompetitorProfile = z.infer<typeof CompetitorProfileSchema>;

export const ConsensusModelSchema = z.object({
  competitorCount: z.number().int().nonnegative(),
  lowConfidence: z.boolean(),
  sectionSequence: z.array(
    z.object({ heading: z.string(), frequency: z.number().int(), medianPosition: z.number() })
  ),
  entities: z.array(z.object({ name: z.string(), frequency: z.number().int() })),
  schemaTypes: z.array(z.object({ type: z.string(), frequency: z.number().int() })),
  trustElements: z.array(z.object({ kind: TrustElementKindEnum, frequency: z.number().int() })),
  imageTypes: z.array(z.object({ type: ImageTypeEnum, frequency: z.number().int() })),
  cta: z.object({ aboveFoldMobileShare: z.number(), stickyShare: z.number() }),
  medianWordCount: z.number(),
  medianImageCount: z.number(),
});
export type ConsensusModel = z.infer<typeof ConsensusModelSchema>;
