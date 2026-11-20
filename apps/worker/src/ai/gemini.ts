import { z, type ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { QuotaError, UpstreamModelError } from '@rankforge/schema';
import { withRetry } from '../lib/retry.js';
import { log, type Logger } from '../lib/log.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Model roles from specification 3.2, resolved to the ids this API key can call. */
export const MODELS = {
  flash: process.env.GEMINI_MODEL_FLASH ?? 'gemini-3.5-flash',
  pro: process.env.GEMINI_MODEL_PRO ?? 'gemini-3.1-pro-preview',
} as const;
export type ModelRole = keyof typeof MODELS;

/**
 * Fallback order per role. Free-tier keys have a small daily request quota per model, so when one model is out of
 * quota (or overloaded) the next one in the chain is tried. Order is quality first.
 */
export const MODEL_CHAINS: Record<ModelRole, string[]> = {
  flash: [MODELS.flash, 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'],
  pro: [MODELS.pro, MODELS.flash, 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'],
};

/** Estimated INR per million tokens. Approximate; verify against Google's pricing page. */
const RATES_INR_PER_M: Record<ModelRole, { input: number; output: number }> = {
  flash: { input: 25, output: 200 },
  pro: { input: 170, output: 1000 },
};

/** Per-audit spend tracker; throws QuotaError once the cap is reached (feature flag COST_CAP_INR). */
export class SpendTracker {
  private spent = 0;
  constructor(private readonly capInr: number) {}

  add(role: ModelRole, inputTokens: number, outputTokens: number): void {
    const rate = RATES_INR_PER_M[role];
    this.spent += (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
  }

  get totalInr(): number {
    return Math.round(this.spent * 100) / 100;
  }

  assertWithinCap(): void {
    if (this.spent >= this.capInr) {
      throw new QuotaError(`This audit reached its spending limit of ₹${this.capInr}.`, {
        spentInr: this.totalInr,
        capInr: this.capInr,
      });
    }
  }
}

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface GenerateJsonOptions<T> {
  role: ModelRole;
  schema: ZodType<T>;
  system?: string;
  prompt: string;
  /** Extra parts such as screenshots. */
  parts?: GeminiPart[];
  temperature?: number;
  tools?: unknown[];
  spend?: SpendTracker;
  logger?: Logger;
  auditId?: string;
  stage?: string;
  fetchImpl?: typeof fetch;
  apiKey?: string;
  timeoutMs?: number;
}

export interface GeminiRaw {
  text: string;
  groundingMetadata?: {
    groundingChunks?: { web?: { uri?: string; title?: string } }[];
    searchEntryPoint?: { renderedContent?: string };
    webSearchQueries?: string[];
  };
  usage: { input: number; output: number };
}

class RetriableHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function callGemini(
  options: Pick<GenerateJsonOptions<unknown>, 'system' | 'temperature' | 'tools' | 'apiKey' | 'fetchImpl' | 'timeoutMs'> & {
    model: string;
    contents: unknown;
    jsonSchema?: unknown;
  }
): Promise<GeminiRaw> {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new UpstreamModelError('The AI service is not configured.', { reason: 'missing GEMINI_API_KEY' });
  const doFetch = options.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    contents: options.contents,
    generationConfig: {
      temperature: options.temperature ?? 0.2,
      ...(options.jsonSchema
        ? { responseMimeType: 'application/json', responseJsonSchema: options.jsonSchema }
        : {}),
    },
  };
  if (options.system) body.systemInstruction = { parts: [{ text: options.system }] };
  if (options.tools) body.tools = options.tools;

  const res = await doFetch(`${ENDPOINT}/${options.model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
  });
  if (res.status === 429 || res.status >= 500) {
    throw new RetriableHttpError(res.status, `Gemini returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: GeminiRaw['groundingMetadata'] }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new UpstreamModelError(`The AI service rejected the request (HTTP ${res.status}).`, {
      detail: json.error?.message?.slice(0, 300),
    });
  }
  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  return {
    text,
    groundingMetadata: candidate?.groundingMetadata,
    usage: {
      input: json.usageMetadata?.promptTokenCount ?? 0,
      output: (json.usageMetadata?.candidatesTokenCount ?? 0) + (json.usageMetadata?.thoughtsTokenCount ?? 0),
    },
  };
}

async function callWithBackoff(
  logger: Logger,
  ctx: { auditId?: string; stage?: string },
  fn: () => Promise<GeminiRaw>,
  retries = 3
): Promise<GeminiRaw> {
  try {
    return await withRetry(fn, {
      retries,
      baseDelayMs: 800,
      maxDelayMs: 8000,
      shouldRetry: (err) =>
        err instanceof RetriableHttpError || (err instanceof Error && /timeout|aborted|fetch failed/i.test(err.message)),
    });
  } catch (err) {
    if (err instanceof RetriableHttpError) {
      if (err.status === 429) throw new QuotaError('The AI service is busy right now.', { status: 429 });
      throw new UpstreamModelError('The AI service is temporarily unavailable.', { status: err.status });
    }
    if (err instanceof Error && /timeout|aborted|fetch failed/i.test(err.message)) {
      logger('warn', 'gemini call failed after retries', { ...ctx, error: err.message, cause: String((err as { cause?: unknown }).cause ?? '') });
      throw new UpstreamModelError('The AI service did not answer in time.', { reason: err.message });
    }
    throw err;
  }
}

/**
 * Calls Gemini with a JSON schema, validates the answer with Zod, retries once with the validation error,
 * then fails the stage with UpstreamModelError (standing rule). Network errors back off with jitter.
 */
export async function generateJson<T>(options: GenerateJsonOptions<T>): Promise<T> {
  const logger = options.logger ?? log;
  const ctx = { auditId: options.auditId, stage: options.stage };
  const jsonSchema = zodToJsonSchema(options.schema, { $refStrategy: 'none', target: 'jsonSchema7' });
  delete (jsonSchema as Record<string, unknown>).$schema;

  const chain = MODEL_CHAINS[options.role];
  let modelIndex = 0;
  const userParts: GeminiPart[] = [{ text: options.prompt }, ...(options.parts ?? [])];
  let contents: { role: string; parts: GeminiPart[] }[] = [{ role: 'user', parts: userParts }];
  let lastProblem = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    options.spend?.assertWithinCap();
    const started = Date.now();
    let raw: GeminiRaw | undefined;
    for (; modelIndex < chain.length; modelIndex++) {
      const model = chain[modelIndex] as string;
      try {
        raw = await callWithBackoff(logger, ctx, () => callGemini({ ...options, model, contents, jsonSchema }), modelIndex === chain.length - 1 ? 3 : 0);
        break;
      } catch (err) {
        const nextModel = chain[modelIndex + 1];
        const unavailable = err instanceof QuotaError || (err instanceof UpstreamModelError && [500, 502, 503, 504].includes(Number(err.details?.status)));
        if (!unavailable || !nextModel) throw err;
        logger('warn', 'model unavailable; trying the next one', { ...ctx, model, next: nextModel, code: err.code });
      }
    }
    if (!raw) throw new UpstreamModelError('No AI model is available right now.');
    const usedRole: ModelRole = modelIndex === 0 && options.role === 'pro' ? 'pro' : 'flash';
    options.spend?.add(usedRole, raw.usage.input, raw.usage.output);
    logger('info', 'gemini call', {
      ...ctx,
      model: chain[modelIndex],
      durationMs: Date.now() - started,
      tokensIn: raw.usage.input,
      tokensOut: raw.usage.output,
      attempt,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.text);
    } catch (err) {
      lastProblem = `The reply was not valid JSON: ${(err as Error).message}`;
    }
    if (parsed !== undefined) {
      const result = options.schema.safeParse(parsed);
      if (result.success) return result.data;
      lastProblem = result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
    }
    contents = [
      ...contents,
      { role: 'model', parts: [{ text: raw.text.slice(0, 4000) }] },
      { role: 'user', parts: [{ text: `Your reply failed validation: ${lastProblem}. Reply again with JSON that matches the schema exactly.` }] },
    ];
  }
  throw new UpstreamModelError('The AI service returned an answer we could not use.', { validation: lastProblem });
}

/** Free-form grounded call (Search Grounding cannot be combined with a JSON schema). */
export async function generateGrounded(options: {
  role: ModelRole;
  prompt: string;
  spend?: SpendTracker;
  logger?: Logger;
  auditId?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<GeminiRaw> {
  const logger = options.logger ?? log;
  options.spend?.assertWithinCap();
  const raw = await callWithBackoff(logger, { auditId: options.auditId, stage: 'grounding' }, () =>
    callGemini({
      model: MODEL_CHAINS[options.role][0] as string,
      apiKey: options.apiKey,
      fetchImpl: options.fetchImpl,
      temperature: 0.2,
      tools: [{ google_search: {} }],
      contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
    }),
    // A grounding quota error will not clear within a live run, so fail fast and let the caller degrade.
    1
  );
  options.spend?.add(options.role, raw.usage.input, raw.usage.output);
  return raw;
}

export { z };
