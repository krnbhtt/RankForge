import { z } from 'zod';

// ==========================================
// 1. Audit Lifecycle & Status Contracts
// ==========================================

export const AuditStatusEnum = z.enum([
  'queued',
  'capturing',
  'captured',
  'awaiting_keyword',
  'discovering',
  'competitors',
  'analysing',
  'analysed',
  'blueprinted',
  'rebuilding',
  'verifying',
  'complete',
  'blocked',
  'failed',
]);
export type AuditStatus = z.infer<typeof AuditStatusEnum>;

export const AuditStageEnum = z.enum([
  'init',
  'scrape_target',
  'detect_platform',
  'discover_competitors',
  'crawl_competitors',
  'gap_analysis',
  'generate_patches',
  'scoring',
  'finalize',
]);
export type AuditStage = z.infer<typeof AuditStageEnum>;

export const AuditErrorSchema = z.object({
  code: z.enum([
    'UserInputError',
    'BlockedSiteError',
    'UpstreamModelError',
    'QuotaError',
    'PatchError',
    'InternalError',
  ]),
  message: z.string(),
  recoveryAction: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().datetime(),
});
export type AuditError = z.infer<typeof AuditErrorSchema>;

// ==========================================
// 2. Feature Flags Contract
// ==========================================

export const FeatureFlagsSchema = z.object({
  IMAGE_GENERATION: z.boolean().default(false),
  VISUAL_CRO_AUDIT: z.boolean().default(true),
  RUNTIME_PATCH_MODE: z.boolean().default(false),
  COMPLIANCE_CHECKS: z.boolean().default(true),
  SHARE_LINKS: z.boolean().default(true),
  WORKSPACES: z.boolean().default(false),
  COST_CAP_INR: z.number().positive().default(25),
});
export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;

// ==========================================
// 3. Scraping & AST Capture Contracts
// ==========================================

import { PlatformTypeEnum } from './platform.js';
export { PlatformTypeEnum };
export type PlatformType = z.infer<typeof PlatformTypeEnum>;

export const AssetSnapshotSchema = z.object({
  originalUrl: z.string().url(),
  proxiedUrl: z.string().url().optional(),
  gcsPath: z.string().optional(),
  contentType: z.string(),
  byteSize: z.number().nonnegative(),
  sha256: z.string(),
});
export type AssetSnapshot = z.infer<typeof AssetSnapshotSchema>;

export const PerformanceMetricsSchema = z.object({
  lcp: z.number().nonnegative().describe('Largest Contentful Paint in seconds'),
  inp: z.number().nonnegative().describe('Interaction to Next Paint in milliseconds'),
  cls: z.number().nonnegative().describe('Cumulative Layout Shift score'),
  fcp: z.number().nonnegative().optional().describe('First Contentful Paint in seconds'),
  ttfb: z.number().nonnegative().optional().describe('Time to First Byte in milliseconds'),
});
export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;

export interface DOMNodeAST {
  nodeType: number;
  tagName?: string;
  attributes?: Record<string, string>;
  children?: DOMNodeAST[];
  textContent?: string;
}

export const DOMNodeASTSchema: z.ZodType<DOMNodeAST> = z.lazy(() =>
  z.object({
    nodeType: z.number().int(),
    tagName: z.string().optional(),
    attributes: z.record(z.string(), z.string()).optional(),
    children: z.array(DOMNodeASTSchema).optional(),
    textContent: z.string().optional(),
  })
);

export const ScrapeResultSchema = z.object({
  auditId: z.string().uuid(),
  targetUrl: z.string().url(),
  finalUrl: z.string().url(),
  title: z.string().default(''),
  metaDescription: z.string().default(''),
  h1: z.string().default(''),
  platform: PlatformTypeEnum,
  rawHtmlGcsPath: z.string().optional(),
  cleanAst: DOMNodeASTSchema.optional(),
  assets: z.array(AssetSnapshotSchema).default([]),
  structuredData: z.array(z.record(z.string(), z.unknown())).default([]),
  performance: PerformanceMetricsSchema.optional(),
  capturedAt: z.string().datetime(),
});
export type ScrapeResult = z.infer<typeof ScrapeResultSchema>;

// ==========================================
// 4. Competitor Records Contract
// ==========================================

export const CompetitorRecordSchema = z.object({
  competitorUrl: z.string().url(),
  rankPosition: z.number().int().min(1).max(20),
  title: z.string(),
  h1: z.string().optional(),
  price: z.number().nonnegative().optional(),
  currency: z.string().default('INR'),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  inStock: z.boolean().optional(),
  trustSignals: z.array(z.string()).default([]),
  structuredData: z.array(z.record(z.string(), z.unknown())).default([]),
  detectedFeatures: z.array(z.string()).default([]),
  scrapedAt: z.string().datetime(),
});
export type CompetitorRecord = z.infer<typeof CompetitorRecordSchema>;

// ==========================================
// 5. Gap Analysis Contracts
// ==========================================

export const FrictionPointSchema = z.object({
  id: z.string(),
  type: z.enum([
    'atc_below_fold',
    'missing_sticky_atc',
    'unclear_variant_selection',
    'missing_delivery_estimate',
    'missing_payment_badges',
    'missing_returns_summary',
    'small_tap_targets',
    'missing_mrp_discount',
    'absent_reviews',
  ]),
  description: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  penaltyPoints: z.number().nonnegative(),
});
export type FrictionPoint = z.infer<typeof FrictionPointSchema>;

export const GapAnalysisResultSchema = z.object({
  auditId: z.string().uuid(),
  missingKeywords: z.array(z.string()).default([]),
  missingEntities: z.array(z.string()).default([]),
  unansweredQueries: z.array(z.string()).default([]),
  suggestedCategory: z.string().optional(),
  currentCategory: z.string().optional(),
  conversionFriction: z.array(FrictionPointSchema).default([]),
  trustGaps: z.array(z.string()).default([]),
  policyGaps: z.array(z.string()).default([]),
  competitorInsights: z.array(z.string()).default([]),
  analyzedAt: z.string().datetime(),
});
export type GapAnalysisResult = z.infer<typeof GapAnalysisResultSchema>;

// ==========================================
// 6. DOM Patch Operations Contracts
// ==========================================

export const PatchActionEnum = z.enum([
  'setText',
  'setAttr',
  'insertBefore',
  'insertAfter',
  'move',
  'remove',
  'setHeadMeta',
  'injectJsonLd',
]);
export type PatchAction = z.infer<typeof PatchActionEnum>;

export const PatchTagEnum = z.enum(['Ranking', 'Conversion', 'Both']);
export type PatchTag = z.infer<typeof PatchTagEnum>;

export const PatchOperationSchema = z.object({
  id: z.string(),
  targetSelector: z.string(),
  action: PatchActionEnum,
  htmlPayload: z.string(),
  tag: PatchTagEnum,
  evidenceReason: z.string(),
  estimatedScoreDelta: z.object({
    visibility: z.number().default(0),
    conversion: z.number().default(0),
  }),
  isSample: z.boolean().default(false),
  status: z.enum(['pending', 'applied', 'failed']).default('pending'),
  createdAt: z.string().datetime(),
});
export type PatchOperation = z.infer<typeof PatchOperationSchema>;

// ==========================================
// 7. Scoring Engine Contracts
// ==========================================

export const ScoreAttributionSchema = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  category: z.enum(['visibility', 'conversion']),
  delta: z.number(),
  reason: z.string(),
  patchId: z.string().optional(),
  isSample: z.boolean().default(false),
});
export type ScoreAttribution = z.infer<typeof ScoreAttributionSchema>;

export const ScoreBreakdownSchema = z.record(z.string(), z.number());
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

export const ScoreComponentSchema = z.object({
  current: z.number().min(0).max(100),
  baseline: z.number().min(0).max(100),
  delta: z.number(),
  max: z.number().default(100),
  breakdown: ScoreBreakdownSchema,
});
export type ScoreComponent = z.infer<typeof ScoreComponentSchema>;

export const ScoreCardSchema = z.object({
  visibility: ScoreComponentSchema,
  conversion: ScoreComponentSchema,
  ppi: z.object({
    current: z.number().min(0).max(100),
    baseline: z.number().min(0).max(100),
    delta: z.number(),
  }),
  attributions: z.array(ScoreAttributionSchema).default([]),
  computedAt: z.string().datetime(),
});
export type ScoreCard = z.infer<typeof ScoreCardSchema>;

// ==========================================
// 8. Top-Level Audit Record (Firestore Document)
// ==========================================

/** Summary of the target capture, written when the reproduction is ready (spec 4.2 step 2). */
export const CaptureSummarySchema = z.object({
  source: z.enum(['live', 'html_paste']),
  finalUrl: z.string().url(),
  renderMs: z.number().nonnegative(),
  snapshotMs: z.number().nonnegative(),
  analysisMs: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  hydrationMode: z.enum(['server', 'runtime']),
  imagesDisabled: z.boolean(),
  title: z.string(),
});
export type CaptureSummary = z.infer<typeof CaptureSummarySchema>;

/** Body of POST /api/audits/{id}/html (spec F1.3). */
export const HtmlPasteInputSchema = z.object({
  html: z
    .string()
    .min(200, 'Paste the full page HTML (View Source, then copy all)')
    .max(5_000_000, 'The pasted HTML is larger than 5 MB'),
});
export type HtmlPasteInput = z.infer<typeof HtmlPasteInputSchema>;

export const AuditRecordSchema = z.object({
  auditId: z
    .string()
    .min(1, 'auditId is required')
    .regex(/^[a-zA-Z0-9_-]+$/, 'auditId must be alphanumeric with underscores or hyphens'),
  wsId: z.string().optional().default('default'),
  userId: z.string().default('anonymous'),
  targetUrl: z
    .string()
    .url()
    .refine(
      (val) => {
        try {
          const parsed = new URL(val);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'targetUrl must use HTTP or HTTPS protocol' }
    ),
  keyword: z.string().optional(),
  keywordCandidates: z.array(z.string()).default([]),
  imageConsent: z.boolean().default(false),
  status: AuditStatusEnum.default('queued'),
  stage: z.string().optional().default('init'),
  progressPercent: z.number().min(0).max(100).default(0),
  platform: PlatformTypeEnum.optional().default('unknown'),
  patchMode: z.enum(['static', 'runtime']).optional().default('static'),
  stageTimings: z.record(z.string(), z.string()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  scores: z
    .object({
      baseline: ScoreCardSchema.optional(),
      optimized: ScoreCardSchema.optional(),
    })
    .optional(),
  error: AuditErrorSchema.optional(),
  shareToken: z.string().optional(),
  totalCostInr: z.number().nonnegative().default(0),
  capture: CaptureSummarySchema.optional(),
});
export type AuditRecord = z.infer<typeof AuditRecordSchema>;

// ==========================================
// 9. Ingress & Task Payload Contracts
// ==========================================

export const AuditCreateInputSchema = z.object({
  url: z
    .string()
    .url('A valid HTTP or HTTPS product URL is required')
    .refine(
      (val) => {
        try {
          const parsed = new URL(val);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'URL must use HTTP or HTTPS protocol' }
    ),
  keyword: z.string().trim().max(100).optional(),
  imageConsent: z.boolean().default(false),
  userId: z.string().optional().default('anonymous'),
});
export type AuditCreateInput = z.infer<typeof AuditCreateInputSchema>;

export const AuditCreateResponseSchema = z.object({
  success: z.boolean().default(true),
  auditId: z.string(),
  status: AuditStatusEnum,
  createdAt: z.string(),
});
export type AuditCreateResponse = z.infer<typeof AuditCreateResponseSchema>;

export const RunAuditTaskInputSchema = z.object({
  auditId: z
    .string()
    .min(1, 'auditId is required')
    .regex(/^[a-zA-Z0-9_-]+$/, 'auditId must be alphanumeric with underscores or hyphens'),
  targetUrl: z
    .string()
    .url()
    .refine(
      (val) => {
        try {
          const parsed = new URL(val);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'targetUrl must use HTTP or HTTPS protocol' }
    ),
  keyword: z.string().optional(),
  imageConsent: z.boolean().default(false),
  fastMode: z.boolean().optional().default(false),
});
export type RunAuditTaskInput = z.infer<typeof RunAuditTaskInputSchema>;

// Legacy task contracts (for backwards compatibility)
export const ScrapeTaskInputSchema = z.object({
  auditId: z
    .string()
    .min(1, 'auditId is required')
    .regex(/^[a-zA-Z0-9_-]+$/, 'auditId must be alphanumeric with underscores or hyphens'),
  targetUrl: z.string().url(),
  keyword: z.string().optional(),
});
export type ScrapeTaskInput = z.infer<typeof ScrapeTaskInputSchema>;

export const AnalyzeTaskInputSchema = z.object({
  auditId: z
    .string()
    .min(1, 'auditId is required')
    .regex(/^[a-zA-Z0-9_-]+$/, 'auditId must be alphanumeric with underscores or hyphens'),
});
export type AnalyzeTaskInput = z.infer<typeof AnalyzeTaskInputSchema>;

export const RebuildTaskInputSchema = z.object({
  auditId: z
    .string()
    .min(1, 'auditId is required')
    .regex(/^[a-zA-Z0-9_-]+$/, 'auditId must be alphanumeric with underscores or hyphens'),
});
export type RebuildTaskInput = z.infer<typeof RebuildTaskInputSchema>;

// ==========================================
// 10. Firestore Subcollection Contracts (Spec §6.1)
// ==========================================

export const AuditCompetitorSchema = z.object({
  competitorId: z.string(),
  auditId: z.string(),
  url: z.string().url(),
  rank: z.number().int().min(1).max(20),
  source: z.enum(['organic', 'ai_cited']).default('organic'),
  status: z.enum(['ok', 'skipped']).default('ok'),
  title: z.string().optional(),
  price: z.number().nonnegative().optional(),
  currency: z.string().default('INR'),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  trustSignals: z.array(z.string()).default([]),
  scrapedAt: z.string().optional(),
});
export type AuditCompetitor = z.infer<typeof AuditCompetitorSchema>;

export const AuditFindingSchema = z.object({
  findingId: z.string(),
  auditId: z.string(),
  category: z.enum(['ranking', 'conversion', 'both']).default('both'),
  tag: z.enum(['Ranking', 'Conversion', 'Both']).default('Both'),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  title: z.string(),
  description: z.string(),
  penaltyPoints: z.number().nonnegative(),
  evidence: z.string().optional(),
  /** How many competitors show the element this finding is about (spec 6.1). */
  competitorCount: z.number().int().nonnegative().optional(),
  /** Screenshot region for annotation, as fractions of the image (spec 6.1). */
  region: z
    .object({ viewport: z.enum(['mobile', 'desktop']), x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .optional(),
  createdAt: z.string(),
});
export type AuditFinding = z.infer<typeof AuditFindingSchema>;

export const AuditQuerySchema = z.object({
  queryId: z.string(),
  auditId: z.string(),
  query: z.string(),
  step: z.number().int().default(1),
  source: z.enum(['paa', 'related', 'grounding']).default('paa'),
  answered: z.boolean().default(false),
  sectionTarget: z.string().optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

import { BlueprintSectionSpecSchema } from './blueprint.js';

export const AuditBlueprintSectionSchema = z.object({
  sectionId: z.string(),
  auditId: z.string(),
  order: z.number().int(),
  name: z.string(),
  strategy: z.string(),
  action: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']).default('pending'),
  /** Full section plan (spec 6.1: type, h2/h3s, depth, justification, component reference). */
  spec: BlueprintSectionSpecSchema.optional(),
});
export type AuditBlueprintSection = z.infer<typeof AuditBlueprintSectionSchema>;

export const AuditPatchSchema = z.object({
  patchId: z.string(),
  auditId: z.string(),
  sectionId: z.string(),
  op: PatchActionEnum,
  targetSelector: z.string(),
  htmlPayload: z.string().optional(),
  tag: z.enum(['Ranking', 'Conversion', 'Both']).default('Both'),
  reason: z.string(),
  isSample: z.boolean().default(false),
  status: z.enum(['pending', 'applied', 'failed']).default('pending'),
  /** Why the operation failed or was dropped, shown in the report. */
  failureReason: z.string().optional(),
  /** The complete operation (attr, move target, replace type, all) so it can be replayed exactly. */
  opJson: z.string().optional(),
  createdAt: z.string(),
});
export type AuditPatch = z.infer<typeof AuditPatchSchema>;

export const AuditImageSchema = z.object({
  imageId: z.string(),
  auditId: z.string(),
  originalUrl: z.string().url().optional(),
  generatedUrl: z.string().url().optional(),
  gcsPath: z.string().optional(),
  prompt: z.string().optional(),
  status: z.enum(['pending', 'ready', 'failed']).default('pending'),
  consentGiven: z.boolean().default(false),
  createdAt: z.string(),
});
export type AuditImage = z.infer<typeof AuditImageSchema>;

export const WorkspaceSchema = z.object({
  wsId: z.string(),
  name: z.string(),
  ownerUid: z.string(),
  createdAt: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const StoreSchema = z.object({
  storeId: z.string(),
  wsId: z.string(),
  domain: z.string(),
  platform: PlatformTypeEnum.default('unknown'),
  createdAt: z.string(),
});
export type Store = z.infer<typeof StoreSchema>;

export * from './extraction.js';
export * from './errors.js';
export * from './competitors.js';
export * from './blueprint.js';
export * from './rebuild.js';
