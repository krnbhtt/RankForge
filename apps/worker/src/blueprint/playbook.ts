import type { AuditFinding, ConsensusModel, Extraction, Justification, SectionType, TrustElementKind } from '@rankforge/schema';
import { detectTrustElements } from '../competitors/profile.js';
import type { EntityGapResult } from '../analysis/entity-gap.js';

export interface PlaybookContext {
  extraction: Extraction;
  findings: AuditFinding[];
  consensus: ConsensusModel;
  gap: EntityGapResult;
}

export interface PlannedSection {
  type: SectionType;
  name: string;
  tag: 'Ranking' | 'Conversion' | 'Both';
  sample: boolean;
  contentType: 'table' | 'list' | 'accordion' | 'cards' | 'paragraphs' | 'banner';
  depth: 'short' | 'medium' | 'long';
  defaultH2: string;
  defaultH3s: string[];
  justifications: Justification[];
}

export interface PlaybookRule {
  id: string;
  title: string;
  /** Plain-language best practice, shown as the justification note. */
  practice: string;
  evaluate(ctx: PlaybookContext): PlannedSection | null;
}

const freq = (c: ConsensusModel, kind: TrustElementKind) => c.trustElements.find((t) => t.kind === kind)?.frequency ?? 0;

function findingRefs(findings: AuditFinding[], pattern: RegExp): AuditFinding[] {
  return findings.filter((f) => pattern.test(f.title));
}

function refsFor(findings: AuditFinding[], pattern: RegExp, note: string): Justification[] {
  return findingRefs(findings, pattern).map((f) => ({ kind: 'finding' as const, ref: f.findingId, note: `${f.title}. ${note}`.slice(0, 300) }));
}

/**
 * CRO playbook (skill cro-playbook): product-detail-page best practice as deterministic rules. A rule fires only
 * when the page lacks the element AND measured evidence supports adding it, so every section can be traced.
 */
export const PLAYBOOK: PlaybookRule[] = [
  {
    id: 'pdp.reassurance',
    title: 'Delivery, payment and returns near the buy button',
    practice: 'Shoppers hesitate without delivery, payment and returns information close to the buy button.',
    evaluate({ extraction, findings, consensus }) {
      const own = new Set(detectTrustElements(extraction.content.text));
      const missing = (['cod', 'upi', 'returns', 'delivery'] as const).filter((k) => !own.has(k) && freq(consensus, k) >= Math.max(1, Math.ceil(consensus.competitorCount * 0.3)));
      if (missing.length === 0) return null;
      const justifications: Justification[] = [
        { kind: 'playbook_rule', ref: 'pdp.reassurance', note: 'Delivery, payment and returns near the buy button lift conversion.' },
        ...missing.map((k) => ({ kind: 'competitor_pattern' as const, ref: `trust.${k}`, note: `${freq(consensus, k)} of ${consensus.competitorCount} competitors mention ${k.replace('_', ' ')}.` })),
        ...refsFor(findings, /cash on delivery|UPI|returns|delivery/i, 'Missing from this page.'),
      ];
      return {
        type: 'delivery_payment',
        name: 'Delivery, payment and returns',
        tag: 'Conversion',
        sample: true,
        contentType: 'list',
        depth: 'short',
        defaultH2: 'Delivery, payment and returns',
        defaultH3s: [],
        justifications,
      };
    },
  },
  {
    id: 'pdp.trust-badges',
    title: 'Trust badges and secure payment marks',
    practice: 'Visible trust marks near the price reduce purchase anxiety.',
    evaluate({ extraction, consensus, findings }) {
      const own = new Set(detectTrustElements(extraction.content.text));
      const n = Math.max(freq(consensus, 'certification'), freq(consensus, 'secure_payment'), freq(consensus, 'guarantee'));
      if (own.has('certification') || own.has('secure_payment') || own.has('guarantee') || n < 3) return null;
      return {
        type: 'trust_row',
        name: 'Trust row',
        tag: 'Conversion',
        sample: true,
        contentType: 'cards',
        depth: 'short',
        defaultH2: 'Why shoppers trust this store',
        defaultH3s: [],
        justifications: [
          { kind: 'playbook_rule', ref: 'pdp.trust-badges', note: 'Trust marks near the price reduce purchase anxiety.' },
          { kind: 'competitor_pattern', ref: 'trust.badges', note: `${n} of ${consensus.competitorCount} competitors show certifications, guarantees or secure-payment marks.` },
          ...refsFor(findings, /trust badges|trust/i, 'No trust marks on this page.'),
        ],
      };
    },
  },
  {
    id: 'pdp.reviews',
    title: 'Customer reviews',
    practice: 'Four or more visible reviews and a rating near the title are the strongest proof on a product page.',
    evaluate({ extraction, consensus, findings }) {
      if ((extraction.reviews.reviewCount ?? 0) > 0 || extraction.reviews.items.length >= 4) return null;
      const n = freq(consensus, 'reviews');
      return {
        type: 'sample_reviews',
        name: 'Customer reviews',
        tag: 'Conversion',
        sample: true,
        contentType: 'cards',
        depth: 'medium',
        defaultH2: 'Customer reviews',
        defaultH3s: [],
        justifications: [
          { kind: 'playbook_rule', ref: 'pdp.reviews', note: 'Reviews are the strongest proof on a product page.' },
          { kind: 'competitor_pattern', ref: 'trust.reviews', note: `${n} of ${consensus.competitorCount} competitors show reviews.` },
          ...refsFor(findings, /review|social proof/i, 'No reviews are visible.'),
        ],
      };
    },
  },
  {
    id: 'pdp.specs',
    title: 'Specification table covering the attributes competitors list',
    practice: 'A scannable specification table answers sizing, material and care questions before purchase and matches how shoppers search.',
    evaluate({ gap, consensus, findings }) {
      if (gap.missing.length < 2) return null;
      return {
        type: 'spec_table',
        name: 'Specifications',
        tag: 'Both',
        sample: true,
        contentType: 'table',
        depth: 'medium',
        defaultH2: 'Product specifications',
        defaultH3s: [],
        justifications: [
          { kind: 'playbook_rule', ref: 'pdp.specs', note: 'A specification table answers material, size and care questions.' },
          ...gap.missing.slice(0, 4).map((m) => ({ kind: 'competitor_pattern' as const, ref: `entity.${m.name}`, note: `"${m.name}" appears on ${m.frequency} of ${consensus.competitorCount} competitors.` })),
          ...refsFor(findings, /does not mention/i, 'Attributes competitors cover.'),
        ],
      };
    },
  },
  {
    id: 'pdp.faq',
    title: 'FAQ answering the shopper question sequence',
    practice: 'An FAQ that answers follow-up questions in the order shoppers ask them supports both rankings and purchase confidence.',
    evaluate({ gap, findings }) {
      const unanswered = gap.querySequence.filter((q) => !q.answered);
      if (unanswered.length === 0) return null;
      return {
        type: 'faq',
        name: 'Frequently asked questions',
        tag: 'Both',
        sample: true,
        contentType: 'accordion',
        depth: unanswered.length > 5 ? 'long' : 'medium',
        defaultH2: 'Frequently asked questions',
        defaultH3s: unanswered.slice(0, 6).map((q) => q.query),
        justifications: [
          { kind: 'playbook_rule', ref: 'pdp.faq', note: 'Answer follow-up questions in the order shoppers ask them.' },
          ...unanswered.slice(0, 4).map((q) => ({ kind: 'competitor_pattern' as const, ref: `query.${q.order}`, note: `Shoppers also ask: "${q.query}" (${q.source}).` })),
          ...refsFor(findings, /shopper questions/i, 'Questions the page does not answer.'),
        ],
      };
    },
  },
  {
    id: 'pdp.price-clarity',
    title: 'Tax and price clarity near the button',
    practice: 'State what the price includes next to the button.',
    evaluate({ extraction, findings }) {
      if (/inclusive of (all )?(taxes|gst)|incl\.? (of )?(gst|taxes?)|taxes? included/i.test(extraction.content.text) || !extraction.price) return null;
      return {
        type: 'price_clarity',
        name: 'Price note',
        tag: 'Conversion',
        sample: true,
        contentType: 'banner',
        depth: 'short',
        defaultH2: 'Price details',
        defaultH3s: [],
        justifications: [
          { kind: 'playbook_rule' as const, ref: 'pdp.price-clarity', note: 'State what the price includes next to the button.' },
          ...refsFor(findings, /price|MRP/i, 'Price information is incomplete.'),
        ].slice(0, 3),
      };
    },
  },
  {
    id: 'pdp.sticky-cta',
    title: 'Sticky add-to-cart bar',
    practice: 'Keep the buy button in view while shoppers read the rest of the page.',
    evaluate({ extraction, consensus, findings }) {
      const hasCta = extraction.ctaPositions.length > 0;
      if (!hasCta || extraction.ctaPositions.some((c) => c.sticky)) return null;
      const n = Math.round(consensus.cta.stickyShare * consensus.competitorCount);
      const aboveFold = extraction.ctaPositions.some((c) => c.viewport === 'mobile' && c.aboveFold);
      if (n === 0 && aboveFold) return null;
      return {
        type: 'sticky_cta',
        name: 'Sticky buy bar',
        tag: 'Conversion',
        sample: false,
        contentType: 'banner',
        depth: 'short',
        defaultH2: 'Buy bar',
        defaultH3s: [],
        justifications: [
          { kind: 'playbook_rule', ref: 'pdp.sticky-cta', note: 'Keep the buy button in view while shoppers read the rest of the page.' },
          ...(n > 0 ? [{ kind: 'competitor_pattern' as const, ref: 'cta.sticky', note: `${n} of ${consensus.competitorCount} competitors keep the button in view while scrolling.` }] : []),
          ...refsFor(findings, /sticky|below the fold/i, 'Button visibility.'),
        ],
      };
    },
  },
];

/** Evaluates every rule; the result is the candidate section list in playbook order. */
export function evaluatePlaybook(ctx: PlaybookContext): PlannedSection[] {
  return PLAYBOOK.map((r) => r.evaluate(ctx)).filter((s): s is PlannedSection => s !== null);
}
