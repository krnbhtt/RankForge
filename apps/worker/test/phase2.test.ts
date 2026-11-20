import { describe, expect, it, vi } from 'vitest';
import { BlockedSiteError, type Extraction, type GroundingResult, type SerpResult } from '@rankforge/schema';
import { MODELS, SpendTracker, generateJson, z } from '../src/ai/gemini.js';
import { captureCompetitors, type CompetitorCandidate } from '../src/competitors/capture.js';
import { buildConsensus } from '../src/competitors/consensus.js';
import { discoverAiCitedSources } from '../src/competitors/grounding.js';
import { buildProfile, classifyImages, detectTrustElements } from '../src/competitors/profile.js';
import { fetchSerp } from '../src/competitors/serp.js';
import { buildCandidates } from '../src/stages/competitors-stage.js';
import { silentLog } from '../src/lib/log.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const geminiReply = (text: string, input = 100, output = 50) =>
  json({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: input, candidatesTokenCount: output } });

describe('generateJson', () => {
  const schema = z.object({ colours: z.array(z.string()).min(1) });

  it('returns validated JSON and tracks spend', async () => {
    const spend = new SpendTracker(25);
    const fetchImpl = vi.fn(async () => geminiReply('{"colours":["red"]}', 1000, 500));
    const out = await generateJson({ role: 'flash', schema, prompt: 'x', fetchImpl: fetchImpl as never, apiKey: 'k', spend, logger: silentLog });
    expect(out.colours).toEqual(['red']);
    expect(spend.totalInr).toBeGreaterThan(0);
    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toContain(MODELS.flash);
  });

  it('retries once with the validation error, then succeeds', async () => {
    const replies = ['{"colours":[]}', '{"colours":["blue"]}'];
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_u: unknown, init?: { body?: string }) => {
      bodies.push(String(init?.body));
      return geminiReply(replies.shift() as string);
    });
    const out = await generateJson({ role: 'flash', schema, prompt: 'x', fetchImpl: fetchImpl as never, apiKey: 'k', logger: silentLog });
    expect(out.colours).toEqual(['blue']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(bodies[1]).toContain('failed validation');
  });

  it('fails the stage with UpstreamModelError after the second invalid answer', async () => {
    const fetchImpl = vi.fn(async () => geminiReply('not json'));
    await expect(
      generateJson({ role: 'flash', schema, prompt: 'x', fetchImpl: fetchImpl as never, apiKey: 'k', logger: silentLog })
    ).rejects.toMatchObject({ code: 'UpstreamModelError' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('falls back from the pro model to flash when pro has no quota', async () => {
    const fetchImpl = vi.fn(async (u: unknown) =>
      String(u).includes(MODELS.pro) ? json({ error: { message: 'quota' } }, 429) : geminiReply('{"colours":["green"]}')
    );
    const out = await generateJson({ role: 'pro', schema, prompt: 'x', fetchImpl: fetchImpl as never, apiKey: 'k', logger: silentLog });
    expect(out.colours).toEqual(['green']);
    expect(String((fetchImpl.mock.calls.at(-1) as unknown[])[0])).toContain(MODELS.flash);
  }, 30_000);

  it('moves to the next model in the chain when a model is out of daily quota', async () => {
    const tried: string[] = [];
    const fetchImpl = vi.fn(async (u: unknown) => {
      tried.push(String(u).split('/models/')[1]?.split(':')[0] as string);
      return tried.length === 1 ? json({ error: { message: 'daily limit' } }, 429) : geminiReply('{"colours":["teal"]}');
    });
    const out = await generateJson({ role: 'flash', schema, prompt: 'x', fetchImpl: fetchImpl as never, apiKey: 'k', logger: silentLog });
    expect(out.colours).toEqual(['teal']);
    expect(tried).toHaveLength(2);
    expect(tried[0]).not.toBe(tried[1]);
  }, 30_000);

  it('stops at the spending cap with QuotaError', async () => {
    const spend = new SpendTracker(0.0001);
    spend.add('pro', 1_000_000, 0);
    await expect(
      generateJson({ role: 'flash', schema, prompt: 'x', fetchImpl: vi.fn() as never, apiKey: 'k', spend, logger: silentLog })
    ).rejects.toMatchObject({ code: 'QuotaError' });
  });
});

describe('fetchSerp', () => {
  it('resolves Google goto links, drops duplicates and maps PAA and related searches', async () => {
    const page = {
      organic_results: [
        { position: 1, title: 'A', link: 'https://a.example.org/p/1', domain: 'a.example.org' },
        { position: 2, title: 'B', link: 'https://www.google.com/goto?url=TOKEN', domain: 'b.example.org' },
        { position: 3, title: 'A2', link: 'https://a.example.org/p/2', domain: 'a.example.org' },
      ],
      related_questions: [{ question: 'Is it dishwasher safe?' }],
      related_searches: [{ query: 'ceramic dripper set' }],
    };
    const fetchImpl = vi.fn(async (u: unknown) => {
      const url = String(u);
      if (url.includes('google.com/goto')) return new Response(null, { status: 302, headers: { location: 'https://b.example.org/product/9' } });
      return json(url.includes('page=') ? { organic_results: [] } : page);
    });
    const serp = await fetchSerp({ keyword: 'ceramic dripper', apiKey: 'k', fetchImpl: fetchImpl as never });
    expect(serp.organic.map((o) => o.url)).toEqual(['https://a.example.org/p/1', 'https://b.example.org/product/9']);
    expect(serp.peopleAlsoAsk[0]?.question).toMatch(/dishwasher/);
    expect(serp.relatedSearches).toEqual(['ceramic dripper set']);
  });

  it('maps HTTP 402 to QuotaError and 401 to UpstreamModelError', async () => {
    await expect(fetchSerp({ keyword: 'x', apiKey: 'k', fetchImpl: (async () => json({}, 402)) as never })).rejects.toMatchObject({ code: 'QuotaError' });
    await expect(fetchSerp({ keyword: 'x', apiKey: 'k', fetchImpl: (async () => json({}, 401)) as never })).rejects.toMatchObject({ code: 'UpstreamModelError' });
  });
});

describe('discoverAiCitedSources', () => {
  it('resolves cited redirects and keeps the Search entry point', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        candidates: [
          {
            content: { parts: [{ text: 'answer' }] },
            groundingMetadata: {
              groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/r/1', title: 'One' } }, { web: { uri: 'https://vertexaisearch.cloud.google.com/r/2', title: 'Two' } }],
              searchEntryPoint: { renderedContent: '<div>Google Search</div>' },
              webSearchQueries: ['q'],
            },
          },
        ],
        usageMetadata: {},
      })
    );
    const out = await discoverAiCitedSources({
      keyword: 'k',
      apiKey: 'k',
      fetchImpl: fetchImpl as never,
      logger: silentLog,
      resolveUrl: async (u) => (u.endsWith('/1') ? 'https://one.example.org/p' : null),
    });
    expect(out.sources).toEqual([{ url: 'https://one.example.org/p', title: 'One' }]);
    expect(out.searchEntryPointHtml).toContain('Google Search');
  });

  it('degrades to an empty result when grounding has no quota', async () => {
    const out = await discoverAiCitedSources({
      keyword: 'k',
      apiKey: 'k',
      fetchImpl: (async () => json({ error: {} }, 429)) as never,
      logger: silentLog,
    });
    expect(out.sources).toEqual([]);
    expect(out.unavailableReason).toMatch(/unavailable/);
  }, 30_000);
});

function fakeExtraction(over: Partial<Extraction> = {}): Extraction {
  return {
    version: 1,
    auditId: 'a',
    sourceUrl: 'https://c.example.org/p',
    finalUrl: 'https://c.example.org/p',
    capturedAt: new Date().toISOString(),
    source: 'live',
    platform: { type: 'custom', confidence: 0.3, signals: [] },
    hydration: { mode: 'server', framework: 'none', signals: [], sentinelSurvived: null },
    meta: { title: 'T', description: '' },
    content: { h1: 'T', text: 'Cash on delivery and UPI accepted. Free shipping. 7 day returns. 4.5 out of 5 reviews. BPA free.', wordCount: 18 },
    headingTree: [{ level: 1, text: 'T', children: [{ level: 2, text: 'Product Details', children: [] }, { level: 2, text: 'Shipping & Returns', children: [] }] }],
    jsonLd: [{ '@type': 'Product' }, { '@type': ['BreadcrumbList'] }],
    images: [
      { src: 'https://x/a.jpg', alt: 'lifestyle kitchen shot', role: 'hero' },
      { src: 'https://x/size-chart.jpg', alt: 'size chart', role: 'gallery' },
    ],
    variants: [],
    reviews: { items: [] },
    ctaPositions: [{ text: 'Add to cart', selector: '#a', viewport: 'mobile', top: 500, aboveFold: true, sticky: false }],
    designTokens: { fontFamilies: [], baseFontSizePx: 16, colors: [], borderRadiiPx: [] },
    components: [],
    classWhitelist: [],
    stats: { blockedRequests: 0, stubbedRequests: 0, assetCount: 0, renderMs: 1, imagesDisabled: false },
    ...over,
  };
}

describe('profiles and consensus', () => {
  it('detects trust elements and image types', () => {
    expect(detectTrustElements('COD available. UPI. free delivery. 1 year warranty')).toEqual(
      expect.arrayContaining(['cod', 'upi', 'free_shipping', 'warranty'])
    );
    expect(classifyImages(fakeExtraction().images).sort()).toEqual(['lifestyle', 'size_chart']);
  });

  it('builds a profile from an extraction', () => {
    const p = buildProfile('c1', fakeExtraction(), ['Stainless Steel', 'stainless steel']);
    expect(p.sections).toEqual(['product details', 'shipping returns']);
    expect(p.entities).toEqual(['stainless steel']);
    expect(p.schemaTypes).toEqual(['Product', 'BreadcrumbList']);
    expect(p.ctaAboveFoldMobile).toBe(true);
    expect(p.trust).toEqual(expect.arrayContaining(['cod', 'upi', 'returns', 'reviews']));
  });

  it('computes frequencies, shares and the low-confidence flag deterministically', () => {
    const mk = (id: string, entities: string[], trust: string[]) => ({
      ...buildProfile(id, fakeExtraction(), entities),
      trust: trust as never,
    });
    const profiles = [mk('1', ['a', 'b'], ['cod']), mk('2', ['a'], ['cod', 'upi']), mk('3', ['a', 'c'], ['cod'])];
    const c1 = buildConsensus(profiles);
    const c2 = buildConsensus(profiles);
    expect(c1).toEqual(c2);
    expect(c1.entities[0]).toEqual({ name: 'a', frequency: 3 });
    expect(c1.trustElements.find((t) => t.kind === 'cod')?.frequency).toBe(3);
    expect(c1.cta.aboveFoldMobileShare).toBe(1);
    expect(c1.lowConfidence).toBe(true);
    expect(buildConsensus([])).toMatchObject({ competitorCount: 0, lowConfidence: true });
  });
});

describe('buildCandidates', () => {
  const serp = (urls: string[]): SerpResult => ({
    keyword: 'k',
    organic: urls.map((url, i) => ({ position: i + 1, url, title: '', snippet: '', domain: new URL(url).hostname })),
    peopleAlsoAsk: [],
    relatedSearches: [],
  });
  const noGrounding: GroundingResult = { keyword: 'k', sources: [], searchQueries: [] };

  it('removes the target site, social and duplicate domains and puts marketplaces last', () => {
    const c = buildCandidates(
      'https://www.mystore.com/products/x',
      serp([
        'https://www.amazon.in/dp/1',
        'https://www.youtube.com/watch?v=1',
        'https://shop.mystore.com/p/2',
        'https://a.example.org/p/1',
        'https://a.example.org/p/2',
        'https://b.example.org/p/1',
      ]),
      { ...noGrounding, sources: [{ url: 'https://c.example.org/p', title: '' }] }
    );
    expect(c.map((x) => new URL(x.url).hostname)).toEqual(['a.example.org', 'b.example.org', 'c.example.org', 'www.amazon.in']);
    expect(c.map((x) => x.rank)).toEqual([1, 2, 3, 4]);
    expect(c[2]?.source).toBe('ai_cited');
  });
});

describe('captureCompetitors', () => {
  const candidates: CompetitorCandidate[] = Array.from({ length: 14 }, (_, i) => ({
    competitorId: `c${i + 1}`,
    url: `https://s${i + 1}.example.org/p`,
    rank: i + 1,
    source: 'organic',
  }));

  it('skips blocked sites and backfills from later ranks until enough are usable', async () => {
    const blockedUrls = new Set(['s2', 's3', 's4', 's5', 's6']);
    const capture = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname.split('.')[0] as string;
      if (blockedUrls.has(host)) throw new BlockedSiteError('blocked', 'http_status');
      return { extraction: fakeExtraction(), timings: { renderMs: 1, snapshotMs: 0, analysisMs: 0, totalMs: 1 } };
    });
    const seen: string[] = [];
    const out = await captureCompetitors({
      auditId: 'a',
      candidates,
      storage: {} as never,
      capture: capture as never,
      onOutcome: (o) => void seen.push(`${o.candidate.competitorId}:${o.status}`),
      logger: silentLog,
    });
    const ok = out.filter((o) => o.status === 'ok');
    expect(out.filter((o) => o.status === 'skipped').map((o) => o.reason)).toContain('blocked');
    expect(ok.length).toBeGreaterThanOrEqual(7);
    expect(capture.mock.calls.length).toBeGreaterThan(10);
    expect(out.map((o) => o.candidate.rank)).toEqual([...out.map((o) => o.candidate.rank)].sort((a, b) => a - b));
    expect(seen.length).toBe(out.length);
    const firstCall = capture.mock.calls[0] as unknown as [{ lite: boolean; artifactPrefix: string }];
    expect(firstCall[0].lite).toBe(true);
    expect(firstCall[0].artifactPrefix).toMatch(/a\/competitors\/c\d+/);
  });

  it('marks a site that exceeds its time budget as too slow', async () => {
    const out = await captureCompetitors({
      auditId: 'a',
      candidates: candidates.slice(0, 1),
      storage: {} as never,
      budgetMs: 50,
      capture: (() => new Promise(() => undefined)) as never,
      logger: silentLog,
    });
    expect(out[0]).toMatchObject({ status: 'skipped', reason: 'too slow' });
  });

  it('does not exceed the configured concurrency', async () => {
    let active = 0;
    let peak = 0;
    const capture = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return { extraction: fakeExtraction(), timings: { renderMs: 1, snapshotMs: 0, analysisMs: 0, totalMs: 1 } };
    };
    await captureCompetitors({ auditId: 'a', candidates: candidates.slice(0, 10), storage: {} as never, capture: capture as never, concurrency: 5, logger: silentLog });
    expect(peak).toBeLessThanOrEqual(5);
  });
});
