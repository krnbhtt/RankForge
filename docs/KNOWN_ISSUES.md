# Known Issues & Environment Prerequisites

This document tracks known issues, technical risks, environment limitations, and mitigations across all phases of RankForge AI development.

## Environment Prerequisites & Host Status

### 1. Missing Host Toolchains (`git`, `node`, `pnpm`, `docker`, `wsl`)
- **Status**: OPEN (Phase 0 Audit Finding)
- **Observation**: Comprehensive system probes on Windows 11 Build 26100 confirmed that none of the core development toolchains are currently installed or present on PATH:
  - `git`: NOT FOUND IN PATH or standard installation directories (`C:\Program Files\Git`).
  - `node` / `npm`: NOT FOUND IN PATH or standard installation directories (`C:\Program Files\nodejs`).
  - `pnpm`: NOT FOUND IN PATH or standard installation directories (`%APPDATA%\npm`, `%LOCALAPPDATA%\pnpm`).
  - `docker` / `docker-compose`: NOT FOUND IN PATH.
  - `wsl`: Windows Subsystem for Linux is not installed (`wsl -l -v` reports WSL is not installed).
- **Impact**:
  - `git init` and conventional commits cannot execute until Git is installed.
  - `pnpm install`, TypeScript compilation, and monorepo scripts require Node.js LTS and pnpm.
  - Docker Desktop cannot run without WSL2 and the Virtual Machine Platform feature.
- **Remediation**:
  - Use `winget` (verified available at `%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe`) to install required tools:
    - Git: `winget install -e --id Git.Git`
    - Node.js LTS: `winget install -e --id OpenJS.NodeJS.LTS`
    - pnpm: `npm install -g pnpm` or `winget install -e --id pnpm.pnpm`
  - While host environment setup is completed, all repository configuration and documentation are fully prepared.

### 2. Docker Desktop Prerequisite Failure (`VirtualMachinePlatform`)
- **Status**: MITIGATED VIA ADR-001 DUAL EXECUTION MODE
- **Observation**: Docker installer log (`%LOCALAPPDATA%\Docker\install-log.txt`) revealed:
  ```
  [WindowsFeaturePreRequisite][E] Required Windows features are not enabled: VirtualMachinePlatform
  [InstallWorkflow][E] Prerequisite failed: Docker Desktop requires the "Virtual Machine Platform" Windows feature, which is not enabled on this machine.
  ```
- **Impact**: Docker Desktop installation fails without administrator elevation and a full system reboot to enable `VirtualMachinePlatform` / WSL2.
- **Mitigation / Workaround**:
  - Adopted **ADR-001 Mode B (Native Windows Worker Fallback)**. Developers can run `apps/worker` directly on Windows using native Node.js (`pnpm --filter @rankforge/worker dev`) and Playwright Chromium (`npx playwright install chromium`) without requiring Docker Desktop or WSL2.
  - When the developer enables `VirtualMachinePlatform` and installs Docker Desktop with WSL2, Mode A (Docker Compose) provides Linux container scraper parity.

### 3. Windows Non-Admin Symlink Limitation & Developer Mode Inactive
- **Status**: MITIGATED VIA `.npmrc`
- **Observation**: Empirical testing demonstrated that Windows Developer Mode is disabled (`AllowDevelopmentWithoutDevLicense` is null), and creating file symlinks fails with `Administrator privilege required for this operation`. Standard `pnpm` symlink strategies can fail in this environment.
- **Impact**: Package manager symlinking could fail during `pnpm install` or binary linking.
- **Mitigation / Workaround**:
  - Created `C:\dev\rankforge\.npmrc` configuring:
    ```ini
    node-linker=hoisted
    package-import-method=hardlink
    symlink=false
    ```
  - Empirical verification confirmed directory junctions and hardlinks succeed without administrator privileges, enabling safe workspace linking on Windows.

### 4. Port 4000 Conflict with Firebase Emulator Suite UI
- **Status**: RESOLVED
- **Observation**: Initial documentation assigned `rf-worker` to port `4000`. However, the Google Firebase Emulator Suite UI default port is also `4000` (`http://localhost:4000`), creating an unhandled port collision during local emulation.
- **Mitigation**: Reassigned `rf-worker` port to **`4050`** across `docs/RUNBOOK.md`, `docs/DECISIONS.md`, and `docs/phases/PHASE-0-REPORT.md`.

---

## Architectural & Technical Limitations

### 5. Anti-Bot and WAF Defenses on Target E-Commerce Sites
- **Description**: Some tier-1 e-commerce sites employ aggressive bot detection (Cloudflare Turnstile, Cloudflare Bot Management, Akamai Bot Manager, Datadome, PerimeterX).
- **Mitigation**:
  - Worker Playwright crawler implements realistic user-agent rotation, viewport configuration, and human-like scroll behavior.
  - Graceful fallback: If scraping is blocked (e.g. HTTP 403 / captcha challenge), provide the HTML-paste fallback modal (F1.3) allowing manual source ingestion without failing the audit.

### 6. Hydration Clashes on Dynamic SPA Storefronts
- **Description**: Modern headless storefronts (Next.js Commerce, Hydrogen Shopify, Nuxt) rehydrate DOM nodes. Inserting raw static HTML into the DOM before hydration can trigger React hydration mismatch errors.
- **Mitigation**:
  - In static reproduction mode, assets and scripts are sanitized and rewritten.
  - For dynamic applications, the `RUNTIME_PATCH_MODE` feature flag enables client-side MutationObserver patching applied post-hydration.

### 7. SSRF Protection Strictness
- **Description**: E-commerce audit URLs must be thoroughly validated to prevent Server-Side Request Forgery against internal Google Cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`).
- **Mitigation**: Pure DNS pre-resolution and IP blacklist validation implemented in `@rankforge/schema` and enforced at worker ingress on every HTTP redirect hop.

### 8. Docker Desktop daemon not responding (2026-11-20)
- **Status**: OPEN. `docker info` hangs on this machine, so the worker image and Linux-parity rendering are unverified.
- **Also unverified**: the worker image runs `node apps/worker/dist/index.js`, but workspace packages export TypeScript source (`main: ./src/index.ts`), so the compiled worker cannot import them. Fix when Docker works: run with `tsx` or build the packages to `dist`.

### 9. DNS rebinding window
- Chromium resolves hostnames itself, so a host that passes the SSRF check could in theory re-resolve to a private address before connecting. Mitigated by checking every request and redirect hop; full pinning would need a proxy.

### 10. Reproduction time is at the 20 s budget on heavy stores (2026-11-20)
- **Status**: OPEN. A live Allbirds page took 20 to 24 s (render about 15 s). The studio now shows the page as soon as the snapshot is stored, which is a few seconds earlier. Further options: skip the mobile render until after the preview is visible, move screenshots off the critical path.
- Store modals (for example a country picker) are captured as shown; a dismissal step is not implemented.
- Not yet verified: Firestore-backed status (the file store is still used), Docker worker image, the 90% corpus exit criterion.

### 11. Gemini key limits (2026-11-20)
- Free tier: 20 requests per day per model. Gemini 3.1 Pro and Search Grounding have no quota. The fallback chain keeps the pipeline running on Flash-class models; rate-limit errors appear in logs as "model unavailable". A billed key removes this.

### 12. Consensus entities are matched by exact normalised phrase
- Few entities reach the "4+ competitors" bar, so the entity score is often low. Fix: cluster similar phrases before counting.

### 13. Studio panels still contain Phase 0 mock content
- Schema, Category and part of the Queries panels, and the right preview pane, still use Phase 0 mock content or placeholders. They are replaced in Phase 6 (and Phase 5 for the optimised page). Scores and the Findings and Competitors tabs show real data.

### 14. Worker image
- The Docker image cannot run as written (workspace packages export TypeScript source) and could not be built here because the Docker daemon hangs.
