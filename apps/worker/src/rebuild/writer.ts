import { z } from 'zod';
import type { BlueprintSectionSpec, Extraction } from '@rankforge/schema';
import { generateJson, type SpendTracker } from '../ai/gemini.js';
import type { Logger } from '../lib/log.js';
import { priceNoteHtml, stickyCtaHtml } from './deterministic.js';

const WriterOutputSchema = z.object({
  html: z.string().min(20).max(9000).describe('One HTML fragment: a single root element for the whole section'),
});

const TYPE_RULES: Record<string, string> = {
  delivery_payment:
    'A short list (class rf-list) covering delivery estimate or pincode check, cash on delivery, UPI and cards, and returns. Use hedged wording that a merchant must confirm.',
  trust_row:
    'A row of 3 to 4 cards (class rf-cards, each rf-card) for trust marks such as secure payment, returns promise, quality checked and support. No fake certification numbers.',
  sample_reviews:
    'Exactly 5 customer reviews as rf-card items: mixed 4 and 5 stars (use a span with class rf-stars and the star characters), varied length, one with a minor criticism, each mentioning a product-specific detail that appears in the facts. Each review element must carry data-sample="true". Use first names only.',
  spec_table:
    'A table (class rf-table) of specifications. Only list values that appear in the facts. For attributes competitors list but the facts do not state, add a row whose value is "To be confirmed by the seller" and mark that row with data-sample="true".',
  faq:
    'An FAQ (container class rf-faq) with one details/summary pair per question given. Answer using only the facts; where the facts do not answer, say the seller will confirm. Mark each details element data-sample="true".',
  comparison: 'A compact comparison table (class rf-table) using only the facts.',
  description_depth: 'Two short paragraphs expanding the description using only the facts.',
};

export interface WriterDeps {
  spend?: SpendTracker;
  logger?: Logger;
  auditId?: string;
}

function facts(extraction: Extraction): string {
  const data = extraction.platform.productData;
  return JSON.stringify(
    {
      title: data?.title ?? extraction.meta.title,
      brand: data?.vendor,
      type: data?.productType,
      price: extraction.price ? { selling: extraction.price.selling, mrp: extraction.price.mrp, currency: extraction.price.currency } : undefined,
      options: data?.options ?? extraction.variants.map((v) => ({ name: v.name, values: v.values })),
      description: (data?.descriptionHtml ? data.descriptionHtml.replace(/<[^>]+>/g, ' ') : extraction.content.text).replace(/\s+/g, ' ').slice(0, 1500),
      headings: extraction.headingTree.flatMap((h) => h.children.map((c) => c.text)).slice(0, 8),
    },
    null,
    1
  );
}

/**
 * section-writer skill (spec F6.1): writes one section as an HTML fragment. Sticky bar and price note are
 * deterministic templates. Output is untrusted and is sanitised and class-checked by the caller.
 */
export async function writeSection(
  spec: BlueprintSectionSpec,
  extraction: Extraction,
  whitelist: string[],
  deps: WriterDeps
): Promise<string> {
  if (spec.type === 'sticky_cta') return stickyCtaHtml(extraction);
  if (spec.type === 'price_clarity') return priceNoteHtml();

  const classHints = whitelist.slice(0, 60).join(', ');
  const out = await generateJson({
    role: 'pro',
    schema: WriterOutputSchema,
    system:
      'You write one section of an e-commerce product page as clean HTML. Rules: ' +
      '1) Product facts (price, specifications, materials) may come ONLY from the FACTS given; never invent them. ' +
      '2) Return one root element: <section class="rf-section">. Put the heading as <h2>. ' +
      '3) Use classes that start with "rf-" or are in the allowed class list; no other classes, no inline styles, no scripts. ' +
      '4) Everything illustrative must show <span class="rf-sample-chip">Sample</span> next to its heading. ' +
      '5) Plain English, no hype.',
    prompt:
      `SECTION: ${spec.name} (type ${spec.type}, depth ${spec.depth}, format ${spec.contentType})\n` +
      `H2: ${spec.h2}\n${spec.h3s.length ? `QUESTIONS / SUB-HEADINGS: ${spec.h3s.join(' | ')}\n` : ''}` +
      `INSTRUCTIONS: ${TYPE_RULES[spec.type] ?? 'Write the section.'}\n` +
      `WHY IT IS ADDED: ${spec.justifications.map((j) => j.note).join(' ')}\n\nFACTS:\n${facts(extraction)}\n\n` +
      `ALLOWED STORE CLASSES (optional): ${classHints || 'none'}`,
    temperature: 0.7,
    spend: deps.spend,
    logger: deps.logger,
    auditId: deps.auditId,
    stage: `rebuild.${spec.type}`,
  });
  return out.html;
}
