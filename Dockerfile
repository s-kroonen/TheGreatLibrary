# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Dummy DB URL so `next build` (which imports lib/auth.ts at build time for
# route type-checking) doesn't fail — no query runs during build.
ENV DATABASE_URL="postgres://build:build@localhost:5432/build"
ENV BETTER_AUTH_SECRET="build-time-placeholder-secret-not-used-at-runtime"
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Full node_modules (not just the standalone trace) so drizzle-kit push
# and the backfill script can run from the entrypoint on boot — neither
# is part of the runtime trace since they're not imported by server.js.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/db ./db
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/scripts/backfill-series.ts ./scripts/backfill-series.ts
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chown -R nextjs:nodejs /app && chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/login').then(r=>{if(r.status>=500)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
