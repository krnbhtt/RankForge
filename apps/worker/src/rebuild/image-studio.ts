import type { IAuditStore } from '@rankforge/audit-store';
import { featureFlags } from '@rankforge/config';
import {
  QuotaError,
  UpstreamModelError,
  type AuditImage,
  type AuditRecord,
  type ConsensusModel,
  type Extraction,
  type PatchOp,
} from '@rankforge/schema';
import { safeFetch } from '@rankforge/ssrf';
import type { ArtifactStorage } from '@rankforge/storage';
import { SpendTracker } from '../ai/gemini.js';
import { log as defaultLog, type Logger } from '../lib/log.js';
import { withRetry } from '../lib/retry.js';
import { escapeForHtml } from './applier.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Nano Banana 2 for ordinary images, Nano Banana Pro for the hero (specification 3.2). Overridable per environment. */
export const IMAGE_MODELS = {
  standard: process.env.GEMINI_MODEL_IMAGE ?? 'gemini-3.1-flash-image-preview',
  hero: process.env.GEMINI_MODEL_IMAGE_PRO ?? 'nano-banana-pro-preview',
} as const;

/** Estimated INR per generated image; counted against the per-audit cap. */
const IMAGE_COST_INR = { standard: 3, hero: 8 } as const;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

export interface ImagePlanItem {
  imageId: string;
  kind: 'hero' | 'lifestyle';
  model: string;
  prompt: string;
  /** Whether the source product photo is sent along with the prompt. */
  usesSource: boolean;
  costInr: number;
}

export interface ImageStudioDeps {
  store: IAuditStore;
  storage: ArtifactStorage;
  spend: SpendTracker;
  logger?: Logger;
  fetchImpl?: typeof fetch;
  apiKey?: string;
  /** Overridable for tests; defaults to the redirect-safe fetch. */
  downloadImage?: (url: string) => Promise<{ data: Buffer; mimeType: string } | null>;
  /** Overridable for tests; defaults to the IMAGE_GENERATION feature flag. */
  enabled?: boolean;
}

export interface ImageStudioResult {
  status: 'skipped' | 'done';
  skippedBecause?: string;
  images: AuditImage[];
  ops: PatchOp[];
}

/** What to generate: an improved hero, and a lifestyle image when competitors use lifestyle images and the page has none. */
export function planImages(extraction: Extraction, consensus: ConsensusModel): ImagePlanItem[] {
  const title = extraction.platform.productData?.title ?? extraction.content.h1 ?? extraction.meta.title;
  const plan: ImagePlanItem[] = [];
  if (extraction.images.some((i) => i.role === 'hero')) {
    plan.push({
      imageId: 'img_01_hero',
      kind: 'hero',
      model: IMAGE_MODELS.hero,
      usesSource: true,
      costInr: IMAGE_COST_INR.hero,
      prompt:
        `Improve this product photo of "${title}" for an online store: clean neutral background, even soft lighting, sharp focus. ` +
        'Keep the product exactly as it is: same shape, colour, logo and proportions. Do not add text, badges or extra objects.',
    });
  }
  const lifestyleShare = (consensus.imageTypes.find((t) => t.type === 'lifestyle')?.frequency ?? 0) / Math.max(1, consensus.competitorCount);
  const ownLifestyle = extraction.images.some((i) => /lifestyle|in use|model|kitchen|home|outdoor|wearing/i.test(`${i.alt} ${i.src}`));
  if (lifestyleShare >= 0.3 && !ownLifestyle) {
    plan.push({
      imageId: 'img_02_lifestyle',
      kind: 'lifestyle',
      model: IMAGE_MODELS.standard,
      usesSource: true,
      costInr: IMAGE_COST_INR.standard,
      prompt:
        `Create a realistic lifestyle photo showing "${title}" in everyday use, using the product from the reference photo exactly as it appears. ` +
        'Natural light, no text, no logos other than those already on the product.',
    });
  }
  return plan;
}

async function defaultDownload(url: string): Promise<{ data: Buffer; mimeType: string } | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: 10_000, headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const type = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!/^image\/(png|jpeg|webp)$/.test(type)) return null;
    const data = Buffer.from(await res.arrayBuffer());
    return data.length > 0 && data.length <= MAX_SOURCE_BYTES ? { data, mimeType: type } : null;
  } catch {
    return null;
  }
}

async function generateImage(
  item: ImagePlanItem,
  source: { data: Buffer; mimeType: string } | null,
  deps: Pick<ImageStudioDeps, 'fetchImpl' | 'apiKey'>
): Promise<{ data: Buffer; mimeType: string }> {
  const apiKey = deps.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new UpstreamModelError('The AI service is not configured.', { reason: 'missing GEMINI_API_KEY' });
  const parts: unknown[] = [{ text: item.prompt }];
  if (source && item.usesSource) parts.push({ inlineData: { mimeType: source.mimeType, data: source.data.toString('base64') } });
  const doFetch = deps.fetchImpl ?? fetch;
  const json = await withRetry(
    async () => {
      const res = await doFetch(`${ENDPOINT}/${item.model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status === 429) throw new QuotaError('The image model quota is used up.', { status: 429, service: 'gemini' });
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
        error?: { message?: string };
      };
      if (!res.ok) throw new UpstreamModelError(`The image model rejected the request (HTTP ${res.status}).`, { detail: body.error?.message?.slice(0, 200) });
      return body;
    },
    { retries: 2, baseDelayMs: 800, shouldRetry: (e) => e instanceof Error && /^HTTP 5|timeout|aborted|fetch failed/i.test(e.message) }
  );
  const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new UpstreamModelError('The image model returned no image.');
  return { data: Buffer.from(inline.data, 'base64'), mimeType: inline.mimeType ?? 'image/png' };
}

function figureHtml(item: ImagePlanItem, fileName: string, title: string): string {
  const caption = item.kind === 'hero' ? 'Improved product photo' : 'Lifestyle image';
  return (
    `<figure class="rf-section"><img src="images/${fileName}" alt="${escapeForHtml(title)} - ${caption.toLowerCase()}">` +
    `<figcaption>${caption}, AI-generated <span class="rf-sample-chip">Sample</span></figcaption></figure>`
  );
}

/**
 * image-studio skill (spec F6.5): improves the hero image and adds a missing lifestyle image, only when the user agreed
 * and the feature flag allows it. A model failure (including no quota) is recorded and never stops the audit.
 */
export async function runImageStudio(
  deps: ImageStudioDeps,
  audit: AuditRecord,
  target: Extraction,
  consensus: ConsensusModel,
  anchorSelector: string | undefined
): Promise<ImageStudioResult> {
  const logger = deps.logger ?? defaultLog;
  const auditId = audit.auditId;
  const skip = (why: string): ImageStudioResult => {
    logger('info', 'image studio skipped', { auditId, stage: 'images', reason: why });
    return { status: 'skipped', skippedBecause: why, images: [], ops: [] };
  };
  if (!audit.imageConsent) return skip('The user did not ask for image generation.');
  if (!(deps.enabled ?? featureFlags.IMAGE_GENERATION)) return skip('Image generation is switched off on this server.');
  if (!anchorSelector) return skip('There is no place on the page to put an image.');

  const plan = planImages(target, consensus);
  if (plan.length === 0) return skip('The page already has the image types competitors use.');

  const heroUrl = target.images.find((i) => i.role === 'hero')?.src;
  const source = heroUrl ? await (deps.downloadImage ?? defaultDownload)(heroUrl) : null;
  const title = target.platform.productData?.title ?? target.content.h1 ?? target.meta.title;
  const images: AuditImage[] = [];
  const ops: PatchOp[] = [];

  for (const item of plan) {
    const base: AuditImage = {
      imageId: item.imageId,
      auditId,
      originalUrl: heroUrl && /^https?:/.test(heroUrl) ? heroUrl : undefined,
      prompt: item.prompt,
      status: 'pending',
      consentGiven: true,
      createdAt: new Date().toISOString(),
    };
    try {
      deps.spend.assertWithinCap();
      const out = await generateImage(item, source, deps);
      const ext = out.mimeType.includes('jpeg') ? 'jpg' : out.mimeType.includes('webp') ? 'webp' : 'png';
      const fileName = `${item.imageId}.${ext}`;
      await deps.storage.put(`${auditId}/images/${fileName}`, out.data, out.mimeType);
      deps.spend.addFlat(item.costInr);
      images.push({ ...base, status: 'ready', gcsPath: `${auditId}/images/${fileName}` });
      ops.push({
        op: 'insertAfter',
        target: anchorSelector,
        html: figureHtml(item, fileName, title),
        tag: 'Conversion',
        reason: item.kind === 'hero' ? 'An improved version of the product photo: cleaner background and lighting.' : `${Math.round((consensus.imageTypes.find((t) => t.type === 'lifestyle')?.frequency ?? 0))} of ${consensus.competitorCount} competitors show lifestyle images; this page has none.`,
        sample: true,
        sectionId: item.imageId,
      });
    } catch (err) {
      logger('warn', 'image generation failed; continuing without it', { auditId, stage: 'images', imageId: item.imageId, error: err instanceof Error ? err.message : String(err) });
      images.push({ ...base, status: 'failed' });
      if (err instanceof QuotaError) break;
    }
  }
  await deps.store.saveImages(auditId, images);
  return { status: 'done', images, ops };
}
