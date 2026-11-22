# Changelog

All notable changes to the RankForge project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added - deployment
- Deployed rf-web, rf-worker, rf-preview to Cloud Run (asia-south1) with Firestore, Cloud Storage, Cloud Tasks and Secret Manager; SerpApi provider support; signed worker calls from the web app; the Cloud Tasks client shipped whole in the web image.

### Added - gap closure
- Credits exception: Start-page notice and studio problem card when search or AI credits are used up, `GET /internal/quota` (never spends credits), prepared examples from earlier real runs, retry button, `pnpm exam` exits with code 2 and writes `not_run (credits)`.
- Image studio (consent-gated, labelled Sample), Workspace screen (stores grouped by hostname, no sign-in yet), Summary and Plan tabs in the studio, scroll-to-first-change in the optimised preview.
- Docker: worker and preview images build and run; `pnpm record:backup` records the backup demo video.
- Exit-test kit: `pnpm exam`, `docs/usability-test.md`, `docs/DEMO-RUNBOOK.md`, `docs/deck-updates.md`.

### Added - Phases 4 to 7 (blueprint, rebuild, studio, hardening)
- Blueprint: deterministic CRO playbook, model structure advice with a playbook fallback, deterministic arbiter with traceability and anchor verification, below-the-fold alternates.
- Rebuild: section writer, HTML sanitiser and class whitelist repair, patch applier (server mode and runtime MutationObserver mode), deterministic title, meta, alt text and structured data, verification (script errors, sideways scroll, pixels above insertion with measured noise, buy-button guard, alternate placements, click test), re-scoring with the same functions plus a score without Sample content, evidence attributions.
- Worker job flow is now the real nine-stage pipeline; all Phase 0 mock stages and mock data are deleted.
- Studio: annotation tags with pop-overs, progressive optimised preview, real Queries, Schema and Category panels, Sample marker, static-copy toggle, copy preview link, runtime preview origin.
- Capture: static copy next to the interactive one, soft-block detection, entity clustering in the consensus model.
- Hardening: rate limiter, 24-hour audit reuse, SERP cache with stale fallback, retry and resume, config fast-fail, esbuild bundles, Dockerfiles, `cloudbuild.yaml`, `docs/failures.md`.
- Fixed: preview served the optimised page without stylesheets; a verification false positive from `vh`-based layouts; a UTF-8 corruption in the drawer.

### Added - Phase 2 (competitors) and Phase 3 (analysis)
- `ai/gemini.ts`: schema-validated JSON calls (retry once with the error, then fail the stage), backoff with jitter, per-audit spend cap, a model fallback chain with cooldowns (the key has small per-model daily quotas), seeded calls.
- Competitors: SERP client (SearchAPI.io, Google redirect links resolved, widened with related searches), AI-cited source discovery (degrades gracefully without grounding quota), parallel competitor capture (5 sessions, 25 s budget, skip and backfill), competitor profiles, deterministic consensus model, batched entity extraction, keyword resolution.
- Analysis: Product schema audit, on-page audit, PageSpeed Insights with a local lab fallback, entity and query gap with code-verified claims, visual CRO audit, tone and trust, taxonomy-validated category, findings with evidence, baseline scores (unmeasured metrics rescaled, not zeroed).
- Worker job flow now runs capture, competitors and analysis for real; blueprint, rebuild and verify are still the Phase 0 stub.
- Studio: removed hard-coded demo scores, factor bars, competitors and ratings from the insights drawer; scores show "Not built yet" until the optimised page is scored.
- Corpus scripts: `scripts/corpus/phase2.ts`, `phase3.ts`.
- Reports: `docs/phases/PHASE-2-REPORT.md`, `PHASE-3-REPORT.md`.

### Added - Phase 1 / T0: Firestore audit store, corpus runner (T14), Phase 1 report (T15)
- `@rankforge/audit-store`: one `IAuditStore` with file and Firestore implementations (transactional updates, deterministic document ids, `ownerUid` for the security rules). Selected by `FIRESTORE_EMULATOR_HOST` or `AUDIT_STORE=firestore`; the worker and web app both use it. `firebase.json` and `firestore.rules` added for the local emulator.
- `pnpm corpus`: capture, offline reload, pixel diff, interaction check; writes `docs/corpus-results.csv`. See `docs/phases/PHASE-1-REPORT.md` (exit criterion not met: 12 of 18, 66.7%).
- Capture: overlay neutraliser, spec-conformant srcset parser.

### Added - Phase 1 / T10-T13: HTML paste, rf-preview, studio iframes, job-flow wiring
- `POST /api/audits/{id}/html` (blocked or failed audits only): stores the pasted HTML and re-queues; capture reuses the same pipeline.
- `apps/preview` (`rf-preview`, port 4060): serves `/preview/{auditId}/{current|optimised}/` with `X-Robots-Tag: noindex`, traversal-safe keys, a scroll-sync bridge injected at serve time.
- Studio preview rewritten: sandboxed side-by-side iframes, synchronised scroll over postMessage, desktop/mobile toggle, capture skeleton, and a blocked-page recovery card with the HTML paste form. The Phase 0 hard-coded preview mock is removed.
- Worker job flow runs the real capture stage (checkpointed, resumable, `blocked`/`failed` with typed errors); later stages are still the Phase 0 stub.
- Fixed: Next.js could not resolve NodeNext `.js` imports to `.ts` sources (`extensionAlias` added).
- Verified live against a public Shopify store: 205 assets proxied, 20 to 24 s end to end (see KNOWN_ISSUES 10).

### Added - Phase 1 / T3-T9: capture engine (`apps/worker/src/capture`, `src/extract`)
- `@rankforge/storage`: `ArtifactStorage` with local-disk and GCS adapters (`createStorageFromEnv`); keys are validated against traversal.
- `captureTarget`: Playwright Chromium render at 390 px and 1440 px, lazy-load scroll, 45 s timeout with one retry without images, `BlockedSiteError` for 401/403/429/5xx, empty bodies and bot-challenge pages, final-URL SSRF re-check.
- Tracker deny list and request rules: trackers aborted, non-GET requests to the store stubbed, other non-GET aborted, every URL passes the SSRF policy.
- Asset proxy: CSS, JS, fonts and images stored by content hash; HTML and CSS (`url()`, `@import`, `srcset`, lazy `data-*`) rewritten for offline viewing; CSP injected into the snapshot.
- Platform detection (Shopify, WooCommerce, Magento, BigCommerce, custom) and product data from `/products/{handle}.json` and the WooCommerce Store API.
- Hydration detection: framework markers plus a sentinel-edit survival test run against the offline snapshot.
- Extraction package (`extraction.json`, Zod-validated) and screenshots, written to the spec 6.2 layout. HTML-paste input uses the same pipeline.
- Playwright pinned to 1.65.1; worker Dockerfile image tag updated to match.
- Tests: 69 passing in `apps/worker`, including real-Chromium integration against a local fixture store (offline gallery and variant interaction verified).

### Added - Phase 1 / T2: extraction contracts and typed errors
- `packages/schema`: `ExtractionSchema` (v1) with platform, hydration, heading tree, JSON-LD, images, price, variants, reviews, CTA positions, design tokens, component inventory and class whitelist.
- Typed error classes (`UserInputError`, `BlockedSiteError`, `UpstreamModelError`, `QuotaError`, `PatchError`, `InternalError`) with recovery actions and `toAuditError()`.
- `PlatformTypeEnum` moved to `platform.ts` to avoid an import cycle.

### Added - Phase 1 / T1: shared SSRF guard (`packages/ssrf`)
- New `@rankforge/ssrf` package replaces the duplicated copies in `apps/web/lib` and `apps/worker/src/lib`.
- `validateTargetUrl` now checks every address a hostname resolves to, rejects URL credentials, and fails closed on DNS errors (the `example.com` / `.test` exemption is removed).
- `safeFetch` follows redirects manually and re-validates every hop; resolver and fetch are injectable for tests.
- Removed the hand-written `types/node.d.ts` and `types/react.d.ts` shims now that real type packages are installed.

### Fixed - 2026-11-20 (fix: Section 9.4 Prompt 3 Remediation - Security Hardening & UI/UX Polish)
- Security Remediation — SSRF IPv4-Mapped IPv6 Bypass (`apps/web/lib/ssrf.ts` & `apps/worker/src/lib/ssrf.ts`):
  - In `isPrivateIp`: implemented RFC 4291 §2.5.5.2 IPv4-mapped IPv6 (`::ffff:0:0/96`), RFC 6052 NAT64 (`64:ff9b::/96`), and RFC 3056 6to4 (`2002::/16`) extraction and evaluation against private/loopback/cloud-metadata checks.
  - Strictly blocked targets like `http://[::ffff:169.254.169.254]`, `http://[::ffff:127.0.0.1]`, `http://[::ffff:10.0.0.1]`, and `http://[::ffff:192.168.1.1]`.
  - Added unit test coverage in `apps/web/test/web.test.ts`.
- Security Remediation — Path Traversal & ID Validation in `FileAuditStore` & `WebAuditStore`:
  - Added `sanitizeAuditId` validating `auditId` format (`/^[a-zA-Z0-9_-]+$/`), rejecting traversal segments (`..`, `/`, `\`), and asserting resolved file path does not escape store base directory.
  - Updated `RunAuditTaskInputSchema` and `AuditRecordSchema` in `packages/schema/src/index.ts` to enforce `auditId: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/)`.
  - Added unit tests in `apps/web/test/web.test.ts`, `apps/worker/test/tasks.test.ts`, and `packages/schema/test/schema.test.ts`.
- Schema Protocol Enforcement (`packages/schema/src/index.ts`):
  - Refined `AuditCreateInputSchema` URL to enforce `http:` or `https:` protocol at the schema boundary, rejecting `javascript:`, `ftp:`, etc.
- Worker Defense-in-Depth (`apps/worker/src/routes/tasks.ts`):
  - Added SSRF validation on `POST /internal/tasks/run` for `targetUrl`.
- UI/UX Remediation — Timeline `blocked` & `failed` Handling (`components/studio/timeline.tsx`):
  - Rendered explicit `blocked` (amber badge, solid dot, description: "Site blocked crawler access — paste HTML to continue") and `failed` (red badge, solid dot, description: "Audit execution failed") without resetting stepper to step 0.
  - In `hooks/use-audit-stream.ts`: ensured polling and SSE stop immediately upon `complete`, `failed`, or `blocked`.
- UI/UX Remediation — Synthetic Review "Sample" Tag (`components/studio/preview-container.tsx`):
  - Rendered mandatory "Sample" badge next to synthetic review rating `(142 Verified Reviews)` and in customer reviews section per R3 and Spec §1.4.
- UI/UX Remediation — Evidence Attributions in Drawer (`components/studio/drawer.tsx`):
  - In Scores tab: rendered `ScoreCard.attributions` list showing additions, delta uplift (+36 Visibility, +45 Conversion), and tagged with `Ranking`, `Conversion`, or `Both`.
- UI/UX Remediation — Drawer Resize Listener & Sync Scroll:
  - Fixed resize listener in `drawer.tsx` to only auto-toggle when crossing the 1280px threshold, preserving manual user collapse on desktop.
  - Refined scroll synchronization in `preview-container.tsx` with active source lock and `requestAnimationFrame`.

### Added - 2026-11-20 (feat: Section 9.4 Prompt 3 Job Flow Stub & Mock Studio UI)
- Schema Contracts (`packages/schema`):
  - Updated `AuditStatusEnum` to canonical 14 statuses per Spec §6.1 (`queued`, `capturing`, `captured`, `awaiting_keyword`, `discovering`, `competitors`, `analysing`, `analysed`, `blueprinted`, `rebuilding`, `verifying`, `complete`, `blocked`, `failed`).
  - Updated `PatchActionEnum` per Spec §6.4 (`setText`, `setAttr`, `insertBefore`, `insertAfter`, `move`, `remove`, `setHeadMeta`, `injectJsonLd`).
  - Added ingress contracts `AuditCreateInputSchema`, `AuditCreateResponseSchema`, `RunAuditTaskInputSchema`.
  - Added Firestore subcollection schemas `AuditCompetitorSchema`, `AuditFindingSchema`, `AuditQuerySchema`, `AuditBlueprintSectionSchema`, `AuditPatchSchema`, `AuditImageSchema`, `WorkspaceSchema`, `StoreSchema`.
  - Added unit test suite in `packages/schema/test/schema.test.ts` (18 unit tests passing).
- Worker Service (`apps/worker`):
  - Storage abstraction `IAuditStore` with atomic cross-process `FileAuditStore` writing to `.data/audits/{auditId}.json`.
  - Task runner endpoint `POST /internal/tasks/run` (`apps/worker/src/routes/tasks.ts`): keeps connection open per Cloud Run §8.6, sequences through all 12 active lifecycle stages with 2-second sleeps, writes timestamps, and records deterministic mock scores (Visibility: 42->78, Conversion: 36->81, PPI: 39->79), 10 competitors, 6 findings, 4 queries, and section patches.
  - Mounted tasks router in `apps/worker/src/index.ts`.
  - Added unit tests in `apps/worker/test/tasks.test.ts` and `apps/worker/test/e2e-stub.test.ts` (all passing).
- Web Application & Studio UI (`apps/web`):
  - Storage reader in `apps/web/lib/audit-store.ts` aligned with worker storage.
  - Dual-mode task queue dispatcher in `apps/web/lib/task-queue.ts` (Cloud Tasks with 900s deadline & OIDC in production, unawaited async HTTP POST fallback for local development).
  - Ingress route `POST /api/audits` with SSRF defense (DNS resolution, private IP filtering for 10/8, 172.16/12, 192.168/16, 127/8, 169.254.169.254, metadata.google.internal).
  - REST polling route `GET /api/audits/[auditId]` and Server-Sent Events (SSE) streaming route `GET /api/audits/[auditId]/stream` with 15-second heartbeat.
  - Start screen (`app/page.tsx`) with URL input, optional keyword, quick sample chips, validation, and primary CTA.
  - Studio screen (`app/studio/[auditId]/page.tsx`) hosting live run.
  - Slim progress stepper timeline (`components/studio/timeline.tsx`) with 12-stage visualization, pulsing glow, elapsed timer, and progress bar.
  - Synced preview container (`components/studio/preview-container.tsx`) with bi-directional synchronized scrolling, mobile (375px) vs desktop (1280px) toggle, and interactive section annotation dots.
  - Collapsible 6-tab right drawer (`components/studio/drawer.tsx`) auto-collapsing on viewports < 1280px per R3 (Scores, Findings, Queries, Competitors, Schema, Category).
  - Live subscription hook (`hooks/use-audit-stream.ts`) with SSE and polling fallback.
- Continuous Documentation:
  - Auto-generated `docs/API.md` with complete reference.
  - Updated `docs/STATUS.md` reflecting Prompt 3 completion and Phase 0 exit criterion met.

### Added - 2026-11-20 (feat: Section 9.4 Prompt 1 Monorepo Scaffolding)
- Root monorepo configuration:
  - `pnpm-workspace.yaml` defining `apps/*` and `packages/*`.
  - Root `package.json` with scripts for `build`, `dev`, `dev:web`, `dev:worker`, `lint`, `typecheck`, `test` (vitest), `format`, and `docs:api`.
  - `tsconfig.base.json` and composite `tsconfig.json` with project references and path aliases.
  - `.eslintrc.cjs` and `.prettierrc` for static analysis and formatting.
  - `vitest.workspace.ts` for multi-package unit test harness.
  - `docker-compose.yml` orchestrating `rf-worker` on port 4050, Firestore emulator on port 8080, and Storage emulator on port 9199.
- Shared Packages:
  - `@rankforge/schema` (`packages/schema`): Complete canonical Zod schemas for `AuditRecord`, `ScrapeResult`, `CompetitorRecord`, `GapAnalysisResult`, `PatchOperation`, `ScoreCard`, `FeatureFlags`, error taxonomy (`AuditErrorSchema`), and worker task payloads (`ScrapeTaskInput`, `AnalyzeTaskInput`, `RebuildTaskInput`).
  - `@rankforge/scoring` (`packages/scoring`): Pure deterministic mathematical scoring logic for Visibility (`src/visibility.ts`), Conversion (`src/conversion.ts`), and Page Performance Index (`src/ppi.ts`), plus full unit test suite (`test/scoring.test.ts`).
  - `@rankforge/config` (`packages/config`): Strongly typed feature flags engine in `src/flags.ts` with environment variable readers and defaults for all 7 mandatory flags (`IMAGE_GENERATION`, `VISUAL_CRO_AUDIT`, `RUNTIME_PATCH_MODE`, `COMPLIANCE_CHECKS`, `SHARE_LINKS`, `WORKSPACES`, `COST_CAP_INR`), plus unit tests (`test/flags.test.ts`).
  - `@rankforge/skills` (`packages/skills`): ADK runtime agent skills interfaces and stubs (`CroPlaybookSkill`, `SeoTaxonomySkill`, `SkillRegistry`).
- Applications:
  - `@rankforge/web` (`apps/web`): Next.js App Router application with `transpilePackages` configured in `next.config.mjs`, Tailwind CSS, start page (`app/page.tsx`), root layout (`app/layout.tsx`), UI components (`button`, `card`, `input`), studio components (`preview-container`, `timeline`, `drawer`), and multi-stage Cloud Run `Dockerfile`.
  - `@rankforge/worker` (`apps/worker`): Express HTTP service listening on port 4050 (`src/index.ts`) with endpoints `GET /healthz`, `POST /tasks/scrape`, `POST /tasks/analyze`, `POST /tasks/rebuild`, Zod boundary validations, and Cloud Run Playwright `Dockerfile`.
- Documentation & Tooling:
  - Added automated API reference generator `packages/schema/scripts/generate-api-docs.ts` and updated `docs/API.md`.
  - Updated `docs/STATUS.md` reflecting Prompt 1 completion.

### Added - 2026-11-20 (Phase 0 Kickoff Remediation & Hardening)
- Added `.gitattributes` to enforce POSIX LF line endings (`eol=lf`) for cross-platform Docker container mount stability.
- Added `.npmrc` configuring `node-linker=hoisted`, `package-import-method=hardlink`, and `symlink=false` to ensure resilient pnpm installs on Windows without Developer Mode or administrator privileges.
- Updated `docs/DECISIONS.md` (ADR-001) defining Dual Execution Mode: Mode A (Primary / Parity Target: Docker Desktop + WSL2) and Mode B (Native Windows Fallback: Node.js + local Chromium).
- Reassigned local worker HTTP service port from `4000` to `4050` across `docs/RUNBOOK.md`, `docs/DECISIONS.md`, `docs/KNOWN_ISSUES.md`, and `docs/phases/PHASE-0-REPORT.md` to prevent collisions with Firebase Emulator Suite UI default port.
- Updated `docs/RUNBOOK.md` with step-by-step Winget toolchain installation commands and Dual Execution Mode commands (Mode A Docker vs Mode B Native Windows).
- Updated `docs/KNOWN_ISSUES.md` with complete audit of missing host toolchains, Docker Desktop `VirtualMachinePlatform` prerequisite failure, and non-admin symlink workarounds.
- Updated `docs/phases/PHASE-0-REPORT.md` incorporating ADR-001 Dual Execution Mode, `.gitattributes`, `.npmrc`, port 4050, Next.js `transpilePackages` specification in `apps/web`, and prerequisite install guides.

### Added - 2026-11-20 (Phase 0 Kickoff Initial)
- Initialized project root at `C:\dev\rankforge`.
- Established repository baseline with comprehensive `.gitignore` rules (`node_modules/`, `.next/`, `dist/`, `.env*`, Playwright caches, `coverage/`, OS/IDE artifacts).
- Copied and verified canonical technical specification to `docs/rankforge-technical-documentation.md` (SHA256: `B75675934CF22511C7B6F4CF2F5CC1A1A3AD7A6B29DA837EB333B6B577C63A43`).
- Established continuous documentation baseline in `docs/`: `STATUS.md`, `DECISIONS.md`, `FEATURE_FLAGS.md`, `KNOWN_ISSUES.md`, `API.md`, `RUNBOOK.md`, `phases/PHASE-0-REPORT.md`.
- Assessed host toolchain prerequisites.
