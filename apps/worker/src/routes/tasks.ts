import { Router, type Request, type Response } from 'express';
import {
  RunAuditTaskInputSchema,
  AuditErrorSchema,
  type AuditStatus,
  type AuditCompetitor,
  type AuditFinding,
  type AuditQuery,
  type AuditBlueprintSection,
  type AuditPatch,
  type ScoreCard,
} from '@rankforge/schema';
import { getAuditStore } from '../store/audit-store.js';
import { createStorageFromEnv, type ArtifactStorage } from '@rankforge/storage';
import { captureTarget } from '../capture/capture.js';
import { runCaptureStage } from '../pipeline/capture-stage.js';
import { log } from '../lib/log.js';
import { featureFlags } from '@rankforge/config';
import { ExtractionSchema, toRankForgeError } from '@rankforge/schema';
import { SpendTracker } from '../ai/gemini.js';
import { runCompetitorsStage } from '../stages/competitors-stage.js';
import { runAnalysisStage } from '../stages/analysis-stage.js';
import { artifactKeys } from '@rankforge/storage';
import { validateTargetUrl } from '@rankforge/ssrf';


const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Deterministic Phase 0 Mock ScoreCards
export const MOCK_BASELINE_SCORES: ScoreCard = {
  visibility: {
    current: 42,
    baseline: 42,
    delta: 0,
    max: 100,
    breakdown: {
      product_schema: 5,
      entity_coverage: 10,
      core_web_vitals: 14,
      query_sequence_coverage: 5,
      on_page_structure: 5,
      image_seo: 3,
    },
  },
  conversion: {
    current: 36,
    baseline: 36,
    delta: 0,
    max: 100,
    breakdown: {
      add_to_cart: 12,
      delivery_payment_returns: 6,
      trust_and_proof: 4,
      price_and_offer_clarity: 6,
      friction_and_mobile_usability: 8,
    },
  },
  ppi: {
    current: 39,
    baseline: 39,
    delta: 0,
  },
  attributions: [],
  computedAt: new Date().toISOString(),
};

export const MOCK_OPTIMIZED_SCORES: ScoreCard = {
  visibility: {
    current: 78,
    baseline: 42,
    delta: 36,
    max: 100,
    breakdown: {
      product_schema: 24,
      entity_coverage: 18,
      core_web_vitals: 17,
      query_sequence_coverage: 12,
      on_page_structure: 4,
      image_seo: 3,
    },
  },
  conversion: {
    current: 81,
    baseline: 36,
    delta: 45,
    max: 100,
    breakdown: {
      add_to_cart: 23,
      delivery_payment_returns: 18,
      trust_and_proof: 18,
      price_and_offer_clarity: 10,
      friction_and_mobile_usability: 12,
    },
  },
  ppi: {
    current: 79,
    baseline: 39,
    delta: 40,
  },
  attributions: [
    {
      ruleId: 'trust_signals',
      ruleName: 'India Trust & Payment Signals Block',
      category: 'conversion',
      delta: 12,
      reason: 'Injected Cash on Delivery and UPI acceptance guarantees above fold',
      isSample: true,
    },
    {
      ruleId: 'product_schema',
      ruleName: 'Comprehensive Product JSON-LD Schema',
      category: 'visibility',
      delta: 19,
      reason: 'Added valid Product, Offer, AggregateRating, and FAQPage structured data',
      isSample: false,
    },
    {
      ruleId: 'cta_optimization',
      ruleName: 'Above-the-Fold Sticky ATC Button',
      category: 'conversion',
      delta: 11,
      reason: 'Increased CTA contrast, expanded touch target to 52px, added sticky mobile footer',
      isSample: false,
    },
    {
      ruleId: 'entity_coverage',
      ruleName: 'Consensus Semantic Entity Enrichment',
      category: 'visibility',
      delta: 8,
      reason: 'Added missing competitor entities: heat retention, flow rate, spiral ribs',
      isSample: false,
    },
    {
      ruleId: 'query_sequence',
      ruleName: 'Purchase Query Accordion FAQ',
      category: 'visibility',
      delta: 7,
      reason: 'Integrated top organic query answers directly into FAQPage schema',
      isSample: false,
    },
    {
      ruleId: 'mrp_clarity',
      ruleName: 'Legal Metrology MRP & Discount Badge',
      category: 'conversion',
      delta: 6,
      reason: 'Clearly demarcated Maximum Retail Price and inclusive taxes declaration',
      isSample: false,
    },
  ],
  computedAt: new Date().toISOString(),
};

export const MOCK_COMPETITORS: (auditId: string) => AuditCompetitor[] = (auditId) => [
  {
    competitorId: 'comp_1',
    auditId,
    url: 'https://bluebottlecoffee.com/store/dripper',
    rank: 1,
    source: 'organic',
    status: 'ok',
    title: 'Blue Bottle Pour Over Dripper',
    price: 2400,
    currency: 'INR',
    rating: 4.8,
    reviewCount: 512,
    trustSignals: ['Free Shipping', 'COD Available', 'Easy 7-Day Returns'],
  },
  {
    competitorId: 'comp_2',
    auditId,
    url: 'https://hario-usa.com/products/v60-ceramic-dripper',
    rank: 2,
    source: 'organic',
    status: 'ok',
    title: 'Hario V60 Ceramic Coffee Dripper 02',
    price: 2150,
    currency: 'INR',
    rating: 4.9,
    reviewCount: 1240,
    trustSignals: ['Authentic Japanese Ceramic', 'UPI Accepted', 'Same-Day Dispatch'],
  },
  {
    competitorId: 'comp_3',
    auditId,
    url: 'https://fellowproducts.com/products/stagg-x-dripper',
    rank: 3,
    source: 'organic',
    status: 'ok',
    title: 'Fellow Stagg [X] Pour-Over Dripper Set',
    price: 6500,
    currency: 'INR',
    rating: 4.7,
    reviewCount: 380,
    trustSignals: ['1 Year Warranty', 'Express Delivery across India'],
  },
  {
    competitorId: 'comp_4',
    auditId,
    url: 'https://kalita-usa.com/products/wave-185',
    rank: 4,
    source: 'organic',
    status: 'ok',
    title: 'Kalita Wave 185 Ceramic Dripper',
    price: 2800,
    currency: 'INR',
    rating: 4.6,
    reviewCount: 290,
    trustSignals: ['Flat Bottom 3-Hole Design', 'Cash on Delivery'],
  },
  {
    competitorId: 'comp_5',
    auditId,
    url: 'https://timemore.com/collections/crystal-eye',
    rank: 5,
    source: 'ai_cited',
    status: 'ok',
    title: 'TIMEMORE Crystal Eye Dripper 01',
    price: 1850,
    currency: 'INR',
    rating: 4.7,
    reviewCount: 175,
    trustSignals: ['3-Stage Flow Rate Control', 'Heat Resistant'],
  },
  {
    competitorId: 'comp_6',
    auditId,
    url: 'https://origincoffee.co.uk/products/origami-dripper',
    rank: 6,
    source: 'organic',
    status: 'ok',
    title: 'Origami Ceramic Dripper M',
    price: 3200,
    currency: 'INR',
    rating: 4.8,
    reviewCount: 210,
    trustSignals: ['Mino Ware Porcelain', '20-Fold Ribs'],
  },
  {
    competitorId: 'comp_7',
    auditId,
    url: 'https://kinto-usa.com/products/brewer',
    rank: 7,
    source: 'organic',
    status: 'ok',
    title: 'KINTO Oct Brewer 4 Cups',
    price: 2950,
    currency: 'INR',
    rating: 4.5,
    reviewCount: 140,
    trustSignals: ['Japanese Minimalist Design', 'Secure Checkout'],
  },
  {
    competitorId: 'comp_8',
    auditId,
    url: 'https://cafec-jp.com/products/flower-dripper',
    rank: 8,
    source: 'organic',
    status: 'ok',
    title: 'CAFEC Flower Dripper Deep 27',
    price: 2600,
    currency: 'INR',
    rating: 4.7,
    reviewCount: 95,
    trustSignals: ['Flower Ribbed Flow Speed', 'COD Available'],
  },
  {
    competitorId: 'comp_9',
    auditId,
    url: 'https://aeropress.com/products/aeropress-clear',
    rank: 9,
    source: 'ai_cited',
    status: 'ok',
    title: 'AeroPress Clear Coffee Maker',
    price: 4999,
    currency: 'INR',
    rating: 4.9,
    reviewCount: 3400,
    trustSignals: ['Tritan Shatterproof', 'Over 1M Units Sold'],
  },
  {
    competitorId: 'comp_10',
    auditId,
    url: 'https://chemexcoffeemaker.com/six-cup-classic',
    rank: 10,
    source: 'organic',
    status: 'ok',
    title: 'Chemex Classic Series 6-Cup Glass Coffeemaker',
    price: 4600,
    currency: 'INR',
    rating: 4.8,
    reviewCount: 890,
    trustSignals: ['Non-Porous Borosilicate Glass', 'Timber Collar'],
  },
];

export const MOCK_FINDINGS: (auditId: string) => AuditFinding[] = (auditId) => [
  {
    findingId: 'find_1',
    auditId,
    category: 'conversion',
    tag: 'Conversion',
    severity: 'critical',
    title: 'Missing Above-the-Fold Cash on Delivery & UPI Trust Signals',
    description:
      '78% of Indian shoppers abandon carts if payment reassurance (COD/UPI badges) is not visible near the primary CTA.',
    penaltyPoints: 12,
    evidence: '8 of 10 competitors display COD & UPI badges directly under Add to Cart button.',
    createdAt: new Date().toISOString(),
  },
  {
    findingId: 'find_2',
    auditId,
    category: 'ranking',
    tag: 'Ranking',
    severity: 'critical',
    title: 'Product & Offer JSON-LD Structured Data Incomplete',
    description:
      'Page is missing AggregateRating, priceValidUntil, and availability schemas, preventing Google Rich Snippets in SERP.',
    penaltyPoints: 15,
    evidence: 'Competitor #1 and #2 maintain 100% valid Product and Offer schema with star ratings.',
    createdAt: new Date().toISOString(),
  },
  {
    findingId: 'find_3',
    auditId,
    category: 'conversion',
    tag: 'Conversion',
    severity: 'high',
    title: 'Primary CTA Button Low Contrast & Small Touch Target',
    description:
      'The Add to Cart button measures 38px in height, violating the 48px mobile touch target guideline, reducing tap precision.',
    penaltyPoints: 8,
    evidence: 'WCAG 2.1 touch target failure on mobile viewport (375px).',
    createdAt: new Date().toISOString(),
  },
  {
    findingId: 'find_4',
    auditId,
    category: 'ranking',
    tag: 'Ranking',
    severity: 'high',
    title: 'Missing Consensus Entities from Top 10 Competitors',
    description:
      'Critical coffee brewing entities (heat retention, flow rate, spiral ribs, cone angle) are absent from product copy.',
    penaltyPoints: 10,
    evidence: 'Present across 6+ top-ranking competitors in Google SERP.',
    createdAt: new Date().toISOString(),
  },
  {
    findingId: 'find_5',
    auditId,
    category: 'both',
    tag: 'Both',
    severity: 'medium',
    title: 'Unanswered High-Volume Purchase Queries in FAQ',
    description:
      'Users frequently search whether the dripper is dishwasher safe and what filter size to purchase, leading to bounce.',
    penaltyPoints: 6,
    evidence: 'High Google People Also Ask (PAA) search volume.',
    createdAt: new Date().toISOString(),
  },
  {
    findingId: 'find_6',
    auditId,
    category: 'ranking',
    tag: 'Ranking',
    severity: 'medium',
    title: 'Product Taxonomy Misclassified in Google Merchant Center',
    description:
      'Category is set to generic "Kitchen Supplies" rather than exact "Home & Garden > Kitchen > Coffee Makers & Espresso Machines".',
    penaltyPoints: 5,
    evidence: 'Google Product Taxonomy ID 4944 has 98% intent match.',
    createdAt: new Date().toISOString(),
  },
];

export const MOCK_QUERIES: (auditId: string) => AuditQuery[] = (auditId) => [
  {
    queryId: 'q_1',
    auditId,
    query: 'is this ceramic dripper dishwasher safe',
    step: 1,
    source: 'paa',
    answered: true,
    sectionTarget: 'faq',
  },
  {
    queryId: 'q_2',
    auditId,
    query: 'difference between v60 size 01 and 02',
    step: 2,
    source: 'paa',
    answered: true,
    sectionTarget: 'faq',
  },
  {
    queryId: 'q_3',
    auditId,
    query: 'does it come with paper filters included',
    step: 3,
    source: 'related',
    answered: true,
    sectionTarget: 'specifications',
  },
  {
    queryId: 'q_4',
    auditId,
    query: 'what is the best grind size for ceramic pour over',
    step: 4,
    source: 'grounding',
    answered: true,
    sectionTarget: 'brew_guide',
  },
];

export const MOCK_BLUEPRINT: (auditId: string) => AuditBlueprintSection[] = (auditId) => [
  {
    sectionId: 'sec_hero',
    auditId,
    order: 1,
    name: 'Hero Section & Buy Box',
    strategy: 'Elevate CTA, inject MRP discount badge, and ensure 52px touch target',
    action: 'rebuild',
    status: 'completed',
  },
  {
    sectionId: 'sec_trust',
    auditId,
    order: 2,
    name: 'India Trust & Payment Signals',
    strategy: 'Insert COD, UPI, 7-Day Easy Returns, and Express Delivery guarantees',
    action: 'insert',
    status: 'completed',
  },
  {
    sectionId: 'sec_specs',
    auditId,
    order: 3,
    name: 'Technical Specifications & Comparison Matrix',
    strategy: 'Integrate competitor consensus entities: flow ribs, ceramic glaze, heat retention',
    action: 'rebuild',
    status: 'completed',
  },
  {
    sectionId: 'sec_faq',
    auditId,
    order: 4,
    name: 'FAQ Accordion & FAQPage Schema',
    strategy: 'Answer high-volume PAA queries and inject structured schema',
    action: 'insert',
    status: 'completed',
  },
];

export const MOCK_PATCHES: (auditId: string) => AuditPatch[] = (auditId) => [
  {
    patchId: 'patch_1',
    auditId,
    sectionId: 'sec_trust',
    op: 'insertAfter',
    targetSelector: '.price-container, .product-price',
    htmlPayload: `
<div class="rf-trust-badges bg-slate-50 border border-slate-200 rounded-lg p-3 my-3">
  <div class="flex items-center gap-4 text-xs font-medium text-slate-700">
    <span class="flex items-center gap-1.5"><svg class="w-4 h-4 text-emerald-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg> Cash on Delivery Available</span>
    <span class="flex items-center gap-1.5"><svg class="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z"/><path fill-rule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clip-rule="evenodd"/></svg> UPI / Cards Accepted</span>
    <span class="flex items-center gap-1.5"><svg class="w-4 h-4 text-amber-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 14a6 6 0 110-12 6 6 0 010 12z" clip-rule="evenodd"/></svg> 7-Day Easy Returns</span>
  </div>
</div>`,
    tag: 'Conversion',
    reason: 'Adds missing above-the-fold India trust markers (COD, UPI, returns)',
    isSample: true,
    status: 'applied',
    createdAt: new Date().toISOString(),
  },
  {
    patchId: 'patch_2',
    auditId,
    sectionId: 'sec_schema',
    op: 'injectJsonLd',
    targetSelector: 'head',
    htmlPayload: JSON.stringify({
      '@context': 'https://schema.org/',
      '@type': 'Product',
      name: 'Ceramic Pour Over Dripper',
      image: ['https://example.com/dripper.jpg'],
      description: 'High-fire ceramic coffee dripper with spiral flow ribs for optimal extraction.',
      brand: { '@type': 'Brand', name: 'RankForge Home' },
      offers: {
        '@type': 'Offer',
        url: 'https://example.com/product/dripper',
        priceCurrency: 'INR',
        price: '1899',
        priceValidUntil: '2027-12-31',
        itemCondition: 'https://schema.org/NewCondition',
        availability: 'https://schema.org/InStock',
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '4.8',
        reviewCount: '142',
      },
    }),
    tag: 'Ranking',
    reason: 'Injects valid Product, Offer, and AggregateRating JSON-LD schema',
    isSample: false,
    status: 'applied',
    createdAt: new Date().toISOString(),
  },
  {
    patchId: 'patch_3',
    auditId,
    sectionId: 'sec_faq',
    op: 'insertBefore',
    targetSelector: 'footer',
    htmlPayload: `
<section class="rf-faq-section py-8 bg-slate-50 border-t border-slate-200">
  <div class="max-w-4xl mx-auto px-4">
    <h2 class="text-xl font-semibold text-slate-900 mb-4">Frequently Asked Questions</h2>
    <div class="space-y-3">
      <details class="bg-white p-4 rounded-lg border border-slate-200 cursor-pointer">
        <summary class="font-medium text-slate-800">Is this ceramic dripper dishwasher safe?</summary>
        <p class="mt-2 text-sm text-slate-600">Yes, the high-fired Japanese ceramic is 100% dishwasher safe and microwave safe.</p>
      </details>
      <details class="bg-white p-4 rounded-lg border border-slate-200 cursor-pointer">
        <summary class="font-medium text-slate-800">What filter size fits this dripper?</summary>
        <p class="mt-2 text-sm text-slate-600">Standard cone-shaped 02 size paper or cloth filters fit perfectly (1–4 cup brew capacity).</p>
      </details>
    </div>
  </div>
</section>`,
    tag: 'Both',
    reason: 'Answers top PAA queries with FAQ accordion and schema',
    isSample: false,
    status: 'applied',
    createdAt: new Date().toISOString(),
  },
];

/**
 * Endpoint: POST /internal/tasks/run
 * Walks through all 12 active lifecycle statuses in §6.1 with sleeps (default 2s, 0s in fastMode).
 * Keeps HTTP connection open per Cloud Run §8.6 rules.
 */
export interface TaskRunnerDeps {
  capture: typeof captureTarget;
  storage: () => ArtifactStorage;
}

export function createTasksRouter(deps: TaskRunnerDeps): ReturnType<typeof Router> {
const tasksRouter = Router();
tasksRouter.post('/internal/tasks/run', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const parseResult = RunAuditTaskInputSchema.safeParse(req.body);

  if (!parseResult.success) {
    const errorPayload = AuditErrorSchema.parse({
      code: 'UserInputError',
      message: 'Invalid run audit task payload',
      recoveryAction: 'Verify auditId and targetUrl format',
      details: { issues: parseResult.error.issues },
      timestamp: new Date().toISOString(),
    });
    return res.status(400).json({ success: false, error: errorPayload });
  }

  const { auditId, targetUrl, keyword, fastMode } = parseResult.data;

  // Defense-in-depth: SSRF re-check on targetUrl
  const ssrfCheck = await validateTargetUrl(targetUrl);
  if (!ssrfCheck.isValid) {
    const errorPayload = AuditErrorSchema.parse({
      code: 'UserInputError',
      message: `SSRF validation failed: ${ssrfCheck.error || 'Target URL is not permitted'}`,
      recoveryAction: 'Provide a valid public HTTP or HTTPS product URL',
      details: { targetUrl, error: ssrfCheck.error },
      timestamp: new Date().toISOString(),
    });
    return res.status(400).json({ success: false, error: errorPayload });
  }

  const store = getAuditStore();
  const stepDelayMs = fastMode || process.env.TEST_FAST_MODE === 'true' ? 10 : 2000;

  console.info(`[TaskRunner] Starting audit run for ${auditId} (url: ${targetUrl}, delay: ${stepDelayMs}ms)`);

  try {
    // Ensure audit record exists
    let existingAudit = await store.getAudit(auditId);
    if (!existingAudit) {
      existingAudit = {
        auditId,
        wsId: 'default',
        userId: 'anonymous',
        targetUrl,
        keyword,
        keywordCandidates: [],
        imageConsent: false,
        status: 'queued',
        stage: 'init',
        progressPercent: 5,
        platform: 'unknown',
        patchMode: 'static',
        stageTimings: { queued: new Date().toISOString() },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalCostInr: 0,
      };
      await store.createAudit(existingAudit);
    }

    // Sequence of 12 lifecycle steps per §6.1
    const stages: Array<{
      status: AuditStatus;
      stage: string;
      progress: number;
      action?: () => Promise<void>;
    }> = [
      {
        status: 'blueprinted',
        stage: 'cro_playbook',
        progress: 80,
        action: async () => {
          await store.saveBlueprint(auditId, MOCK_BLUEPRINT(auditId));
        },
      },
      {
        status: 'rebuilding',
        stage: 'generate_patches',
        progress: 90,
        action: async () => {
          await store.savePatches(auditId, MOCK_PATCHES(auditId));
        },
      },
      {
        status: 'verifying',
        stage: 'verify_dom_and_scores',
        progress: 95,
      },
      {
        status: 'complete',
        stage: 'finalize',
        progress: 100,
        action: async () => {
          await store.updateAudit(auditId, { completedAt: new Date().toISOString() });
        },
      },
    ];

    await store.updateAudit(auditId, {
      status: 'queued',
      stage: 'init',
      progressPercent: 5,
      stageTimings: { queued: new Date().toISOString() },
    });

    const current = (await store.getAudit(auditId)) ?? existingAudit;
    const outcome = await runCaptureStage(
      { store, storage: deps.storage(), capture: deps.capture, logger: log },
      current
    );
    if (outcome !== 'captured') {
      const failedAudit = await store.getAudit(auditId);
      return res.status(200).json({
        success: false,
        auditId,
        finalStatus: outcome,
        elapsedMs: Date.now() - startTime,
        error: failedAudit?.error,
      });
    }

    // Phases 2 and 3: competitors and analysis run for real; later stages below are still the Phase 0 stub.
    const storage = deps.storage();
    const extractionObject = await storage.get(artifactKeys.extraction(auditId));
    const target = ExtractionSchema.parse(JSON.parse(extractionObject?.body.toString('utf8') ?? '{}'));
    const spend = new SpendTracker(featureFlags.COST_CAP_INR);
    try {
      const afterCapture = (await store.getAudit(auditId)) ?? current;
      const competitorsResult = await runCompetitorsStage({ store, storage, spend, logger: log }, afterCapture, target);
      const withKeyword = (await store.getAudit(auditId)) ?? afterCapture;
      await runAnalysisStage({ store, storage, spend, logger: log }, withKeyword, target, {
        consensus: competitorsResult.consensus,
        keyword: competitorsResult.keyword,
        queries: await store.getQueries(auditId),
        competitorIds: competitorsResult.outcomes.filter((o) => o.status === 'ok').map((o) => o.candidate.competitorId),
      });
    } catch (stageErr) {
      const typed = toRankForgeError(stageErr);
      log('error', 'pipeline stage failed', { auditId, stage: 'competitors-analysis', code: typed.code, error: typed.message });
      await store.updateAudit(auditId, {
        status: 'failed',
        error: typed.toAuditError(),
        totalCostInr: spend.totalInr,
        stageTimings: { failed: new Date().toISOString() },
      });
      return res.status(200).json({ success: false, auditId, finalStatus: 'failed', elapsedMs: Date.now() - startTime, error: typed.toAuditError() });
    }

    // Walk through stages
    for (let i = 0; i < stages.length; i++) {
      const step = stages[i]!;
      const now = new Date().toISOString();

      console.info(
        `[TaskRunner] Audit ${auditId} -> status: ${step.status} (${step.progress}%) [stage: ${step.stage}]`
      );

      // Perform step action if any
      if (step.action) {
        await step.action();
      }

      // Update audit status and timing checkpoint
      await store.updateAudit(auditId, {
        status: step.status,
        stage: step.stage,
        progressPercent: step.progress,
        stageTimings: {
          [step.status]: now,
        },
      });

      // Sleep before advancing (except after the final step)
      if (i < stages.length - 1) {
        await sleep(stepDelayMs);
      }
    }

    const elapsedMs = Date.now() - startTime;
    console.info(`[TaskRunner] Audit ${auditId} completed successfully in ${elapsedMs}ms`);

    const finalAudit = await store.getAudit(auditId);
    return res.status(200).json({
      success: true,
      auditId,
      finalStatus: 'complete',
      elapsedMs,
      scores: finalAudit?.scores?.baseline
        ? {
            baseline: {
              visibility: finalAudit.scores.baseline.visibility.current,
              conversion: finalAudit.scores.baseline.conversion.current,
              ppi: finalAudit.scores.baseline.ppi.current,
            },
          }
        : undefined,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`[TaskRunner] Audit ${auditId} failed:`, error);

    try {
      await store.updateAudit(auditId, {
        status: 'failed',
        error: {
          code: 'InternalError',
          message: error.message || 'Worker execution failed',
          recoveryAction: 'Check worker logs and trigger audit re-run',
          timestamp: new Date().toISOString(),
        },
      });
    } catch {
      // Store update failed
    }

    return res.status(500).json({
      success: false,
      auditId,
      finalStatus: 'failed',
      error: error.message,
    });
  }
});
return tasksRouter;
}

export const tasksRouter = createTasksRouter({
  capture: captureTarget,
  storage: () => createStorageFromEnv(),
});
