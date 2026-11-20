import { z } from 'zod';
import { SectionTypeEnum, type ConsensusModel, type Extraction } from '@rankforge/schema';
import { generateJson, type SpendTracker } from '../ai/gemini.js';
import type { Logger } from '../lib/log.js';
import type { PlannedSection } from './playbook.js';

const AdviceSchema = z.object({
  sections: z
    .array(
      z.object({
        type: SectionTypeEnum,
        order: z.number().int().min(1).max(20).describe('1 = first section the shopper should meet'),
        h2: z.string().min(3).max(100),
        h3s: z.array(z.string().min(3).max(100)).max(8),
        depth: z.enum(['short', 'medium', 'long']),
      })
    )
    .max(12),
});
export type StructureAdvice = z.infer<typeof AdviceSchema>;

/**
 * structure-blueprint skill (spec F5.2): proposes the order, headings and depth of the planned sections using the
 * competitor consensus. It may not add or remove sections; the arbiter checks that.
 */
export async function adviseStructure(
  planned: PlannedSection[],
  consensus: ConsensusModel,
  extraction: Extraction,
  deps: { keyword: string; spend?: SpendTracker; logger?: Logger; auditId?: string }
): Promise<StructureAdvice | null> {
  if (planned.length === 0) return null;
  try {
    const out = await generateJson({
      role: 'pro',
      schema: AdviceSchema,
      system:
        'You design the structure of an e-commerce product page section by section. You only order, title and size the sections you are given. ' +
        'Headings must be plain English and mention the product keyword naturally. Do not invent product facts.',
      prompt:
        `Keyword: ${deps.keyword}\nProduct: ${extraction.meta.title}\n\n` +
        `SECTIONS TO PLACE:\n${planned.map((p) => `- type=${p.type}; purpose=${p.name}; suggested heading="${p.defaultH2}"; questions=${p.defaultH3s.join(' | ')}`).join('\n')}\n\n` +
        `WHAT COMPETITORS USE (headings, most common first): ${consensus.sectionSequence.slice(0, 12).map((s) => s.heading).join(' | ') || 'n/a'}\n` +
        `Existing headings on the page: ${extraction.headingTree.flatMap((h) => h.children.map((c) => c.text)).slice(0, 10).join(' | ')}\n\n` +
        'Return one entry per section type above, ordered by where it helps the shopper most.',
      temperature: 0.2,
      spend: deps.spend,
      logger: deps.logger,
      auditId: deps.auditId,
      stage: 'blueprint.structure',
    });
    const allowed = new Set(planned.map((p) => p.type));
    return { sections: out.sections.filter((s) => allowed.has(s.type)) };
  } catch (err) {
    deps.logger?.('warn', 'structure advice unavailable; using playbook defaults', {
      auditId: deps.auditId,
      stage: 'blueprint',
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
