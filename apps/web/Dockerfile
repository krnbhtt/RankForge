# Stage 1: Base image
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Stage 2: Install dependencies
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml* pnpm-workspace.yaml package.json ./
COPY packages/schema/package.json ./packages/schema/
COPY packages/scoring/package.json ./packages/scoring/
COPY packages/config/package.json ./packages/config/
COPY packages/skills/package.json ./packages/skills/
COPY packages/ssrf/package.json ./packages/ssrf/
COPY packages/storage/package.json ./packages/storage/
COPY packages/audit-store/package.json ./packages/audit-store/
COPY apps/web/package.json ./apps/web/
COPY .npmrc ./

RUN pnpm install --frozen-lockfile --filter @rankforge/web...

# Stage 3: Build application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm --filter @rankforge/web build

# Stage 4: Production runner (Cloud Run target)
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
