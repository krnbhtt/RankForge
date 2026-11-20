# CLAUDE.md

RankForge AI: reproduces any e-commerce product page, analyses competitors, and rebuilds the page as an optimised, demonstration-only visualisation. Built for the Google DeepMind x Google Cloud Startup Buildathon India 2026; live demo, so it must work on any product URL a judge supplies.

## Where to look
- Specification (source of truth): `docs/rankforge-technical-documentation.md`. Change it only after the user approves a proposed edit.
- Status and history: `docs/STATUS.md`, `docs/CHANGELOG.md`, `docs/DECISIONS.md`, `docs/KNOWN_ISSUES.md`, `docs/FEATURE_FLAGS.md`, `docs/RUNBOOK.md`, `docs/phases/`.
- `docs/API.md` is generated from the Zod schemas (`pnpm docs:api`); never hand-edit it.

## Commands (repo root)
- `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (vitest, root config with workspace aliases).
- `pnpm dev:web` (port 3000), `pnpm dev:worker` (port 4050). Firestore emulator 8080, Storage emulator 9199.
- `.npmrc` (hoisted, hardlinks, no symlinks) exists because symlinks need admin on this machine; do not change it.

## Standing rules
- Stack: pnpm monorepo, TypeScript strict, Next.js App Router (apps/web), Node worker with Playwright and Google ADK, Zod schemas in packages/schema, shadcn/ui and Tailwind only. The worker lives in `apps/worker` (spec says `services/worker`).
- Contracts first: every data shape lives in packages/schema; validate at every boundary.
- LLM calls use responseSchema, are Zod-validated, retry once with the error, then fail the stage.
- Scoring, validation, selectors, diffing and patch application are deterministic code, never LLM calls.
- Resumable pipeline: each stage checkpoints to Firestore; idempotent writes keyed by auditId + stage.
- Every network call has a timeout, bounded retries with backoff and jitter, and a documented fallback.
- Typed errors: UserInputError, BlockedSiteError, UpstreamModelError, QuotaError, PatchError, InternalError. No empty catch blocks. Every failure reaches the UI with one plain-language recovery action.
- Security: SSRF guard on every URL (re-check after every redirect); secrets only via environment variables bound to Secret Manager; store pages render only on rf-preview in a sandboxed iframe; rate limits and per-audit spending caps.
- Structured JSON logs with auditId, stage, duration; `/healthz` on every service.
- No TODOs, commented-out code, hard-coded demo data or mock services outside tests. The Phase 0 UI mock is removed by the end of Phase 6.
- UI: three screens (Start, Studio, Workspace); one primary action per screen; calm, minimal, neutral greys with one accent, one typeface, 8 px grid, light and dark themes; skeletons, empty states, friendly errors; WCAG 2.1 AA; plain-English copy; "Sample" chip on visualisation-only content; Ranking / Conversion / Both tags on additions.
- Feature flags live in `packages/config/src/flags.ts` and are documented in `docs/FEATURE_FLAGS.md`.
- Product facts (price, specs) come only from captured or platform data. Invented reviews, badges and certifications carry `sample: true`.

## Definition of done (per task)
- Meets its spec section; lint, typecheck and tests pass, with new tests.
- Verified in the running app (browser for UI); errors, timeouts and empty states handled.
- Docs (STATUS, CHANGELOG, DECISIONS, KNOWN_ISSUES, RUNBOOK as relevant) updated in the same commit.

## Git and cloud
- Conventional commits (feat:, fix:, docs:, test:, chore:). Push after every verified task. Never commit secrets.
- Ask before any `gcloud` or `firebase` command that creates, changes, deploys or deletes resources, showing the exact command first.
- Local development: web app and tooling natively on the host; the worker runs locally in Docker (same Dockerfile as production) for Linux parity.
