import { z } from 'zod';

export const PatchOpNameEnum = z.enum([
  'setText',
  'setAttr',
  'insertBefore',
  'insertAfter',
  'move',
  'remove',
  'setHeadMeta',
  'injectJsonLd',
]);
export type PatchOpName = z.infer<typeof PatchOpNameEnum>;

/** One DOM operation (spec 6.4). Applied by code only; the model never applies patches. */
export const PatchOpSchema = z.object({
  op: PatchOpNameEnum,
  /** CSS selector. For setHeadMeta: `title` or `meta[name="description"]`. For injectJsonLd: `head`. */
  target: z.string().min(1),
  /** insertBefore/insertAfter: HTML. setText: text. setHeadMeta: content. injectJsonLd: JSON string. */
  html: z.string().optional(),
  attr: z.object({ name: z.string().min(1), value: z.string() }).optional(),
  /** move: selector to move the target after. */
  to: z.string().optional(),
  /** Apply to every match (setAttr on images). Placeholders `{n}` in attr.value become the 1-based index. */
  all: z.boolean().optional(),
  /** injectJsonLd: remove existing JSON-LD blocks of this @type first. */
  replaceType: z.string().optional(),
  /** Used when `target` matches nothing, for example because the section it was chained to was dropped. */
  fallbackTarget: z.string().optional(),
  /** Other insertion points to try, in order, if this one breaks the page. */
  alternates: z.array(z.object({ op: z.enum(['insertBefore', 'insertAfter']), target: z.string().min(1) })).optional(),
  tag: z.enum(['Ranking', 'Conversion', 'Both']),
  reason: z.string().min(1).max(400),
  sample: z.boolean(),
  sectionId: z.string().min(1),
});
export type PatchOp = z.infer<typeof PatchOpSchema>;

export const PatchSetSchema = z.object({
  sectionId: z.string().min(1),
  ops: z.array(PatchOpSchema).min(1),
});
export type PatchSet = z.infer<typeof PatchSetSchema>;
