# Cloud Run Worker Container with Playwright Chromium & Node 20
FROM mcr.microsoft.com/playwright:v1.48.2-noble AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy dependency manifests
COPY pnpm-lock.yaml* pnpm-workspace.yaml package.json ./
COPY packages/schema/package.json ./packages/schema/
COPY packages/scoring/package.json ./packages/scoring/
COPY packages/config/package.json ./packages/config/
COPY packages/skills/package.json ./packages/skills/
COPY apps/worker/package.json ./apps/worker/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source code
COPY . .

# Build packages and worker
RUN pnpm --filter @rankforge/schema build && \
    pnpm --filter @rankforge/config build && \
    pnpm --filter @rankforge/scoring build && \
    pnpm --filter @rankforge/skills build && \
    pnpm --filter @rankforge/worker build

ENV PORT=4050
ENV NODE_ENV=production

EXPOSE 4050

CMD ["node", "apps/worker/dist/index.js"]
