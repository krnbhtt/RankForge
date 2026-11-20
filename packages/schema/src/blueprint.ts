import { z } from 'zod';

export const SectionTypeEnum = z.enum([
  'delivery_payment',
  'trust_row',
  'sample_reviews',
  'spec_table',
  'faq',
  'price_clarity',
  'sticky_cta',
  'description_depth',
  'comparison',
]);
export type SectionType = z.infer<typeof SectionTypeEnum>;

export const TagEnum = z.enum(['Ranking', 'Conversion', 'Both']);

/** Why a section exists. Every section must trace to at least one of these (spec 10, Phase 4 exit criterion). */
export const JustificationSchema = z.object({
  kind: z.enum(['finding', 'competitor_pattern', 'playbook_rule']),
  ref: z.string().min(1),
  note: z.string().min(1).max(300),
});
export type Justification = z.infer<typeof JustificationSchema>;

export const AnchorSchema = z.object({
  /** CSS selector of the element the section is placed relative to. */
  selector: z.string().min(1),
  position: z.enum(['insertBefore', 'insertAfter']),
  componentKind: z.string().optional(),
  /** Other places to try, in order, if the first one breaks the page (for example pushes the buy button down). */
  alternates: z.array(z.object({ selector: z.string().min(1), position: z.enum(['insertBefore', 'insertAfter']) })).max(4).optional(),
  /** The component anchor to fall back to when `selector` points at a section that was dropped. */
  fallbackSelector: z.string().optional(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

export const BlueprintSectionSpecSchema = z.object({
  sectionId: z.string().min(1),
  order: z.number().int().min(1),
  type: SectionTypeEnum,
  name: z.string().min(1).max(80),
  h2: z.string().min(1).max(100),
  h3s: z.array(z.string().max(100)).max(8),
  depth: z.enum(['short', 'medium', 'long']),
  contentType: z.enum(['table', 'list', 'accordion', 'cards', 'paragraphs', 'banner']),
  tag: TagEnum,
  /** True when the section shows invented illustrative content (for example reviews) and must carry a Sample label. */
  sample: z.boolean(),
  justifications: z.array(JustificationSchema).min(1),
  anchor: AnchorSchema,
});
export type BlueprintSectionSpec = z.infer<typeof BlueprintSectionSpecSchema>;

export const DecisionLogEntrySchema = z.object({
  decision: z.string().min(1),
  reason: z.string().min(1),
});

export const BlueprintSchema = z.object({
  auditId: z.string(),
  keyword: z.string(),
  sections: z.array(BlueprintSectionSpecSchema),
  decisionLog: z.array(DecisionLogEntrySchema),
  /** Deterministic head and markup fixes that need no writing (title, meta, alt text, structured data). */
  deterministicFixes: z.array(z.enum(['title', 'meta_description', 'image_alt', 'product_schema', 'breadcrumb_schema'])),
  generatedBy: z.enum(['model', 'fallback']),
});
export type Blueprint = z.infer<typeof BlueprintSchema>;
