# DZ: base image pinned by digest; update deliberately (see docs)
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS base
WORKDIR /app
# DZ: no anonymous usage reports to Vercel during build or at runtime
ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies
FROM base AS deps
COPY package*.json ./
COPY . .
RUN npm ci --no-audit --no-fund

# Build. The clean check fails the build if any trace of the old upstream
# service (hosts, CDN links) is found in the source or in the built bundle.
FROM deps AS builder
RUN npm run build
RUN node scripts/dz-check-clean.mjs .next/static .next/server

# Production runner
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# DZ: run as the unprivileged "node" user, not root
USER node
EXPOSE 3000
CMD ["npm", "start"]
