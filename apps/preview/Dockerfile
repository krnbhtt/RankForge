# rf-preview: serves reproduced pages on its own origin (specification 8.1). No browser needed.
FROM node:20-slim

ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/storage/package.json ./packages/storage/
COPY apps/preview/package.json ./apps/preview/
RUN NODE_ENV=development pnpm install --frozen-lockfile --filter @rankforge/preview...

COPY tsconfig.base.json ./
COPY packages/storage ./packages/storage
COPY apps/preview ./apps/preview
COPY scripts/bundle.mjs ./scripts/bundle.mjs
RUN node scripts/bundle.mjs preview

EXPOSE 8080
USER node
CMD ["node", "apps/preview/dist/server.js"]
