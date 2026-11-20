import { z } from 'zod';
import type { AuditQuery, ConsensusModel, Extraction } from '@rankforge/schema';
import { generateJson, type SpendTracker } from '../ai/gemini.js';
import type { Logger } from '../lib/log.js';

const OutputSchema = z.object({
  presentEntities: z
    .array(z.string())
    .describe('Entities from the provided list that the page clearly covers, copied exactly as given'),
  querySequence: z
    .array(
      z.object({
        query: z.string().describe('A follow-up question or search, copied from the provided queries or newly proposed'),
        answered: z.boolean(),
        evidence: z.string().max(240).describe('A short exact quote from the page that answers it, or an empty string'),
      })
    )
    .max(10)
    .describe('The shopper journey in order: the first question they ask, then the next, and so on'),
});

export interface QuerySequenceStep {
  query: string;
  order: number;
  answered: boolean;
  evidence: string;
  source: AuditQuery['source'] | 'generated';
}

export interface EntityGapResult {
  consensusEntities: { name: string; frequency: number }[];
  found: string[];
  missing: { name: string; frequency: number }[];
  querySequence: QuerySequenceStep[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Entities that appear on enough competitors to count as consensus (spec 7.1: 4+; fewer when few were captured). */
export function consensusThreshold(competitorCount: number): number {
  return Math.min(4, Math.max(2, Math.ceil(competitorCount / 2)));
}

/** A model claim that a page covers an entity is accepted only if most of its words occur in the page text. */
export function entityAppearsInText(entity: string, pageText: string): boolean {
  const tokens = norm(entity)
    .split(' ')
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return false;
  const text = norm(pageText);
  const hits = tokens.filter((t) => text.includes(t.length > 4 ? t.slice(0, t.length - 1) : t)).length;
  return hits / tokens.length >= 0.6;
}

/** A claimed answer to a query counts only if its quoted evidence really occurs in the page. */
export function quoteAppearsInText(quote: string, pageText: string): boolean {
  const q = norm(quote);
  return q.length >= 12 && norm(pageText).includes(q.slice(0, Math.min(q.length, 80)));
}

const QUESTION_STOPWORDS = new Set(['what', 'which', 'does', 'how', 'is', 'are', 'the', 'this', 'that', 'can', 'for', 'with', 'and', 'you', 'your', 'best', 'will', 'should', 'there', 'have', 'from', 'about', 'than', 'between', 'difference', 'much', 'many', 'does', 'come', 'comes']);
const NON_ANSWER = /to be confirmed|seller will confirm|contact the seller|not specified/i;

const stemWord = (w: string) => w.replace(/(ing|ed|es|s)$/i, '');

/**
 * Deterministic answer check shared by the before and after scores: a question counts as answered when one passage of
 * the page (a sentence or block, at least 20 characters, not a "to be confirmed" placeholder) contains most of the
 * question's meaningful words. The model's quote is shown to users but never changes the score.
 */
export function questionAnswered(query: string, pageText: string): boolean {
  const tokens = [...new Set(norm(query).split(' ').filter((t) => t.length > 3 && !QUESTION_STOPWORDS.has(t)).map(stemWord))];
  if (tokens.length < 2) return false;
  const passages = pageText.split(/(?<=[.!?])\s+|[\n\r]+/).map((p) => p.trim()).filter((p) => p.length >= 20 && !p.endsWith('?') && !NON_ANSWER.test(p));
  const need = Math.max(2, Math.ceil(tokens.length * 0.7));
  return passages.some((p) => {
    const text = norm(p);
    return tokens.filter((t) => text.includes(t)).length >= need;
  });
}

/** Consensus entities present on a page, by word match. Same function for before and after. */
export function entitiesPresent(entities: { name: string }[], pageText: string): string[] {
  return entities.filter((e) => entityAppearsInText(e.name, pageText)).map((e) => e.name);
}

/**
 * entity-query-gap skill (spec F4.1, F4.2): which consensus entities the page lacks, and which steps of the
 * shopper's question sequence it answers. The model judges; code verifies every claim against the page text.
 */
export async function analyseEntityQueryGap(
  extraction: Extraction,
  consensus: ConsensusModel,
  queries: AuditQuery[],
  deps: { keyword: string; spend?: SpendTracker; logger?: Logger; auditId?: string }
): Promise<EntityGapResult> {
  const threshold = consensusThreshold(consensus.competitorCount);
  const consensusEntities = consensus.entities.filter((e) => e.frequency >= threshold).slice(0, 40);
  const pageText = `${extraction.meta.title}\n${extraction.content.h1}\n${extraction.content.text}`;
  const queryList = queries.slice(0, 12).map((q) => q.query);

  const out = await generateJson({
    role: 'flash',
    schema: OutputSchema,
    system:
      'You compare a product page with what competitors cover. Be strict: an entity is present only if the page text states it. ' +
      'For each question in the shopper journey, mark it answered only if you can quote the answer from the page.',
    prompt:
      `Keyword: ${deps.keyword}\n\nENTITIES TO CHECK:\n${consensusEntities.map((e) => `- ${e.name}`).join('\n') || '(none)'}\n\n` +
      `SHOPPER QUESTIONS (People Also Ask and related searches):\n${queryList.map((q) => `- ${q}`).join('\n') || '(none)'}\n\n` +
      `PAGE TEXT:\n"""\n${pageText.slice(0, 7000)}\n"""\n\n` +
      'Order the questions as a journey (X then Y then Z). Use only the questions listed above; do not add new ones.',
    temperature: 0,
    spend: deps.spend,
    logger: deps.logger,
    auditId: deps.auditId,
    stage: 'analysis.entities',
  });

  const found = new Set(entitiesPresent(consensusEntities, pageText));

  const sourceOf = new Map(queries.map((q) => [norm(q.query), q.source]));
  // Only questions that came from the SERP count, so the score cannot move with invented questions.
  const knownQueries = out.querySequence.filter((q) => sourceOf.has(norm(q.query)));
  const querySequence: QuerySequenceStep[] = (knownQueries.length ? knownQueries : out.querySequence).map((q, i) => ({
    query: q.query,
    order: i + 1,
    answered: questionAnswered(q.query, pageText),
    evidence: q.evidence,
    source: sourceOf.get(norm(q.query)) ?? 'generated',
  }));

  return {
    consensusEntities,
    found: [...found],
    missing: consensusEntities.filter((e) => !found.has(e.name)),
    querySequence,
  };
}
