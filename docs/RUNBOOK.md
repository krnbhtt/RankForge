# Local Development Runbook

This guide contains operational instructions for setting up, running, testing, and debugging RankForge AI in local development.

---

## 1. Architecture Summary
Per **ADR-001** (`docs/DECISIONS.md`):
- **Web App (`apps/web`) & Tooling**: Runs natively on the Windows host.
- **Worker (`apps/worker`) Execution**:
  - **Mode A (Primary / Parity Target)**: Runs in Docker Desktop (WSL2 backend) for 100% Linux Chromium scraper parity with Google Cloud Run.
  - **Mode B (Native Windows Fallback)**: Runs natively on Windows Node.js with local Playwright Chromium when Docker or WSL2 is not installed or enabled.
- **Port Allocation**: Worker service is assigned to port **`4050`** (avoiding port 4000 default of Firebase Emulator Suite UI).
- **Warning**: Never run `node` or `pnpm` from inside WSL2 pointing to `/mnt/c/...` filesystems.

---

## 2. Host Toolchain Installation (Winget Sequence)

If the required development toolchains are not yet installed on your Windows machine, execute the following commands in an elevated PowerShell terminal:

### Step 1: Install Git for Windows
```powershell
winget install -e --id Git.Git
```
*Note: Restart terminal after installation so `git` is added to PATH.*

### Step 2: Install Node.js LTS (v20+)
```powershell
winget install -e --id OpenJS.NodeJS.LTS
```

### Step 3: Install pnpm
Once Node.js and npm are on PATH:
```powershell
npm install -g pnpm
```
*Alternatively: `winget install -e --id pnpm.pnpm` or `corepack enable`.*

### Step 4: Docker Desktop & WSL2 Setup Prerequisites (For Mode A)
Docker Desktop on Windows requires the `VirtualMachinePlatform` Windows feature and WSL2:
```powershell
# In an Administrative PowerShell:
wsl --install
```
*A system reboot is required after enabling Virtual Machine Platform. After reboot, launch Docker Desktop and confirm WSL2 backend is selected in Settings > General.*

---

## 3. Initial Setup

### Clone and Install
```powershell
# From project root: C:\dev\rankforge
pnpm install
```
*Note: `.npmrc` is pre-configured with `node-linker=hoisted` and `package-import-method=hardlink` to support environments without Windows Developer Mode symlink privileges.*

### Environment Configuration
Copy environment variable templates:
```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
Copy-Item apps/worker/.env.example apps/worker/.env.local
```

Key environment variables to configure:
- `PORT`: Set to `4050` for `apps/worker`.
- `WORKER_URL`: Set to `http://localhost:4050` for `apps/web`.
- `GEMINI_API_KEY`: API key for Google Gemini (`gemini-2.0-flash`, `gemini-1.5-pro`).
- `FIRESTORE_EMULATOR_HOST`: Set to `localhost:8080` for local offline development.
- `STORAGE_EMULATOR_HOST`: Set to `http://localhost:9199` for local Google Cloud Storage emulation.

---

## 4. Starting the Development Environment

### Mode A: Docker Desktop Worker (Primary Parity Target)

#### Step A1: Start Infrastructure & Worker via Docker Compose
In PowerShell:
```powershell
docker compose up -d
```
This starts:
- Firestore Emulator on `http://localhost:8080`
- Cloud Storage Emulator on `http://localhost:9199`
- `rf-worker` on `http://localhost:4050`

#### Step A2: Start Web Frontend (Windows Native)
In a separate PowerShell terminal:
```powershell
pnpm run --filter @rankforge/web dev
```
Open `http://localhost:3000` in your browser.

---

### Mode B: Native Windows Worker (Fallback / Low-Overhead)

Use this mode when Docker Desktop or WSL2 is not installed or enabled.

#### Step B1: Install Local Playwright Chromium
```powershell
# Run from repository root to install Chromium for worker
npx playwright install chromium
```

#### Step B2: Start Local Emulators (Standalone)
If using local gcloud emulators:
```powershell
gcloud emulators firestore start --host-port=127.0.0.1:8080
```

#### Step B3: Start Worker Natively on Windows
In a separate PowerShell terminal:
```powershell
pnpm run --filter @rankforge/worker dev
```
`rf-worker` starts natively on `http://localhost:4050`.

#### Step B4: Start Web Frontend (Windows Native)
In another PowerShell terminal:
```powershell
pnpm run --filter @rankforge/web dev
```
Open `http://localhost:3000` in your browser.

---

## 5. Development Workflows

### Typechecking
Run workspace-wide TypeScript typechecking:
```powershell
pnpm run typecheck
```

### Linting & Formatting
```powershell
# Check linting
pnpm run lint

# Auto-fix linting issues
pnpm run lint:fix

# Format code
pnpm run format
```

### Running Tests
RankForge maintains unit tests for schemas and scoring, plus integration tests against fixture pages:
```powershell
# Run all unit and package tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run coverage report
pnpm test:coverage
```

### Generating API Documentation
To regenerate `docs/API.md` from the Zod schemas in `packages/schema`:
```powershell
pnpm run docs:api
```

---

## 6. Troubleshooting

### Port Conflicts
- **Port `3000`**: Next.js web application (`rf-web`). If occupied, pass `-p 3001` or free port:
  ```powershell
  Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process
  ```
- **Port `4000`**: Reserved for Firebase Emulator Suite UI default. Do NOT run worker on 4000.
- **Port `4050`**: Worker HTTP task handler (`rf-worker`).
- **Port `8080`**: Firestore emulator.
- **Port `9199`**: Cloud Storage emulator.

### Docker Desktop Not Responding or Not Installed
- If Docker Desktop fails to install with error `VirtualMachinePlatform required`, switch immediately to **Mode B (Native Windows Worker)**.
- If Docker Desktop is installed, ensure WSL2 integration is active in `Settings > Resources > WSL Integration`.
- To verify Docker health:
  ```powershell
  docker info
  ```

### Non-Admin Symlink Errors with pnpm
- If `pnpm install` throws symlink privilege errors (`EPERM` / `Administrator privilege required`), verify that `.npmrc` contains `node-linker=hoisted` and `package-import-method=hardlink`.
