# Project Status: RankForge AI

## Current Phase: Phase 0 — Kickoff & Monorepo Foundation
- **Status**: PROMPT 3 JOB FLOW STUB & MOCK STUDIO UI COMPLETED & REMEDIATED (PHASE 0 EXIT CRITERION MET, 53 TESTS PASSING)
- **Last Updated**: 2026-11-20T09:30:00Z
- **Target Root**: `C:\dev\rankforge`
- **Exit Criterion**: Stub job shows every status live in the studio (VERIFIED & PASSING).

## Milestone Overview
- **M0: Phase 0 Kickoff & Monorepo Foundation**: COMPLETE (Prompt 1 Monorepo, Prompt 2 Schemas, Prompt 3 Job Flow Stub & Live Studio)
- **M1: Phase 1 Capture & DOM Reproducer**: PLANNED (Next milestone)
- **M2: Phase 2 Competitors & Gap Engine**: PLANNED
- **M3: Phase 3 Rebuilder & Scoring Engine**: PLANNED
- **M4: Phase 4 Studio UI & Annotations**: PLANNED
- **M5: Phase 5 Storage, Resumability & Queue**: PLANNED
- **M6: Phase 6 Cloud Infrastructure & CI/CD**: PLANNED
- **M7: Phase 7 Polish, Corpus Runner & Demo**: PLANNED

## Current Activity & Deliverables Summary
- **Prompt 3 Implementation Highlights**:
  1. `packages/schema/src/index.ts`:
     - Updated `AuditStatusEnum` to all 14 canonical statuses per Spec §6.1 (`queued`, `capturing`, `captured`, `awaiting_keyword`, `discovering`, `competitors`, `analysing`, `analysed`, `blueprinted`, `rebuilding`, `verifying`, `complete`, `blocked`, `failed`).
     - Updated `PatchActionEnum` per Spec §6.4 (`setText`, `setAttr`, `insertBefore`, `insertAfter`, `move`, `remove`, `setHeadMeta`, `injectJsonLd`).
     - Added ingress contracts `AuditCreateInputSchema`, `AuditCreateResponseSchema`, `RunAuditTaskInputSchema`.
     - Added Firestore subcollection schemas `AuditCompetitorSchema`, `AuditFindingSchema`, `AuditQuerySchema`, `AuditBlueprintSectionSchema`, `AuditPatchSchema`, `AuditImageSchema`, `WorkspaceSchema`, `StoreSchema`.
     - Added 18 unit tests in `packages/schema/test/schema.test.ts` (all passing).
  2. `apps/worker`:
     - Resilient dual storage in `src/store/audit-store.ts` (`IAuditStore`, with atomic `FileAuditStore` writing to `.data/audits/{auditId}.json` for robust cross-process execution without external emulator dependencies).
     - Mounted task walker route `POST /internal/tasks/run` in `src/routes/tasks.ts`: keeps HTTP connection open per Cloud Run §8.6, sequences through all 12 active lifecycle stages with sleeps, records timestamps, and writes deterministic mock scores (Visibility: 42->78, Conversion: 36->81, PPI: 39->79), 10 competitors, 6 findings, 4 query gaps, and section patches.
     - Added unit and e2e tests in `test/tasks.test.ts` and `test/e2e-stub.test.ts` (all passing).
  3. `apps/web`:
     - Web storage reader in `lib/audit-store.ts` aligned with worker storage.
     - Dual-mode task queue dispatcher in `lib/task-queue.ts` (Cloud Tasks with 900s deadline & OIDC in production, unawaited async HTTP POST fallback for local development).
     - Ingress route `POST /api/audits` with SSRF defense (validates URL scheme, resolves DNS, blocks private/loopback/cloud metadata IP ranges: 10/8, 172.16/12, 192.168/16, 127/8, 169.254.169.254, metadata.google.internal).
     - REST polling endpoint `GET /api/audits/[auditId]`.
     - Server-Sent Events (SSE) streaming route `GET /api/audits/[auditId]/stream` with 15s heartbeat.
     - Start screen (`app/page.tsx`) with URL entry, quick sample chips, validation, and primary CTA.
     - Studio screen (`app/studio/[auditId]/page.tsx`) embedding live timeline, synchronized split preview, and 6-tab drawer.
     - Real-time stepper timeline (`components/studio/timeline.tsx`) with 12-stage visualization, pulsing glow, elapsed timer, and progress bar.
     - Synced preview container (`components/studio/preview-container.tsx`) with bi-directional synchronized scrolling, mobile (375px) vs desktop (1280px) toggle, and interactive section annotation dots.
     - Collapsible right drawer (`components/studio/drawer.tsx`) auto-collapsing on viewports < 1280px per R3, with 6 tabs (Scores, Findings, Queries, Competitors, Schema, Category).
     - Live subscription hook (`hooks/use-audit-stream.ts`) supporting SSE with polling fallback.
  4. Documentation:
     - Auto-generated `docs/API.md` with complete reference.
     - Updated `docs/STATUS.md` and `docs/CHANGELOG.md`.
