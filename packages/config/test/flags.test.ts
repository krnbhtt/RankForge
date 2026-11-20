import { describe, it, expect } from 'vitest';
import { loadFeatureFlags } from '../src/flags.js';

describe('FeatureFlags Engine', () => {
  it('loads default values when no environment variables are set', () => {
    const flags = loadFeatureFlags({});
    expect(flags.IMAGE_GENERATION).toBe(false);
    expect(flags.VISUAL_CRO_AUDIT).toBe(true);
    expect(flags.RUNTIME_PATCH_MODE).toBe(false);
    expect(flags.COMPLIANCE_CHECKS).toBe(true);
    expect(flags.SHARE_LINKS).toBe(true);
    expect(flags.WORKSPACES).toBe(false);
    expect(flags.COST_CAP_INR).toBe(25);
  });

  it('correctly parses environment overrides', () => {
    const flags = loadFeatureFlags({
      FEATURE_IMAGE_GENERATION: 'true',
      FEATURE_VISUAL_CRO_AUDIT: '0',
      FEATURE_RUNTIME_PATCH_MODE: 'yes',
      FEATURE_COMPLIANCE_CHECKS: 'false',
      FEATURE_SHARE_LINKS: 'off',
      FEATURE_WORKSPACES: '1',
      FEATURE_COST_CAP_INR: '50',
    });

    expect(flags.IMAGE_GENERATION).toBe(true);
    expect(flags.VISUAL_CRO_AUDIT).toBe(false);
    expect(flags.RUNTIME_PATCH_MODE).toBe(true);
    expect(flags.COMPLIANCE_CHECKS).toBe(false);
    expect(flags.SHARE_LINKS).toBe(false);
    expect(flags.WORKSPACES).toBe(true);
    expect(flags.COST_CAP_INR).toBe(50);
  });

  it('falls back to defaults on invalid numeric inputs', () => {
    const flags = loadFeatureFlags({
      FEATURE_COST_CAP_INR: 'invalid_number',
    });

    expect(flags.COST_CAP_INR).toBe(25);
  });
});
