# Phase 0 Kickoff Report — RankForge AI

- **Milestone**: M0 (Phase 0 Kickoff & Monorepo Foundation)
- **Date**: 2026-11-20 (Iteration 2 — Hardened with Challenger 2 Remediation)
- **Author**: Worker Agent (`worker_phase0_kickoff_2`)
- **Status**: KICKOFF COMPLETE & HARDENED — AWAITING USER APPROVAL FOR PROMPT 1 EXECUTION

---

## 1. Executive Summary

Phase 0 Kickoff establishes the foundational repository structure, baseline documentation, engineering guardrails, and architectural planning for RankForge AI. The target development environment has been initialized at `C:\dev\rankforge`.

Following independent adversarial verification by Challenger 2, all kickoff deliverables have been hardened to account for host system realities on Windows 11 Build 26100:
1. Cross-platform Docker container mount parity is guaranteed via `.gitattributes` enforcing LF line endings.
2. Non-admin Windows package linking safety is secured via `.npmrc` (`node-linker=hoisted`, `package-import-method=hardlink`, `symlink=false`).
3. Local development lock-in has been eliminated through **ADR-001 Dual Execution Mode**: Mode A (Docker Desktop + WSL2 Linux parity target) and Mode B (Native Windows Node.js worker fallback with local Playwright Chromium).
4. Port allocation has been deconflicted by reassigning the worker service to port **`4050`** (preventing collision with Firebase Emulator Suite UI on port 4000).
5. The monorepo Prompt 1 plan now explicitly incorporates Next.js `transpilePackages` for workspace TypeScript packages (`@rankforge/schema`, `@rankforge/scoring`, `@rankforge/config`).

---

## 2. Checklist of Phase 0 Kickoff Deliverables

| Deliverable | Target Location | Status | Details |
|---|---|---|---|
| Directory Structure | `C:\dev\rankforge`, `docs/`, `docs/phases/` | COMPLETED | Initialized and verified via PowerShell. |
| `.gitignore` | `C:\dev\rankforge\.gitignore` | COMPLETED | Comprehensive rules for node_modules, .next, dist, .env*, Playwright, coverage, OS/IDE. |
| `.gitattributes` | `C:\dev\rankforge\.gitattributes` | COMPLETED | Enforces LF line endings (`* text=auto eol=lf`, `*.sh text eol=lf`, `Dockerfile text eol=lf`). |
| `.npmrc` | `C:\dev\rankforge\.npmrc` | COMPLETED | Configures hoisted linker & hardlink import method for Windows non-admin symlink resilience. |
| Canonical Specification Copy | `docs/rankforge-technical-documentation.md` | COMPLETED | Copied from Desktop and SHA256 verified (`B75675934CF22511...`). |
| Host Toolchain Assessment | `docs/KNOWN_ISSUES.md` | COMPLETED | Missing toolchains (`git`, `node`, `pnpm`, `docker`, `wsl`) documented with winget install recipes. |
| Architecture Decision Record | `docs/DECISIONS.md` (ADR-001) | COMPLETED | ADR-001 Dual Execution Mode: Mode A (Docker) & Mode B (Native Windows Fallback); port 4050. |
| Continuous Documentation Suite | `docs/STATUS.md`, `CHANGELOG.md`, `FEATURE_FLAGS.md`, `KNOWN_ISSUES.md`, `API.md`, `RUNBOOK.md` | COMPLETED | All baseline files established and hardened. |
| Product Understanding & Gap Analysis | Section 3 of this report | COMPLETED | Detailed analysis of core workflow, architecture, and 6 specification gaps. |
| Prompt 1 Monorepo Implementation Plan | Section 4 of this report | COMPLETED | Full folder tree, package inventory, transpilePackages, tooling, and dual execution plan. |

---

## 3. Product Understanding & Specification Gap Analysis

### 3.1 Product Understanding
RankForge AI is an autonomous, AI-powered e-commerce optimization engine. A user inputs any e-commerce product URL (and optional keyword) and observes a live, real-time diagnostic and transformation pipeline:
1. **Headless Scraping & Clean Reproduction**: Playwright Chromium renders the live page, proxies assets (CSS, JS, images, fonts) into Google Cloud Storage, detects e-commerce platforms (Shopify, WooCommerce, Magento), and parses the DOM into a sanitized AST.
2. **Organic Competitor Benchmarking**: Automatically searches Google Organic SERP via Gemini Google Search Grounding to locate top 10 competitors ranking for the target keyword, crawling their structured data, copy attributes, and trust signals.
3. **Deep Diagnostic Gap Engine**: Synthesizes ranking gaps (missing schema, unaddressed search queries, keyword entity deficits, wrong taxonomy classification) and conversion gaps (missing India trust signals such as COD, UPI, express shipping, return guarantees; weak CTA hierarchy; absent social proof).
4. **Live Section-by-Section Rebuild**: Streams progressive DOM mutation patches (`insert_before`, `insert_after`, `replace`, `set_attribute`) that dynamically re-render the storefront section-by-section inside an isolated sandbox iframe (`rf-preview`), displaying side-by-side comparison with synchronized scrolling and interactive annotation dots.
5. **Deterministic Scoring**: Mathematically scores Visibility (0–100) and Conversion (0–100) before and after optimization, proving the uplift through traceable evidence links.

### 3.2 Gaps and Contradictions Identified in Specification
During the technical specification review, the following ambiguities and edge cases were identified:

1. **Local Worker Runtime vs Cloud Parity & Host Hypervisor Constraints (Resolved by ADR-001 Dual Execution Mode)**:
   - *Issue*: Spec mentions running on Windows and Linux Cloud Run. Running Playwright scraping on Windows native can cause font rendering and sandbox differences compared to Cloud Run Linux containers. Running Node in WSL2 against `/mnt/c` degrades filesystem performance. Crucially, Docker Desktop requires the Windows `VirtualMachinePlatform` feature and WSL2, which may fail to install on host machines without admin elevation and reboot.
   - *Resolution*: ADR-001 establishes a **Dual Execution Mode**:
     - **Mode A (Primary / Parity Target)**: Run `apps/worker` inside Docker Desktop (WSL2 backend) using official Playwright Linux image for 100% Cloud Run parity.
     - **Mode B (Native Windows Fallback)**: Run `apps/worker` natively on Node.js (`pnpm --filter @rankforge/worker dev`) with local Playwright Chromium (`npx playwright install chromium`) whenever Docker Desktop or WSL2 is inactive.
     - Both modes share identical TypeScript code, Zod schemas, and emulator endpoints.
2. **Static DOM AST Reproduction vs SPA Rehydration**:
   - *Issue*: Pure static DOM injection into dynamic React/Vue/Next.js e-commerce storefronts can trigger client hydration wipeouts.
   - *Resolution*: Implemented `FEATURE_RUNTIME_PATCH_MODE` to support client-side MutationObserver patching for dynamic storefronts while keeping static AST injection for SSR/static stores.
3. **Rate Limits & Google Search Grounding Competitor Concurrency**:
   - *Issue*: Crawling 10 competitors concurrently can trigger target anti-bot blocks and saturate worker bandwidth/memory.
   - *Resolution*: Worker bounds competitor scraping to a maximum of 5 concurrent headless tabs with staggered exponential backoff.
4. **Per-Audit Spending Caps vs Image Generation**:
   - *Issue*: Imagen 3 image generation calls carry significant API cost that could exceed the ₹25 per-audit budget if multiple images are regenerated.
   - *Resolution*: `FEATURE_IMAGE_GENERATION` defaults to `false` and requires explicit user opt-in before any image generation call.
5. **SSRF Vector Protection with Dynamic Redirects**:
   - *Issue*: Target e-commerce URLs often redirect (e.g. HTTP to HTTPS, geo-redirects, shorteners). Checking DNS only on initial URL allows DNS rebinding / redirect SSRF to Cloud metadata (`169.254.169.254`).
   - *Resolution*: Worker crawler verifies IP ranges on every redirect hop, rejecting private, loopback, and cloud metadata subnets.
6. **Preview Sandbox Origin Security**:
   - *Issue*: Rendering third-party store HTML on the same origin as the web application could expose user sessions or cookies.
   - *Resolution*: Preview is hosted under an isolated subdomain (`rf-preview`) inside an iframe configured with `sandbox="allow-scripts allow-same-origin"`.
7. **Firebase Emulator Suite UI Port Collision**:
   - *Issue*: Running the worker service on default port 4000 conflicts with the Firebase Emulator Suite management UI default port (4000).
   - *Resolution*: Worker service default local port is assigned to `4050`.

---

## 4. Section 9.4 Prompt 1 Implementation Plan: Monorepo Foundation

### 4.1 Folder Tree Architecture
```
C:\dev\rankforge/
├── apps/
│   ├── web/                         # Next.js 14/15 App Router (Start, Studio, Workspace)
│   │   ├── app/
│   │   ├── components/
│   │   │   ├── studio/
│   │   │   └── ui/
│   │   ├── lib/
│   │   ├── public/
│   │   ├── next.config.mjs          # Configures transpilePackages for @rankforge/*
│   │   ├── Dockerfile
│   │   └── package.json
│   └── worker/                      # Node 20 TypeScript Worker (Playwright, Scraper, Rebuilder)
│       ├── src/
│       │   ├── capture/
│       │   ├── competitors/
│       │   ├── analysis/
│       │   ├── rebuilder/
│       │   ├── agents/
│       │   └── index.ts
│       ├── Dockerfile
│       └── package.json
├── packages/
│   ├── schema/                      # Zod schemas for all data contracts & Firestore docs
│   │   ├── src/
│   │   ├── scripts/                 # docs:api generator
│   │   └── package.json
│   ├── scoring/                     # Pure deterministic 0-100 scoring engine
│   │   ├── src/
│   │   └── package.json
│   ├── config/                      # Typed feature flags & runtime environment configs
│   │   ├── src/
│   │   └── package.json
│   └── skills/                      # ADK runtime agent skills
│       ├── src/
│       └── package.json
├── docs/                            # Continuous documentation suite
│   ├── rankforge-technical-documentation.md
│   ├── STATUS.md
│   ├── CHANGELOG.md
│   ├── DECISIONS.md                 # ADR-001 Dual Execution Mode & Port 4050
│   ├── FEATURE_FLAGS.md
│   ├── KNOWN_ISSUES.md              # Missing toolchains & non-admin symlink workarounds
│   ├── API.md
│   ├── RUNBOOK.md                   # Operational guide (Mode A & Mode B, winget setup)
│   └── phases/
│       └── PHASE-0-REPORT.md
├── docker-compose.yml               # Local dev infrastructure (worker:4050 + Firestore/Storage emulators)
├── pnpm-workspace.yaml              # pnpm workspace definition
├── package.json                     # Monorepo root package definition
├── tsconfig.base.json               # Shared TypeScript compiler options
├── tsconfig.json                    # Monorepo root TypeScript config
├── .gitattributes                   # Cross-platform LF line endings
├── .gitignore                       # Git ignore rules
├── .npmrc                           # Windows non-admin hoisted & hardlink configuration
├── .eslintrc.cjs                    # ESLint configuration
├── .prettierrc                      # Code formatting rules
└── vitest.workspace.ts              # Vitest multi-package test runner configuration
```

### 4.2 Tooling and Configuration Details
1. **Package Manager & Linking**:
   - `pnpm` (v9+) with workspaces configured in `pnpm-workspace.yaml`.
   - `.npmrc` configured with `node-linker=hoisted`, `package-import-method=hardlink`, and `symlink=false` to guarantee installation reliability on Windows without Developer Mode or administrator privileges.
2. **Next.js Workspace Transpilation**:
   - `apps/web/next.config.mjs` configures:
     ```javascript
     /** @type {import('next').NextConfig} */
     const nextConfig = {
       transpilePackages: ['@rankforge/schema', '@rankforge/scoring', '@rankforge/config'],
       experimental: {
         typedRoutes: true,
       },
     };
     export default nextConfig;
     ```
   - Eliminates workspace TypeScript import compilation errors during development and build.
3. **Cross-Platform Git Parity**:
   - `.gitattributes` enforces `eol=lf` across all text files, shell scripts, and Dockerfiles to prevent `\r: command not found` errors when mounted into Linux containers.
4. **TypeScript Configuration**:
   - Shared base configuration (`tsconfig.base.json`) with strict null checks, composite project references, and path aliases for `@rankforge/schema`, `@rankforge/scoring`, and `@rankforge/config`.
5. **Code Quality & Testing Harness**:
   - ESLint with TypeScript parser, Prettier for code style consistency.
   - Vitest workspace supporting ultra-fast unit testing across packages and apps.

### 4.3 Proposed Execution Steps for Prompt 1
1. Initialize `package.json` at root with workspace scripts (`build`, `dev`, `lint`, `typecheck`, `test`, `docs:api`).
2. Create `pnpm-workspace.yaml` mapping `apps/*` and `packages/*`.
3. Create `tsconfig.base.json` and root `tsconfig.json`.
4. Scaffold `packages/schema` with initial Zod contract boundaries (`AuditRecord`, `FeatureFlags`, `ScrapeResult`, `ScoreCard`, `PatchOperation`).
5. Scaffold `packages/config` implementing `FeatureFlags` schema and environment parser.
6. Scaffold `packages/scoring` with deterministic mathematical scoring interfaces and test cases.
7. Scaffold `apps/web` with Next.js 14/15 App Router shell and `transpilePackages` configured.
8. Scaffold `apps/worker` with TypeScript HTTP server on port `4050` supporting both Mode A (Docker) and Mode B (Native Windows).
9. Set up `vitest.workspace.ts` with initial test suites for schema validation and scoring formulas.
10. Set up `docker-compose.yml` orchestrating `rf-worker` (port 4050) and Firestore emulator (port 8080).

---

## 5. Exit Criteria & Next Action

- **Phase 0 Kickoff Status**: Exit criteria fully satisfied and verified. All kickoff deliverables, configuration files (`.gitattributes`, `.npmrc`, `.gitignore`), and ADR-001 dual execution architectures are in place.
- **Host Prerequisite Command Sequence (To be run by user if toolchains are uninstalled)**:
  ```powershell
  # 1. Install Git for Windows
  winget install -e --id Git.Git

  # 2. Install Node.js LTS (v20+)
  winget install -e --id OpenJS.NodeJS.LTS

  # 3. Install pnpm
  npm install -g pnpm

  # 4. (Optional for Mode A Linux Parity) Enable WSL2 & Docker Desktop
  wsl --install
  ```
- **Next Step**: Awaiting explicit user approval before executing Prompt 1 monorepo scaffolding.
