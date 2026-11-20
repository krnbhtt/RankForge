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

