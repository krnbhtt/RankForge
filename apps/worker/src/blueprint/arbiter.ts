import * as cheerio from 'cheerio';
import {
  BlueprintSchema,
  type Anchor,
  type Blueprint,
  type BlueprintSectionSpec,
  type ComponentInventoryItem,
  type SectionType,
} from '@rankforge/schema';
import type { PlannedSection } from './playbook.js';
import type { StructureAdvice } from './structure.js';

/** Which store component each section type is placed next to, in order of preference. */
const ANCHOR_PREFERENCE: Record<SectionType, { kinds: string[]; fallbacks: string[]; position: Anchor['position'] }> = {
  delivery_payment: { kinds: ['addToCart'], fallbacks: ['form[action*="cart" i]'], position: 'insertAfter' },
  // Placed after the buy button, never between the price and the button, so the button is not pushed down.
  trust_row: { kinds: ['addToCart'], fallbacks: ['form[action*="cart" i]'], position: 'insertAfter' },
  price_clarity: { kinds: ['price'], fallbacks: ['h1'], position: 'insertAfter' },
  spec_table: { kinds: ['description', 'accordion'], fallbacks: ['main h2', 'main'], position: 'insertAfter' },
  sample_reviews: { kinds: ['reviews', 'description'], fallbacks: ['footer', 'main'], position: 'insertAfter' },
  faq: { kinds: ['reviews', 'description'], fallbacks: ['footer', 'main'], position: 'insertAfter' },
  comparison: { kinds: ['description'], fallbacks: ['main'], position: 'insertAfter' },
  description_depth: { kinds: ['description'], fallbacks: ['main'], position: 'insertAfter' },
  sticky_cta: { kinds: [], fallbacks: ['footer', 'main'], position: 'insertAfter' },
};

/** Section types that must never sit above the buy button; they get below-the-fold alternates. */
const BELOW_FOLD_TYPES = new Set<SectionType>(['delivery_payment', 'trust_row', 'sample_reviews', 'faq', 'spec_table']);

/**
 * Places that are below the product block on almost any storefront: just before a footer-like element, or after the
 * main content. Only selectors that match exactly one element on this page are offered.
 */
function belowFoldAlternates($: cheerio.CheerioAPI): { selector: string; position: Anchor['position'] }[] {
  const candidates: [string, Anchor['position']][] = [
    ['footer', 'insertBefore'],
    ['[role="contentinfo"]', 'insertBefore'],
    ['[id*="footer" i]', 'insertBefore'],
    ['main', 'insertAfter'],
    ['#MainContent', 'insertAfter'],
  ];
  const out: { selector: string; position: Anchor['position'] }[] = [];
  for (const [selector, position] of candidates) {
    try {
      if ($(selector).length === 1) out.push({ selector, position });
    } catch {
      continue;
    }
  }
  return out;
}

export interface ArbiterInput {
  auditId: string;
  keyword: string;
  planned: PlannedSection[];
  advice: StructureAdvice | null;
  components: ComponentInventoryItem[];
  /** Snapshot HTML used to verify that anchors resolve to exactly one element. */
  html: string;
  /** Ids of deterministic rules that fired in the audits (schema.*, onpage.*, images.*). */
  ruleIds: string[];
}

function resolveAnchor(
  $: cheerio.CheerioAPI,
  type: SectionType,
  components: ComponentInventoryItem[]
): { anchor: Anchor; note: string } | null {
  const pref = ANCHOR_PREFERENCE[type];
  for (const kind of pref.kinds) {
    for (const c of components.filter((x) => x.kind === kind)) {
      if ($(c.selector).length === 1) {
        return { anchor: { selector: c.selector, position: pref.position, componentKind: kind }, note: `placed after the ${kind} component` };
      }
    }
  }
  for (const sel of pref.fallbacks) {
    try {
      const matches = $(sel);
      if (matches.length >= 1) {
        const first = matches.first();
        const id = first.attr('id');
        const selector = matches.length === 1 ? sel : id ? `#${id}` : sel;
        if ($(selector).length >= 1) return { anchor: { selector, position: pref.position }, note: `no matching component; fell back to "${sel}"` };
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Arbiter (spec F5.3, F5.4), implemented as deterministic code: it merges the playbook's candidate sections with the
 * model's structure advice, enforces limits, verifies that every section traces to evidence, maps each section to a
 * store component (checking the selector against the real snapshot) and records every decision.
 */
export function arbitrate(input: ArbiterInput): Blueprint {
  const $ = cheerio.load(input.html);
  const log: Blueprint['decisionLog'] = [];
  const adviceByType = new Map(input.advice?.sections.map((s) => [s.type, s]) ?? []);

  const kept: { planned: PlannedSection; order: number }[] = [];
  const seen = new Set<SectionType>();
  input.planned.forEach((p, index) => {
    if (seen.has(p.type)) {
      log.push({ decision: `Dropped duplicate "${p.name}"`, reason: 'Only one section of each type is added.' });
      return;
    }
    if (p.justifications.length === 0) {
      log.push({ decision: `Dropped "${p.name}"`, reason: 'No finding, competitor pattern or playbook rule supports it.' });
      return;
    }
    seen.add(p.type);
    kept.push({ planned: p, order: adviceByType.get(p.type)?.order ?? 100 + index });
  });
  kept.sort((a, b) => a.order - b.order);

  const sections: BlueprintSectionSpec[] = [];
  const chainTail = new Map<string, string>();
  for (const { planned } of kept) {
    const advice = adviceByType.get(planned.type);
    const below = BELOW_FOLD_TYPES.has(planned.type) ? belowFoldAlternates($) : [];
    let resolved = resolveAnchor($, planned.type, input.components);
    if (!resolved && below[0]) {
      resolved = { anchor: { selector: below[0].selector, position: below[0].position }, note: `no safe component anchor; placed at "${below[0].selector}"` };
    }
    if (!resolved) {
      log.push({ decision: `Dropped "${planned.name}"`, reason: 'No place on the page could be found to insert it.' });
      continue;
    }
    const sectionId = `sec_${String(sections.length + 1).padStart(2, '0')}_${planned.type}`;
    // Sections that share an anchor are chained, so they appear in blueprint order instead of reversing.
    const anchorKey = `${resolved.anchor.selector}|${resolved.anchor.position}`;
    const previous = chainTail.get(anchorKey);
    const alternates = below.filter((a) => a.selector !== resolved.anchor.selector);
    const anchor: Anchor = {
      ...(previous ? { ...resolved.anchor, selector: `[data-rf-section="${previous}"]`, fallbackSelector: resolved.anchor.selector } : resolved.anchor),
      ...(alternates?.length ? { alternates } : {}),
    };
    chainTail.set(anchorKey, sectionId);

    const h2 = (advice?.h2 ?? planned.defaultH2).trim().slice(0, 100) || planned.defaultH2;
    const h3s = (advice?.h3s ?? planned.defaultH3s).map((h) => h.trim()).filter(Boolean).slice(0, 8);
    sections.push({
      sectionId,
      order: sections.length + 1,
      type: planned.type,
      name: planned.name,
      h2,
      h3s,
      depth: advice?.depth ?? planned.depth,
      contentType: planned.contentType,
      tag: planned.tag,
      sample: planned.sample,
      justifications: planned.justifications.slice(0, 8),
      anchor,
    });
    log.push({
      decision: `Added "${planned.name}" (${planned.tag})`,
      reason: `${planned.justifications[0]?.note ?? ''} It is ${resolved.note}.${planned.sample ? ' Content is illustrative and labelled Sample.' : ''}`.trim(),
    });
  }

  const has = (prefix: string) => input.ruleIds.some((r) => r.startsWith(prefix));
  const deterministicFixes: Blueprint['deterministicFixes'] = [];
  if (input.ruleIds.some((r) => r.startsWith('onpage.title'))) deterministicFixes.push('title');
  if (input.ruleIds.includes('onpage.meta.missing')) deterministicFixes.push('meta_description');
  if (input.ruleIds.includes('images.alt')) deterministicFixes.push('image_alt');
  if (has('schema.product') || has('schema.offer') || has('schema.brand')) deterministicFixes.push('product_schema');
  if (input.ruleIds.includes('schema.breadcrumb.missing')) deterministicFixes.push('breadcrumb_schema');
  for (const fix of deterministicFixes) {
    log.push({ decision: `Deterministic fix: ${fix.replace('_', ' ')}`, reason: 'Applied by code from captured data, with no writing needed.' });
  }

  return BlueprintSchema.parse({
    auditId: input.auditId,
    keyword: input.keyword,
    sections,
    decisionLog: log,
    deterministicFixes,
    generatedBy: input.advice ? 'model' : 'fallback',
  });
}
