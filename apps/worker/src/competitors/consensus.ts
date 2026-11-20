import {
  ConsensusModelSchema,
  type CompetitorProfile,
  type ConsensusModel,
  type ImageType,
  type TrustElementKind,
} from '@rankforge/schema';

/** Fewer usable competitors than this flags "low competitor confidence" (spec 4.3). */
export const LOW_CONFIDENCE_BELOW = 5;

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'of', 'a', 'an', 'in', 'to', 'your', 'our', 'made', 'free', 'high', 'quality']);

function stem(word: string): string {
  return word.replace(/(ing|ed|es|s)$/i, '').replace(/(.)$/, '$1');
}

/**
 * Key that makes "dishwasher safe", "Dishwasher-safe" and "safe for dishwashers" the same entity: lowercase,
 * stop words dropped, light stemming, tokens sorted.
 */
export function entityKey(entity: string): string {
  const tokens = entity
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem)
    .filter(Boolean);
  return [...new Set(tokens)].sort().join(' ');
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function tally<T extends string>(lists: T[][]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const list of lists) for (const item of new Set(list)) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

/**
 * Consensus model across competitors (spec F3.8): the sections, entities, schema types, trust elements and
 * image types that appear on competitors, with frequencies. Deterministic: same profiles in, same model out.
 * Consumers apply their own thresholds (for example entities on 4+ competitors count as consensus).
 */
export function buildConsensus(profiles: CompetitorProfile[]): ConsensusModel {
  const n = profiles.length;

  const headingCounts = tally(profiles.map((p) => p.sections));
  const positions = new Map<string, number[]>();
  for (const p of profiles) {
    p.sections.forEach((h, i) => {
      const rel = p.sections.length > 1 ? i / (p.sections.length - 1) : 0;
      positions.set(h, [...(positions.get(h) ?? []), rel]);
    });
  }
  const sectionSequence = [...headingCounts.entries()]
    .filter(([, f]) => f >= Math.min(2, n))
    .map(([heading, frequency]) => ({
      heading,
      frequency,
      medianPosition: Math.round(median(positions.get(heading) ?? []) * 100) / 100,
    }))
    .sort((a, b) => a.medianPosition - b.medianPosition || b.frequency - a.frequency)
    .slice(0, 40);

  const sortByFrequency = <T extends { frequency: number }>(rows: T[]) => rows.sort((a, b) => b.frequency - a.frequency);

  // Cluster similar phrases, count each cluster once per competitor, and name it by its most common wording.
  const clusters = new Map<string, { names: Map<string, number>; competitors: Set<string> }>();
  for (const p of profiles) {
    for (const raw of p.entities) {
      const key = entityKey(raw);
      if (!key) continue;
      const c = clusters.get(key) ?? { names: new Map<string, number>(), competitors: new Set<string>() };
      c.names.set(raw, (c.names.get(raw) ?? 0) + 1);
      c.competitors.add(p.competitorId);
      clusters.set(key, c);
    }
  }
  const entities = sortByFrequency(
    [...clusters.values()].map((c) => ({
      name: [...c.names.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]![0],
      frequency: c.competitors.size,
    }))
  ).slice(0, 120);
  const schemaTypes = sortByFrequency(
    [...tally(profiles.map((p) => p.schemaTypes)).entries()].map(([type, frequency]) => ({ type, frequency }))
  );
  const trustElements = sortByFrequency(
    [...tally<TrustElementKind>(profiles.map((p) => p.trust)).entries()].map(([kind, frequency]) => ({ kind, frequency }))
  );
  const imageTypes = sortByFrequency(
    [...tally<ImageType>(profiles.map((p) => p.imageTypes)).entries()].map(([type, frequency]) => ({ type, frequency }))
  );

  const share = (pick: (p: CompetitorProfile) => boolean) =>
    n === 0 ? 0 : Math.round((profiles.filter(pick).length / n) * 100) / 100;

  return ConsensusModelSchema.parse({
    competitorCount: n,
    lowConfidence: n < LOW_CONFIDENCE_BELOW,
    sectionSequence,
    entities,
    schemaTypes,
    trustElements,
    imageTypes,
    cta: { aboveFoldMobileShare: share((p) => p.ctaAboveFoldMobile), stickyShare: share((p) => p.ctaSticky) },
    medianWordCount: median(profiles.map((p) => p.wordCount)),
    medianImageCount: median(profiles.map((p) => p.imageCount)),
  });
}
