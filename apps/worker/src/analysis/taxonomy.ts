import * as fs from 'node:fs';
import * as path from 'node:path';
import { findRepoRoot } from '@rankforge/storage';
import { safeFetch } from '@rankforge/ssrf';

const TAXONOMY_URL = 'https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt';
let cache: string[] | null = null;

export function parseTaxonomy(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.replace(/^\d+\s*-\s*/, '').trim())
    .filter(Boolean);
}

/** Loads the Google Product Taxonomy (cached on disk for 7 days). Returns [] when it cannot be fetched. */
export async function loadTaxonomy(): Promise<string[]> {
  if (cache) return cache;
  const file = path.join(findRepoRoot(), '.data', 'taxonomy.txt');
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 7 * 86_400_000) {
    cache = parseTaxonomy(fs.readFileSync(file, 'utf8'));
    return cache;
  }
  try {
    const res = await safeFetch(TAXONOMY_URL, { timeoutMs: 15_000 });
    if (!res.ok) return [];
    const text = await res.text();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
    cache = parseTaxonomy(text);
    return cache;
  } catch {
    return [];
  }
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 >]+/g, ' ')
      .split(/[\s>]+/)
      .filter((w) => w.length > 2)
  );

/** Returns the taxonomy path equal to `candidate`, or the closest one by word overlap (deeper path wins ties). */
export function closestCategory(candidate: string, taxonomy: string[]): { path: string; exact: boolean } | null {
  if (taxonomy.length === 0) return null;
  const exact = taxonomy.find((t) => t.toLowerCase() === candidate.trim().toLowerCase());
  if (exact) return { path: exact, exact: true };
  const target = words(candidate);
  let best: { path: string; score: number } | null = null;
  for (const t of taxonomy) {
    const tw = words(t);
    let overlap = 0;
    for (const w of target) if (tw.has(w)) overlap++;
    const score = overlap / Math.max(1, target.size) + t.split('>').length * 0.001;
    if (overlap > 0 && (!best || score > best.score)) best = { path: t, score };
  }
  return best ? { path: best.path, exact: false } : null;
}
