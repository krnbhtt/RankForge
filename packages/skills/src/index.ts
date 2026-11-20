import type {
  ScrapeResult,
  GapAnalysisResult,
  PatchOperation,
  FeatureFlags,
} from '@rankforge/schema';

// ==========================================
// 1. Agent Skill Framework Contracts
// ==========================================

export interface SkillContext {
  auditId: string;
  flags: FeatureFlags;
  modelName: string;
  maxTokens?: number;
  temperature?: number;
}

export interface SkillResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  tokensUsed?: number;
  durationMs: number;
}

export interface ISkillHandler<TInput, TOutput> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  execute(input: TInput, context: SkillContext): Promise<SkillResult<TOutput>>;
}

// ==========================================
// 2. Specific Skill Contract Definitions
// ==========================================

// CRO Playbook Skill
export interface CroPlaybookInput {
  scrapeResult: ScrapeResult;
  gapAnalysis: GapAnalysisResult;
}

export interface CroRecommendation {
  element: string;
  ruleId: string;
  recommendation: string;
  impact: 'high' | 'medium' | 'low';
}

export interface CroPlaybookOutput {
  recommendations: CroRecommendation[];
}

// SEO Taxonomy Skill
export interface SeoTaxonomyInput {
  title: string;
  h1?: string;
  breadcrumbs?: string[];
  rawCategory?: string;
}

export interface SeoTaxonomyOutput {
  googleProductTaxonomyId?: number;
  categoryPath: string;
  confidence: number;
  isCategoryCorrectionSuggested: boolean;
}

// Section Rebuilder Skill
export interface RebuilderInput {
  scrapeResult: ScrapeResult;
  gapAnalysis: GapAnalysisResult;
  croOutput: CroPlaybookOutput;
}

export interface RebuilderOutput {
  patches: PatchOperation[];
}

// ==========================================
// 3. Skill Stubs & Registry
// ==========================================

export class CroPlaybookSkill implements ISkillHandler<CroPlaybookInput, CroPlaybookOutput> {
  readonly id = 'skill-cro-playbook';
  readonly name = 'CRO Playbook Skill';
  readonly description = 'Evaluates conversion friction and prescribes UX/trust improvements';

  async execute(input: CroPlaybookInput, _context: SkillContext): Promise<SkillResult<CroPlaybookOutput>> {
    const startTime = Date.now();
    const recommendations: CroRecommendation[] = [];

    // Evaluate friction from gapAnalysis
    for (const friction of input.gapAnalysis.conversionFriction) {
      recommendations.push({
        element: friction.type,
        ruleId: friction.id,
        recommendation: friction.description,
        impact: friction.severity === 'critical' || friction.severity === 'high' ? 'high' : 'medium',
      });
    }

    return {
      success: true,
      data: { recommendations },
      durationMs: Date.now() - startTime,
    };
  }
}

export class SeoTaxonomySkill implements ISkillHandler<SeoTaxonomyInput, SeoTaxonomyOutput> {
  readonly id = 'skill-seo-taxonomy';
  readonly name = 'SEO Taxonomy Skill';
  readonly description = 'Maps and validates products against Google Product Taxonomy';

  async execute(input: SeoTaxonomyInput, _context: SkillContext): Promise<SkillResult<SeoTaxonomyOutput>> {
    const startTime = Date.now();
    return {
      success: true,
      data: {
        categoryPath: input.rawCategory || 'General Merchandise',
        confidence: 0.9,
        isCategoryCorrectionSuggested: false,
      },
      durationMs: Date.now() - startTime,
    };
  }
}

export class SkillRegistry {
  private skills = new Map<string, ISkillHandler<unknown, unknown>>();

  register<TIn, TOut>(skill: ISkillHandler<TIn, TOut>): void {
    this.skills.set(skill.id, skill as ISkillHandler<unknown, unknown>);
  }

  get<TIn, TOut>(id: string): ISkillHandler<TIn, TOut> | undefined {
    return this.skills.get(id) as ISkillHandler<TIn, TOut> | undefined;
  }

  list(): Array<{ id: string; name: string; description: string }> {
    return Array.from(this.skills.values()).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
    }));
  }
}
