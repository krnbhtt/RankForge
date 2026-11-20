import { FeatureFlagsSchema, type FeatureFlags } from '@rankforge/schema';

function parseBooleanEnv(val: string | undefined, defaultValue: boolean): boolean {
  if (val === undefined || val === '') return defaultValue;
  const lower = val.trim().toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') return true;
  if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off') return false;
  return defaultValue;
}

function parseNumberEnv(val: string | undefined, defaultValue: number): number {
  if (val === undefined || val === '') return defaultValue;
  const parsed = Number(val);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export function loadFeatureFlags(env: Record<string, string | undefined> = process.env): FeatureFlags {
  const rawFlags = {
    IMAGE_GENERATION: parseBooleanEnv(env['FEATURE_IMAGE_GENERATION'], false),
    VISUAL_CRO_AUDIT: parseBooleanEnv(env['FEATURE_VISUAL_CRO_AUDIT'], true),
    RUNTIME_PATCH_MODE: parseBooleanEnv(env['FEATURE_RUNTIME_PATCH_MODE'], false),
    COMPLIANCE_CHECKS: parseBooleanEnv(env['FEATURE_COMPLIANCE_CHECKS'], true),
    SHARE_LINKS: parseBooleanEnv(env['FEATURE_SHARE_LINKS'], true),
    WORKSPACES: parseBooleanEnv(env['FEATURE_WORKSPACES'], false),
    COST_CAP_INR: parseNumberEnv(env['FEATURE_COST_CAP_INR'], 25),
  };

  return FeatureFlagsSchema.parse(rawFlags);
}

export const featureFlags = loadFeatureFlags();
