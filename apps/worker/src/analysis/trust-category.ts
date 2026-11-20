import { z } from 'zod';
import type { Extraction } from '@rankforge/schema';
import { generateJson, type SpendTracker } from '../ai/gemini.js';
import type { Logger } from '../lib/log.js';
import { closestCategory, loadTaxonomy } from './taxonomy.js';

const OutputSchema = z.object({
  toneAndTrustScore: z.number().int().min(0).max(4).describe('0 = pushy or untrustworthy copy, 4 = clear, honest, reassuring copy'),
  toneNotes: z.string().max(300),
  currentCategory: z.string().max(200).describe('The category the page appears to use, from breadcrumbs or markup'),
  recommendedCategory: z
    .string()
    .max(200)
    .describe('The best Google Product Taxonomy path, for example "Home & Garden > Kitchen & Dining > Coffee & Tea"'),
  reason: z.string().max(300),
});

export interface TrustCategoryResult {
  toneAndTrustScore: number;
  toneNotes: string;
  currentCategory: string;
  recommendedCategory: string;
  recommendedValidated: boolean;
  reason: string;
}

/** trust-category skill (spec F4.7, F4.8): tone and trust of the copy plus a Google Product Taxonomy check. */
export async function analyseTrustAndCategory(
  extraction: Extraction,
  deps: { spend?: SpendTracker; logger?: Logger; auditId?: string }
): Promise<TrustCategoryResult> {
  const crumbs = extraction.jsonLd.find((n) => n['@type'] === 'BreadcrumbList')?.itemListElement;
  const product = extraction.jsonLd.find((n) => n['@type'] === 'Product');
  const out = await generateJson({
    role: 'flash',
    schema: OutputSchema,
    system:
      'You judge the tone and trustworthiness of e-commerce product copy and classify the product. ' +
      'Judge only the text given; do not invent facts.',
    prompt:
      `Title: ${extraction.meta.title}\nSchema category: ${String(product?.category ?? '')}\nBreadcrumb data: ${JSON.stringify(crumbs ?? []).slice(0, 400)}\n` +
      `Product type: ${extraction.platform.productData?.productType ?? ''}\nCOPY:\n"""\n${extraction.content.text.slice(0, 4500)}\n"""`,
    temperature: 0.2,
    spend: deps.spend,
    logger: deps.logger,
    auditId: deps.auditId,
    stage: 'analysis.trust',
  });

  const taxonomy = await loadTaxonomy();
  const match = closestCategory(out.recommendedCategory, taxonomy);
  return {
    toneAndTrustScore: out.toneAndTrustScore,
    toneNotes: out.toneNotes,
    currentCategory: out.currentCategory,
    recommendedCategory: match?.path ?? out.recommendedCategory,
    recommendedValidated: match?.exact ?? false,
    reason: out.reason,
  };
}
