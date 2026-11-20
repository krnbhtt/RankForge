import type { AuditFinding, ConsensusModel, Extraction, TrustElementKind } from '@rankforge/schema';
import { detectTrustElements } from '../competitors/profile.js';
import type { EntityGapResult } from './entity-gap.js';
import type { OnPageAudit } from './onpage-audit.js';
import type { CoreWebVitals } from './psi.js';
import type { RuleResult, SchemaAudit } from './schema-audit.js';
import type { VisualFinding } from './visual-cro.js';

export interface FindingInputs {
  auditId: string;
  extraction: Extraction;
  consensus: ConsensusModel;
  schema: SchemaAudit;
  onPage: OnPageAudit;
  cwv: CoreWebVitals | null;
  gap: EntityGapResult;
  visualFindings: VisualFinding[];
  now?: Date;
}

type Draft = Omit<AuditFinding, 'findingId' | 'auditId' | 'createdAt'>;

const ofCompetitors = (n: number, total: number) => `${n} of ${total} competitors`;

function trustFrequency(consensus: ConsensusModel, kind: TrustElementKind): number {
  return consensus.trustElements.find((t) => t.kind === kind)?.frequency ?? 0;
}

function fromRules(rules: RuleResult[], tag: Draft['tag']): Draft[] {
  return rules
    .filter((r) => r.penaltyPoints > 0 || r.severity !== 'low')
    .map((r) => ({
      category: tag === 'Ranking' ? 'ranking' : tag === 'Conversion' ? 'conversion' : 'both',
      tag,
      severity: r.severity,
      title: r.title,
      description: r.title,
      penaltyPoints: r.penaltyPoints,
      evidence: r.evidence,
    }));
}

/**
 * Turns measured facts into findings. Every finding carries evidence: a measured value, a competitor count,
 * or a screenshot region (spec 7.4). Deterministic: same inputs, same findings.
 */
export function buildFindings(input: FindingInputs): AuditFinding[] {
  const { extraction, consensus, schema, onPage, cwv, gap } = input;
  const total = consensus.competitorCount;
  const drafts: Draft[] = [...fromRules(schema.rules, 'Ranking'), ...fromRules(onPage.rules, 'Ranking')];

  if (cwv) {
    const problems: string[] = [];
    if (cwv.lcpSeconds !== undefined && cwv.lcpSeconds > 2.5) problems.push(`LCP ${cwv.lcpSeconds}s (target 2.5s)`);
    if (cwv.cls !== undefined && cwv.cls > 0.1) problems.push(`CLS ${cwv.cls} (target 0.1)`);
    if (cwv.inpMs !== undefined && cwv.inpMs > 200) problems.push(`INP ${cwv.inpMs}ms (target 200ms)`);
    if (problems.length) {
      drafts.push({
        category: 'both',
        tag: 'Both',
        severity: problems.length > 1 ? 'high' : 'medium',
        title: 'Core Web Vitals miss Google targets on mobile',
        description: 'Slow loading or shifting layout hurts both rankings and purchases.',
        penaltyPoints: 8,
        evidence: `PageSpeed Insights (${cwv.source} data): ${problems.join(', ')}.`,
      });
    }
  }

  if (gap.missing.length > 0) {
    const top = gap.missing.slice(0, 8);
    drafts.push({
      category: 'ranking',
      tag: 'Ranking',
      severity: gap.missing.length >= 8 ? 'high' : 'medium',
      title: `The page does not mention ${gap.missing.length} attribute${gap.missing.length === 1 ? '' : 's'} competitors cover`,
      description: `Missing: ${top.map((m) => m.name).join(', ')}.`,
      penaltyPoints: Math.round((gap.missing.length / Math.max(1, gap.consensusEntities.length)) * 20 * 10) / 10,
      evidence: top.map((m) => `"${m.name}" appears on ${ofCompetitors(m.frequency, total)}`).join('; ') + '.',
      competitorCount: top[0]?.frequency,
    });
  }

  const unanswered = gap.querySequence.filter((q) => !q.answered);
  if (unanswered.length > 0) {
    drafts.push({
      category: 'ranking',
      tag: 'Ranking',
      severity: unanswered.length >= 5 ? 'high' : 'medium',
      title: `${unanswered.length} of ${gap.querySequence.length} shopper questions are not answered on the page`,
      description: unanswered.slice(0, 4).map((q) => q.query).join(' / '),
      penaltyPoints: Math.round((unanswered.length / Math.max(1, gap.querySequence.length)) * 15 * 10) / 10,
      evidence: `Unanswered: ${unanswered.slice(0, 5).map((q) => `"${q.query}"`).join(', ')}. No matching text found on the page.`,
    });
  }

  const text = extraction.content.text;
  const own = new Set(detectTrustElements(text));
  const mobileCtas = extraction.ctaPositions.filter((c) => c.viewport === 'mobile');
  const ctas = mobileCtas.length ? mobileCtas : extraction.ctaPositions;

  if (ctas.length === 0) {
    drafts.push({
      category: 'conversion',
      tag: 'Conversion',
      severity: 'critical',
      title: 'No add-to-cart button was found',
      description: 'Shoppers cannot see how to buy.',
      penaltyPoints: 25,
      evidence: 'No button or link matching "add to cart", "buy now" or similar was found on the rendered page.',
    });
  } else if (!ctas.some((c) => c.aboveFold)) {
    const first = ctas[0];
    drafts.push({
      category: 'conversion',
      tag: 'Conversion',
      severity: 'high',
      title: 'The add-to-cart button is below the fold on mobile',
      description: 'Shoppers must scroll before they can buy.',
      penaltyPoints: 10,
      evidence: `The button "${first?.text}" starts ${first?.top}px from the top; a 390px-wide phone shows about 844px.`,
      competitorCount: Math.round(consensus.cta.aboveFoldMobileShare * total),
    });
  }
  if (ctas.length > 0 && !extraction.ctaPositions.some((c) => c.sticky) && consensus.cta.stickyShare > 0) {
    drafts.push({
      category: 'conversion',
      tag: 'Conversion',
      severity: 'medium',
      title: 'No sticky add-to-cart bar',
      description: 'The buy button disappears while shoppers read the rest of the page.',
      penaltyPoints: 5,
      evidence: `${ofCompetitors(Math.round(consensus.cta.stickyShare * total), total)} keep the button in view while scrolling; this page does not.`,
      competitorCount: Math.round(consensus.cta.stickyShare * total),
    });
  }

  const gaps: [TrustElementKind, string, string, number][] = [
    ['cod', 'Cash on delivery is not mentioned', 'cash on delivery', 6],
    ['upi', 'UPI payment is not mentioned', 'UPI', 6],
    ['returns', 'No returns information on the page', 'returns information', 6],
    ['delivery', 'No delivery estimate or pincode check', 'a delivery estimate', 6],
  ];
  for (const [kind, title, label, points] of gaps) {
    const n = trustFrequency(consensus, kind);
    if (!own.has(kind) && n >= Math.max(1, Math.ceil(total * 0.3))) {
      drafts.push({
        category: 'conversion',
        tag: 'Conversion',
        severity: n / Math.max(1, total) >= 0.6 ? 'high' : 'medium',
        title,
        description: `Shoppers look for ${label} before buying.`,
        penaltyPoints: points,
        evidence: `${ofCompetitors(n, total)} mention ${label}; this page does not.`,
        competitorCount: n,
      });
    }
  }

  const reviewCount = extraction.reviews.reviewCount ?? 0;
  if (reviewCount === 0 && extraction.reviews.items.length === 0) {
    const n = trustFrequency(consensus, 'reviews');
    drafts.push({
      category: 'conversion',
      tag: 'Conversion',
      severity: 'high',
      title: 'No customer reviews are visible',
      description: 'Reviews are the strongest trust signal on a product page.',
      penaltyPoints: 10,
      evidence: `No rating or review count found on the page; ${ofCompetitors(n, total)} show reviews.`,
      competitorCount: n,
    });
  }

  if (!extraction.price) {
    drafts.push({
      category: 'conversion',
      tag: 'Conversion',
      severity: 'high',
      title: 'The price could not be found on the page',
      description: 'A clear price near the button is essential.',
      penaltyPoints: 8,
      evidence: 'No price element or Offer price was detected.',
    });
  } else if (extraction.price.mrp === undefined) {
    drafts.push({
      category: 'conversion',
      tag: 'Conversion',
      severity: 'low',
      title: 'No original price (MRP) shown next to the selling price',
      description: 'Showing the MRP and discount makes the offer clearer.',
      penaltyPoints: 4,
      evidence: `Only one price found (${extraction.price.raw.slice(0, 40)}).`,
    });
  }

  const hidden = extraction.pageSignals?.hiddenOverlays ?? 0;
  if (hidden > 0) {
    drafts.push({
      category: 'conversion',
      tag: 'Conversion',
      severity: 'medium',
      title: 'A pop-up covers the page on first visit',
      description: 'Intrusive pop-ups push shoppers away before they see the product.',
      penaltyPoints: 5,
      evidence: `${hidden} overlay element${hidden === 1 ? '' : 's'} (pop-up or banner) covered the page when it loaded.`,
    });
  }
  const heights = ctas.map((c) => c.heightPx).filter((h): h is number => typeof h === 'number');
  if (heights.length && heights.some((h) => h < 48)) {
    drafts.push({
      category: 'conversion',
      tag: 'Conversion',
      severity: 'low',
      title: 'The buy button is smaller than the 48px tap target',
      description: 'Small buttons are hard to tap on a phone.',
      penaltyPoints: 3,
      evidence: `The add-to-cart button is ${Math.min(...heights)}px tall on mobile.`,
    });
  }
  if (extraction.designTokens.baseFontSizePx < 14) {
    drafts.push({
      category: 'conversion',
      tag: 'Conversion',
      severity: 'low',
      title: 'Body text is small',
      description: 'Small text is harder to read on a phone.',
      penaltyPoints: 3,
      evidence: `The base font size is ${extraction.designTokens.baseFontSizePx}px; 14px or more is recommended.`,
    });
  }

  for (const v of input.visualFindings) {
    drafts.push({
      category: 'conversion',
      tag: 'Conversion',
      severity: v.severity,
      title: v.title,
      description: v.title,
      penaltyPoints: v.severity === 'critical' ? 8 : v.severity === 'high' ? 5 : v.severity === 'medium' ? 3 : 1,
      evidence: v.evidence,
      region: { viewport: v.viewport, ...v.region },
    });
  }

  const createdAt = (input.now ?? new Date()).toISOString();
  return drafts.map((d, i) => ({
    ...d,
    findingId: `fnd_${String(i + 1).padStart(3, '0')}`,
    auditId: input.auditId,
    createdAt,
  }));
}
