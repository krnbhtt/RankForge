# Architecture Decision Records (ADRs)

## ADR-001: Local Development Architecture — Windows Native Web + Docker Desktop Worker with Native Windows Fallback

### Status
Accepted (Amended to include Dual Execution Mode)

### Date
2026-11-20 (Amended 2026-11-20)

### Context
RankForge AI consists of multiple services:
1. `rf-web`: Next.js 14/15 frontend and web UI.
2. `rf-worker`: Node 20 Playwright scraper, crawler, AST reproducer, Gemini agent coordinators, and rebuild patch pipeline.
3. Supporting services: Google Cloud Firestore emulator, Google Cloud Storage emulator or dev bucket, and sandbox preview.

The developer host OS is Windows 11. Cross-OS development between Windows host filesystems (`C:\dev\rankforge`) and WSL2 presents known severe I/O performance penalties (9P filesystem bridge overhead when running Node/npm inside WSL2 pointing to `/mnt/c/...`), watcher latency, and file locking issues. Conversely, Playwright headless Chromium on Windows differs subtly in font rendering, font metrics, and Linux sandbox flags compared to Cloud Run Linux containers. Furthermore, Docker Desktop requires WSL2 and the Windows `VirtualMachinePlatform` feature; on host machines where hypervisor virtualization or WSL2 cannot be immediately provisioned, a rigid container-only requirement would block development entirely.

### Decision
1. **Frontend & Tooling**: Run `rf-web` (`apps/web`), TypeScript tooling, package managers (pnpm), linters, and formatters natively on Windows (`C:\dev\rankforge`).
2. **No WSL2 Node across `/mnt/c`**: Strictly prohibit running Node.js or pnpm from inside WSL2 against `/mnt/c/...` paths to eliminate 9P filesystem bridge latency and locking hazards.
3. **Dual Execution Mode for Local Worker (`rf-worker`)**:
   - **Mode A (Primary / Parity Target — Docker Desktop + WSL2)**:
     - Run `rf-worker` (`apps/worker`) locally inside Docker Desktop using the WSL2 container engine, executing the official Playwright Linux image / production Dockerfile.
     - Guarantees 100% parity with Google Cloud Run in Linux Chromium rendering, font packages, and memory limits.
     - Orchestrated alongside Firestore and Storage emulators via root `docker-compose.yml`.
   - **Mode B (Native Windows Fallback — Node.js + Local Playwright)**:
     - Run `rf-worker` natively on Windows (`pnpm --filter @rankforge/worker dev`) using local Node.js and Playwright Chromium (`npx playwright install chromium`).
     - Activates whenever Docker Desktop or WSL2 is not installed, cannot be enabled due to missing hypervisor/VirtualMachinePlatform prerequisites, or during offline/low-overhead development.
     - Both Mode A and Mode B share identical TypeScript source code, Zod contracts (`@rankforge/schema`), scoring math (`@rankforge/scoring`), and environment variable bindings.
4. **Local Dev Composition & Networking**:
   - Primary: Root `docker-compose.yml` orchestrates `rf-worker` on port `4050`, Firestore emulator on port `8080`, and Storage emulator on port `9199`.
   - Fallback: Standalone local emulators via Google Cloud CLI (`gcloud emulators firestore start --host-port=127.0.0.1:8080`) with `rf-worker` bound natively to `http://localhost:4050`.
5. **Port Allocation**: Worker service is bound to port `4050` (relocated from 4000 to prevent port conflicts with Firebase Emulator Suite UI which defaults to 4000).

### Consequences
- **Positive**:
  - High resilience: Developers can build and run `rf-worker` immediately without being blocked by virtualization, admin privileges, or Docker installation failures.
  - Blazing fast Next.js compilation and hot-reloading on Windows native filesystem.
  - Zero 9P filesystem bridge overhead or file-locking conflicts.
  - When Mode A is active, guarantees 100% fidelity between local worker Playwright scrapers and Cloud Run production environments.
  - Clean separation of ports with no Firebase Emulator Suite UI collision on port 4000.
- **Negative / Operational Needs**:
  - In Mode B, minor font rendering differences may exist between Windows Chromium and Linux Chromium (mitigated by explicit web-font downloading and deterministic DOM AST normalization).
  - Developers need local Node.js (v20+) and pnpm installed on Windows host, plus Playwright Chromium binaries (`npx playwright install chromium`) if operating in Mode B.

## ADR-002: Phase 1 capture design choices

### Status
Accepted (2026-11-20)

### Decisions
1. **Worker location stays `apps/worker`** (the specification says `services/worker`); the preview service will live in `apps/preview`. The specification edit is proposed, not applied.
2. **Snapshot source:** the rendered DOM (`page.content()` after scrolling) is the snapshot, with non-tracker scripts kept and rewritten to local copies so the gallery and variant selector keep working. A CSP in the snapshot allows only same-origin scripts and connections.
3. **Selectors:** the layout script generates unique CSS selectors in-page. `@medv/finder` is installed but not used yet; it can be bundled for the patch stage if needed.
4. **Browser-side code is plain strings** (`layout-script.ts`) so a build tool cannot inject helper references into the page context.
5. **Hydration mode** is decided empirically: sentinel edits are placed in the snapshot HTML before scripts run and checked after load; framework markers are only the fallback.
6. **Storage:** local-disk adapter by default, GCS when `BUCKET` is set (emulator via `STORAGE_EMULATOR_HOST`).

## ADR-003: Model access, fallbacks and measurement choices (Phases 2 and 3)

### Status
Accepted (2026-11-20)

### Context
The supplied Gemini key is on the free tier: 20 requests per day per model, no quota for Gemini 3.1 Pro or Search Grounding, and PageSpeed Insights rejects API keys. The Cloud Natural Language API has no credentials.

### Decisions
1. **Model fallback chain** per role with a 30-minute cooldown for models that are out of quota, so one exhausted model does not slow every call. Pro-role calls fall back to Flash-class models. Spend is estimated from token counts and capped per audit (`COST_CAP_INR`).
2. **Grounding unavailable is not fatal:** AI-cited sources are skipped and the studio is told why.
3. **Core Web Vitals** come from PageSpeed Insights when available, otherwise from our own mobile Chromium (lab, unthrottled). A metric that cannot be measured is excluded and the score rescaled.
4. **Model claims are verified in code** before they affect scores (entities by word match, answers by quote match). Analysis calls use temperature 0 and a seed.
5. **The question journey is fixed to SERP questions** so the score cannot move with invented questions.
6. **Capture hides pop-ups** (overlay neutraliser) so snapshots and diffs show the product, not a transient modal.

### Consequences
Quality is below the specification's intent where Pro-tier or NL API models were specified. With a billed key and a PageSpeed credential the same code uses them without changes (set `GEMINI_MODEL_PRO`, `PSI_API_KEY`).

## ADR-004: Blueprint, rebuild and scoring choices (Phases 4 and 5)

### Status
Accepted (2026-11-20)

### Decisions
1. **The arbiter is code, not a model.** Its job is to enforce rules (traceability, anchors that exist, one section per type, limits) and to record decisions; a model would add cost and variance without adding checks. The structure advice stays a model call.
2. **The model never applies patches.** It writes HTML for one section; code sanitises it, checks classes, builds the operation, verifies the selector and applies it.
3. **Sample content counts toward the after score but is always shown separately** (spec 7.4): the score without it is stored in `report.json` and displayed.
4. **Verification guards what the score cannot see:** a section is dropped if it pushes the mobile buy button below the fold, adds script errors, scrolls the page sideways or changes the pixels above it beyond the measured noise. Alternate placements are tried before a section is dropped.
5. **Entity coverage and answered questions are measured by deterministic text matching** for both the before and after scores. The model supplies the order and quoted evidence for display only.
6. **A static copy of the reproduction** (scripts removed) is stored with the interactive one for pages whose scripts change the layout; the studio offers it as a toggle.
7. **Retry resumes** from artifacts already written, so a worker that dies mid-audit does not repeat paid steps.
