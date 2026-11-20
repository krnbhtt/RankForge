# rf-worker: Playwright capture, analysis and rebuild (specification 8.4).
# The image tag must match the pinned Playwright version in apps/worker/package.json.
FROM mcr.microsoft.com/playwright:v1.65.1-noble

ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
RUN npm install -g pnpm@9.12.3

# Dependency manifests first so the install layer is cached.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/schema/package.json ./packages/schema/
COPY packages/scoring/package.json ./packages/scoring/
COPY packages/config/package.json ./packages/config/
COPY packages/skills/package.json ./packages/skills/
COPY packages/ssrf/package.json ./packages/ssrf/
COPY packages/storage/package.json ./packages/storage/
COPY packages/audit-store/package.json ./packages/audit-store/
COPY apps/worker/package.json ./apps/worker/
RUN NODE_ENV=development pnpm install --frozen-lockfile --filter @rankforge/worker...

# Workspace packages export TypeScript source, so bundle the service into one file.
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
COPY scripts/bundle.mjs ./scripts/bundle.mjs
RUN node scripts/bundle.mjs worker \
    && pnpm prune --prod --filter @rankforge/worker... || true

EXPOSE 8080
CMD ["node", "apps/worker/dist/server.js"]
