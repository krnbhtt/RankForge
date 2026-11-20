import { z } from 'zod';
import { PNG } from 'pngjs';
import { generateJson, type GeminiPart, type SpendTracker } from '../ai/gemini.js';
import type { Logger } from '../lib/log.js';

export const VisualRubricSchema = z.object({
  ctaProminent: z.boolean().describe('The add-to-cart button stands out and is easy to find'),
  variantSelectorClear: z.boolean().describe('Size, colour or option choices are obvious and easy to use'),
  trustBadgesVisible: z.boolean().describe('Trust badges, certifications or secure-payment marks are visible'),
  reassuranceNearCta: z.boolean().describe('Delivery, returns or payment reassurance appears close to the button'),
  reviewsNearTitle: z.boolean().describe('Star rating or review count appears close to the product title'),
  priceClear: z.boolean().describe('Price, any original price and discount are easy to read'),
});
export type VisualRubric = z.infer<typeof VisualRubricSchema>;

export const VisualFindingSchema = z.object({
  title: z.string().max(120),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  evidence: z.string().min(8).max(300).describe('What is visible in the screenshot that supports this finding'),
  viewport: z.enum(['mobile', 'desktop']),
  region: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  }),
});
export type VisualFinding = z.infer<typeof VisualFindingSchema>;

const OutputSchema = z.object({
  rubric: VisualRubricSchema,
  findings: z.array(VisualFindingSchema).max(6),
});
export type VisualCroResult = z.infer<typeof OutputSchema>;

/** Crops to the top `maxHeight` pixels and shrinks so the image is cheap to send to the model. */
export function prepareScreenshot(png: Buffer, maxWidth: number, maxHeight: number): Buffer {
  const src = PNG.sync.read(png);
  const cropHeight = Math.min(src.height, maxHeight);
  const scale = Math.min(1, maxWidth / src.width);
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(cropHeight * scale));
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const si = (sy * src.width + sx) * 4;
      const di = (y * width + x) * 4;
      out.data[di] = src.data[si] as number;
      out.data[di + 1] = src.data[si + 1] as number;
      out.data[di + 2] = src.data[si + 2] as number;
      out.data[di + 3] = 255;
    }
  }
  return PNG.sync.write(out, { colorType: 2 });
}

export interface VisualCroInput {
  targetMobile?: Buffer;
  targetDesktop?: Buffer;
  competitorDesktops: Buffer[];
}

const inline = (png: Buffer): GeminiPart => ({ inlineData: { mimeType: 'image/png', data: png.toString('base64') } });

/**
 * visual-cro-audit skill (spec F4.6): one vision pass over the target's mobile and desktop screenshots and up to two
 * competitor screenshots. The model answers a fixed rubric of yes/no questions; code converts it to points.
 */
export async function runVisualCro(
  input: VisualCroInput,
  deps: { spend?: SpendTracker; logger?: Logger; auditId?: string }
): Promise<VisualCroResult> {
  const parts: GeminiPart[] = [];
  const labels: string[] = [];
  if (input.targetMobile) {
    parts.push(inline(prepareScreenshot(input.targetMobile, 390, 1700)));
    labels.push('Image 1: the audited page on mobile (top of page).');
  }
  if (input.targetDesktop) {
    parts.push(inline(prepareScreenshot(input.targetDesktop, 900, 1100)));
    labels.push(`Image ${parts.length}: the audited page on desktop (top of page).`);
  }
  for (const [i, png] of input.competitorDesktops.slice(0, 2).entries()) {
    parts.push(inline(prepareScreenshot(png, 700, 900)));
    labels.push(`Image ${parts.length}: competitor ${i + 1} on desktop, for comparison only.`);
  }
  return generateJson({
    role: 'pro',
    schema: OutputSchema,
    system:
      'You are a conversion-rate expert reviewing e-commerce product pages from screenshots. ' +
      'Judge only what you can see. Region coordinates are fractions (0 to 1) of the image width and height. ' +
      'Findings must be about the audited page, not the competitors.',
    prompt: `${labels.join('\n')}\n\nAnswer the rubric for the audited page and list up to six concrete findings that hurt conversion, each with the region of the screenshot it refers to.`,
    parts,
    temperature: 0.2,
    spend: deps.spend,
    logger: deps.logger,
    auditId: deps.auditId,
    stage: 'analysis.visual',
  });
}
