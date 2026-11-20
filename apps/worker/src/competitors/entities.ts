import { z } from 'zod';
import type { Extraction } from '@rankforge/schema';
import { generateJson, type SpendTracker } from '../ai/gemini.js';
import type { Logger } from '../lib/log.js';

export const EntityListSchema = z.object({
  entities: z
    .array(z.string().min(2).max(60))
    .max(40)
    .describe('Product attributes, materials, features, specifications and use cases mentioned on the page'),
});

const SYSTEM =
  'You extract short, normalised product entities and attributes from an e-commerce product page. ' +
  'Return lowercase noun phrases such as "stainless steel", "350 ml capacity", "dishwasher safe". ' +
  'Only include things the page text actually states. Never invent specifications.';

/** competitor-extraction skill: entity and attribute list for one page (Gemini Flash, temperature 0.2). */
export async function extractEntities(
  extraction: Extraction,
  deps: { spend?: SpendTracker; logger?: Logger; auditId?: string }
): Promise<string[]> {
  const text = `${extraction.meta.title}\n${extraction.content.h1}\n${extraction.content.text}`.slice(0, 6000);
  const result = await generateJson({
    role: 'flash',
    schema: EntityListSchema,
    system: SYSTEM,
    prompt: `Page text:\n"""\n${text}\n"""\nList the entities and attributes.`,
    temperature: 0.2,
    spend: deps.spend,
    logger: deps.logger,
    auditId: deps.auditId,
    stage: 'entities',
  });
  return result.entities;
}

const BatchSchema = z.object({
  results: z.array(z.object({ id: z.string(), entities: z.array(z.string().min(2).max(60)).max(30) })),
});

/**
 * Batched entity extraction: several pages per request, because free-tier keys allow few requests per day.
 * Returns a map from id to entities; ids missing from the reply map to an empty list.
 */
export async function extractEntitiesBatch(
  items: { id: string; extraction: Extraction }[],
  deps: { spend?: SpendTracker; logger?: Logger; auditId?: string },
  chunkSize = 6
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const pages = chunk
      .map(
        ({ id, extraction }) =>
          `### PAGE ${id}\n${extraction.meta.title}\n${extraction.content.h1}\n${extraction.content.text.slice(0, 2200)}`
      )
      .join('\n\n');
    const result = await generateJson({
      role: 'flash',
      schema: BatchSchema,
      system: SYSTEM,
      prompt: `${pages}\n\nFor every PAGE id above, list its entities and attributes. Return one result per id.`,
      temperature: 0.2,
      spend: deps.spend,
      logger: deps.logger,
      auditId: deps.auditId,
      stage: 'entities',
    });
    for (const r of result.results) out.set(r.id, r.entities);
  }
  return out;
}
