import type {
  ScoreCard,
  ScoreAttribution,
} from '@rankforge/schema';
import { calculateVisibilityScore, type VisibilityInput } from './visibility.js';
import { calculateConversionScore, type ConversionInput } from './conversion.js';

export function calculatePPI(visibility: number, conversion: number): number {
  if (visibility <= 0 || conversion <= 0) return 0;
  const clampedVis = Math.min(100, Math.max(0, visibility));
  const clampedConv = Math.min(100, Math.max(0, conversion));
  const ppi = (clampedVis * clampedConv) / 100;
  return Math.round(ppi * 10) / 10;
}

export interface ScoreComparisonInput {
  baseline: {
    visibility: VisibilityInput;
    conversion: ConversionInput;
  };
  optimized: {
    visibility: VisibilityInput;
    conversion: ConversionInput;
  };
  attributions?: ScoreAttribution[];
}

export interface ComputedScoreComparison {
  baselineScoreCard: ScoreCard;
  optimizedScoreCard: ScoreCard;
  deltas: {
    visibility: number;
    conversion: number;
    ppi: number;
  };
}

export function generateScoreCard(
  visibilityInput: VisibilityInput,
  conversionInput: ConversionInput,
  baselineCard?: { visibility: number; conversion: number; ppi: number },
  attributions: ScoreAttribution[] = []
): ScoreCard {
  const visResult = calculateVisibilityScore(visibilityInput);
  const convResult = calculateConversionScore(conversionInput);
  const ppiVal = calculatePPI(visResult.score, convResult.score);

  const baseVis = baselineCard ? baselineCard.visibility : visResult.score;
  const baseConv = baselineCard ? baselineCard.conversion : convResult.score;
  const basePpi = baselineCard ? baselineCard.ppi : ppiVal;

  return {
    visibility: {
      current: visResult.score,
      baseline: baseVis,
      delta: Math.round((visResult.score - baseVis) * 10) / 10,
      max: 100,
      breakdown: visResult.breakdown,
    },
    conversion: {
      current: convResult.score,
      baseline: baseConv,
      delta: Math.round((convResult.score - baseConv) * 10) / 10,
      max: 100,
      breakdown: convResult.breakdown,
    },
    ppi: {
      current: ppiVal,
      baseline: basePpi,
      delta: Math.round((ppiVal - basePpi) * 10) / 10,
    },
    attributions,
    computedAt: new Date().toISOString(),
  };
}

export function compareScores(input: ScoreComparisonInput): ComputedScoreComparison {
  const baseCard = generateScoreCard(
    input.baseline.visibility,
    input.baseline.conversion,
    undefined,
    []
  );

  const optCard = generateScoreCard(
    input.optimized.visibility,
    input.optimized.conversion,
    {
      visibility: baseCard.visibility.current,
      conversion: baseCard.conversion.current,
      ppi: baseCard.ppi.current,
    },
    input.attributions || []
  );

  return {
    baselineScoreCard: baseCard,
    optimizedScoreCard: optCard,
    deltas: {
      visibility: optCard.visibility.delta,
      conversion: optCard.conversion.delta,
      ppi: optCard.ppi.delta,
    },
  };
}
