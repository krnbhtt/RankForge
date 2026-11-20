# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Phase 0 (kickoff). The repo contains **only docs and config** (`docs/`, `.npmrc`, `.gitattributes`); no source code, `package.json`, or git repo exists yet. `docs/STATUS.md` tracks the phase, and Prompt 1 (monorepo scaffold) awaits user approval. Host toolchains (git, node, pnpm, docker, WSL) were not installed at last audit (`docs/KNOWN_ISSUES.md`). The commands below are the *planned* ones from `docs/RUNBOOK.md`; verify they exist before relying on them.

The source of truth is `docs/rankforge-technical-documentation.md` (feature map F1–F8, architecture, scoring, build prompts 1–15, phase plan). Read the relevant section before building a feature. `docs/DECISIONS.md` holds ADRs; update `docs/CHANGELOG.md` when finishing a task.

## What RankForge is

For a product URL, it reproduces the merchant's page (own HTML/CSS/JS/images), analyses top-10 SERP competitors, then rebuilds the page section by section as an optimised visualisation. Each addition is tagged Ranking / Conversion / Both with evidence; Visibility and Conversion scores are shown before and after. Demonstration only: nothing is ever written to a merchant's store. Built for the Google Antigravity buildathon on Gemini, ADK, Cloud Run.

## Planned architecture

- pnpm monorepo: `apps/web` (Next.js App Router, Tailwind, shadcn/ui), `apps/worker` (Node 20, Playwright, Google ADK), `services/preview` (snapshot server), `packages/schema` (Zod), `packages/scoring`, `packages/skills` (runtime SKILL.md folders), `.agent/skills/` (Antigravity dev skills). Note: the tech doc says `services/worker`, but the runbook/ADR-001 say `apps/worker`; the latter reflects the newer decisions, so confirm when scaffolding.
- Three Cloud Run services in `asia-south1`: `rf-web` (public studio and REST API), `rf-worker` (private; capture, AI, patching; concurrency 1, 900 s), `rf-preview` (separate origin so store JS never runs on the studio's origin; sandboxed iframe, `noindex`).
- Job flow: `POST /api/audits` → Firestore `audits/{id}` + Cloud Task (OIDC, `dispatchDeadline` 900 s) → worker walks nine stages, writing status and results to Firestore after each. The studio only listens to Firestore in real time and never waits on the worker. Status enum is in tech doc §6.1.
- Optimised page = captured reproduction + ordered **patch ops** (`setText`, `insertAfter`, ... `injectJsonLd`) using only whitelisted CSS classes from the capture. Selectors come from `@medv/finder`. Patch mode is server or runtime (MutationObserver) depending on hydration detection.
- ADK agent graph: a root SequentialAgent with parallel discovery and analysis, and a LoopAgent over blueprint sections for the rebuild. It loads 12 SKILL.md skills. Day-one check: confirm ADK TypeScript supports SkillToolset/ParallelAgent/LoopAgent, else fall back to ADK Python for the worker.

## Invariants (from the project's rules file, tech doc §9.2)

- Every data shape is a Zod schema in `packages/schema`; add shapes there first and import them everywhere.
- All LLM calls return JSON via `responseSchema`; no free-text parsing. Temperature 0.2 for analysis, 0.7 for section writing.
- Scoring, validation, selectors and diffing are deterministic code, never LLM calls. The same scoring functions score before and after.
- Product facts (price, specs) come only from captured or platform data; the writer may not invent them. Invented reviews, badges and certifications must carry `sample: true` and a visible "Sample" label.
- Every network step has a timeout and a documented fallback. Every stage writes to Firestore before moving on.
- Secrets come from env vars bound to Secret Manager. Ask before any `gcloud` command that creates, deletes or deploys.
- Audit URLs need SSRF protection (DNS pre-resolution and IP blacklist, including metadata endpoints, on every redirect hop).
- Before finishing a task: lint, typecheck, test, update `docs/CHANGELOG.md`.

## Commands (planned; PowerShell, run from repo root)

```powershell
pnpm install
pnpm run typecheck
pnpm run lint            # lint:fix to autofix; pnpm run format
pnpm test                # vitest; test:watch, test:coverage
pnpm run docs:api        # regenerate docs/API.md from Zod schemas
pnpm run --filter @rankforge/web dev      # http://localhost:3000
pnpm run --filter @rankforge/worker dev   # http://localhost:4050
docker compose up -d     # Mode A: Firestore (8080), Storage (9199) emulators + worker (4050)
npx playwright install chromium           # Mode B only
```

Run one test file with vitest, e.g. `pnpm vitest run packages/scoring/<file>.test.ts`, once the vitest root config exists.

## Windows and environment constraints

- Develop natively on Windows in `C:\dev\rankforge`. **Never run node/pnpm from WSL2 against `/mnt/c/...`** (ADR-001).
- Worker has two modes: A (Docker Desktop + WSL2, matches Cloud Run Linux Chromium) and B (native Windows Node + local Playwright, fallback). They share code, so keep the worker free of OS-specific assumptions.
- Worker port is **4050** (4000 is the Firebase Emulator UI). Other ports: web 3000, Firestore emulator 8080, Storage emulator 9199.
- `.npmrc` (`node-linker=hoisted`, `package-import-method=hardlink`, `symlink=false`) exists because symlinks need admin on this machine; don't change it. Set `transpilePackages` in Next.js for workspace packages.
- `.gitattributes` enforces LF line endings for Docker mount parity.
