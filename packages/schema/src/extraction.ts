import { z } from 'zod';
import { PlatformTypeEnum } from './platform.js';

export const EXTRACTION_VERSION = 1 as const;

export const HydrationModeEnum = z.enum(['server', 'runtime']);
export type HydrationMode = z.infer<typeof HydrationModeEnum>;

export const PlatformProductDataSchema = z.object({
  source: z.enum(['shopify_json', 'woocommerce_store_api']),
  title: z.string(),
  handle: z.string().optional(),
  vendor: z.string().optional(),
  productType: z.string().optional(),
  tags: z.array(z.string()).default([]),
  descriptionHtml: z.string().default(''),
  images: z.array(z.object({ src: z.string(), alt: z.string().default('') })).default([]),
  variants: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).transform(String),
        title: z.string(),
        price: z.string().optional(),
        compareAtPrice: z.string().optional(),
        sku: z.string().optional(),
        available: z.boolean().optional(),
      })
    )
    .default([]),
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).default([]),
  currency: z.string().optional(),
});
export type PlatformProductData = z.infer<typeof PlatformProductDataSchema>;

export const PlatformInfoSchema = z.object({
  type: PlatformTypeEnum,
  confidence: z.number().min(0).max(1),
  signals: z.array(z.string()).default([]),
  productData: PlatformProductDataSchema.optional(),
});
export type PlatformInfo = z.infer<typeof PlatformInfoSchema>;

export const HydrationInfoSchema = z.object({
  mode: HydrationModeEnum,
  framework: z.enum(['react', 'next', 'vue', 'nuxt', 'angular', 'svelte', 'hydrogen', 'none']),
  signals: z.array(z.string()).default([]),
  sentinelSurvived: z.boolean().nullable(),
});
export type HydrationInfo = z.infer<typeof HydrationInfoSchema>;

export interface HeadingNode {
  level: number;
  text: string;
  children: HeadingNode[];
}
export const HeadingNodeSchema: z.ZodType<HeadingNode> = z.lazy(() =>
  z.object({
    level: z.number().int().min(1).max(6),
    text: z.string(),
    children: z.array(HeadingNodeSchema),
  })
);

export const ExtractedImageSchema = z.object({
  src: z.string(),
  alt: z.string(),
  role: z.enum(['hero', 'gallery', 'other']),
  width: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
});
export type ExtractedImage = z.infer<typeof ExtractedImageSchema>;

export const ExtractedPriceSchema = z.object({
  raw: z.string(),
  currency: z.string().optional(),
  selling: z.number().nonnegative().optional(),
  mrp: z.number().nonnegative().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
});
export type ExtractedPrice = z.infer<typeof ExtractedPriceSchema>;

export const ExtractedVariantSchema = z.object({
  name: z.string(),
  values: z.array(z.string()),
  selector: z.string().optional(),
});
export type ExtractedVariant = z.infer<typeof ExtractedVariantSchema>;

export const ExtractedReviewsSchema = z.object({
  ratingValue: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  items: z
    .array(
      z.object({
        author: z.string().optional(),
        rating: z.number().min(0).max(5).optional(),
        text: z.string(),
      })
    )
    .default([]),
});
export type ExtractedReviews = z.infer<typeof ExtractedReviewsSchema>;

export const CtaPositionSchema = z.object({
  text: z.string(),
  selector: z.string(),
  viewport: z.enum(['mobile', 'desktop']),
  top: z.number(),
  aboveFold: z.boolean(),
  sticky: z.boolean(),
  /** Rendered height in CSS px, used for the 48 px tap-target check. */
  heightPx: z.number().nonnegative().optional(),
});
export type CtaPosition = z.infer<typeof CtaPositionSchema>;

export const DesignTokensSchema = z.object({
  fontFamilies: z.array(z.string()),
  baseFontSizePx: z.number().positive(),
  colors: z.array(z.object({ value: z.string(), count: z.number().int().positive() })),
  borderRadiiPx: z.array(z.number().nonnegative()),
});
export type DesignTokens = z.infer<typeof DesignTokensSchema>;

export const ComponentKindEnum = z.enum([
  'gallery',
  'variantSelector',
  'addToCart',
  'price',
  'reviews',
  'description',
  'accordion',
  'breadcrumb',
  'header',
  'footer',
  'other',
]);
export type ComponentKind = z.infer<typeof ComponentKindEnum>;

export const ComponentInventoryItemSchema = z.object({
  kind: ComponentKindEnum,
  selector: z.string(),
  classes: z.array(z.string()),
});
export type ComponentInventoryItem = z.infer<typeof ComponentInventoryItemSchema>;

export const PageMetaSchema = z.object({
  title: z.string(),
  description: z.string(),
  canonical: z.string().optional(),
  robots: z.string().optional(),
  lang: z.string().optional(),
  ogTitle: z.string().optional(),
  ogImage: z.string().optional(),
  viewport: z.string().optional(),
});
export type PageMeta = z.infer<typeof PageMetaSchema>;

export const ExtractionSchema = z.object({
  version: z.literal(EXTRACTION_VERSION),
  auditId: z.string().min(1),
  sourceUrl: z.string().url(),
  finalUrl: z.string().url(),
  capturedAt: z.string().datetime(),
  source: z.enum(['live', 'html_paste']),
  platform: PlatformInfoSchema,
  hydration: HydrationInfoSchema,
  meta: PageMetaSchema,
  content: z.object({
    h1: z.string(),
    text: z.string(),
    wordCount: z.number().int().nonnegative(),
  }),
  headingTree: z.array(HeadingNodeSchema),
  jsonLd: z.array(z.record(z.string(), z.unknown())),
  images: z.array(ExtractedImageSchema),
  price: ExtractedPriceSchema.optional(),
  variants: z.array(ExtractedVariantSchema),
  reviews: ExtractedReviewsSchema,
  ctaPositions: z.array(CtaPositionSchema),
  designTokens: DesignTokensSchema,
  components: z.array(ComponentInventoryItemSchema),
  classWhitelist: z.array(z.string()),
  /** Facts that are lost when the snapshot is rewritten (preload links, hidden pop-ups). */
  pageSignals: z
    .object({
      heroPreloaded: z.boolean(),
      hiddenOverlays: z.number().int().nonnegative(),
      /** LCP and CLS measured in our own mobile Chromium (unthrottled lab run), used when PageSpeed Insights is unavailable. */
      cwvLab: z.object({ lcpSeconds: z.number().nonnegative().optional(), cls: z.number().nonnegative().optional() }).optional(),
    })
    .optional(),
  stats: z.object({
    blockedRequests: z.number().int().nonnegative(),
    stubbedRequests: z.number().int().nonnegative(),
    assetCount: z.number().int().nonnegative(),
    renderMs: z.number().nonnegative(),
    imagesDisabled: z.boolean(),
  }),
});
export type Extraction = z.infer<typeof ExtractionSchema>;
