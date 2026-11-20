# Feature Flags Specification

This document defines the feature flags governing RankForge AI.
All flags are strongly typed in `packages/config/src/flags.ts` using Zod, read from environment variables (`process.env.FEATURE_<FLAG_NAME>`), and controlled at build/runtime.

## Required Feature Flags Inventory

| Flag Name | Env Variable | Type | Default | Owner Phase | Purpose | Removal Plan |
|---|---|---|---|---|---|---|
| `IMAGE_GENERATION` | `FEATURE_IMAGE_GENERATION` | `boolean` | `false` | Phase 3 | Gates Imagen 3.0 image generation API calls; requires explicit user UI consent before invocation. | Permanent safeguard; remains to allow users and tenants to opt in/out of billable generative image creation. |
| `VISUAL_CRO_AUDIT` | `FEATURE_VISUAL_CRO_AUDIT` | `boolean` | `true` | Phase 2 | Enables multimodal Gemini vision inspection of above-the-fold hero and CTA visibility from viewport screenshots. | Will become default enabled in Phase 4 once vision prompt latency budgets are validated. |
| `RUNTIME_PATCH_MODE` | `FEATURE_RUNTIME_PATCH_MODE` | `boolean` | `false` | Phase 3 | Toggles client-side MutationObserver runtime DOM patch mode for complex SPA storefronts (React/Vue/Angular) vs static AST injection. | Evaluated in Phase 4; removed once AST rehydration supports all tier-1 e-commerce frameworks. |
| `COMPLIANCE_CHECKS` | `FEATURE_COMPLIANCE_CHECKS` | `boolean` | `true` | Phase 2 | Enables automated e-commerce regulatory compliance checks (e.g. Legal Metrology, MRP, FSSAI, Country of Origin, Return/Refund rules for India). | Core capability; permanently retained with ongoing rule updates. |
| `SHARE_LINKS` | `FEATURE_SHARE_LINKS` | `boolean` | `true` | Phase 5 | Enables generation of public, read-only shareable snapshot URLs for completed audits. | Retained permanently as core collaboration feature. |
| `WORKSPACES` | `FEATURE_WORKSPACES` | `boolean` | `false` | Phase 5 | Enables multi-tenant workspace isolation, team collaboration, and organization audit history. | Fully promoted to GA in Phase 5; flag removed post Phase 6. |
| `COST_CAP_INR` | `FEATURE_COST_CAP_INR` | `number` | `25` | Phase 0 | Enforces strict per-audit hard spending cap (in Indian Rupees INR, e.g. ₹25 per run) across Gemini API, Imagen, Search Grounding, and Playwright compute. | Retained permanently as critical financial safety guardrail. |

## Implementation Guidelines

### Contract Definition (`packages/config/src/flags.ts`)
```typescript
import { z } from 'zod';

export const FeatureFlagsSchema = z.object({
  IMAGE_GENERATION: z.boolean().default(false),
  VISUAL_CRO_AUDIT: z.boolean().default(true),
  RUNTIME_PATCH_MODE: z.boolean().default(false),
  COMPLIANCE_CHECKS: z.boolean().default(true),
  SHARE_LINKS: z.boolean().default(true),
  WORKSPACES: z.boolean().default(false),
  COST_CAP_INR: z.number().positive().default(25),
});

export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;
```

### Usage Rules
1. Never bypass feature flags with hardcoded literals.
2. Every feature flag change must be accompanied by an update to this documentation and unit test coverage in `packages/config`.
3. Flags default to safe, low-cost modes when running automated tests.
