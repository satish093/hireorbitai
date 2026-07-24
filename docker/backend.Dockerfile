# =============================================================================
# HireOrbit AI — backend image
#
# Multi-stage:
#   1. deps    — install full dep tree (incl. devDeps) for the build
#   2. builder — tsc → dist/
#   3. runtime — slim image with only prod deps + the compiled output
#
# Build from the repo root:
#   docker build -f docker/backend.Dockerfile -t hireorbitai-backend:latest .
# =============================================================================

# ---- 1. deps ----------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# ---- 2. builder -------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/. .
RUN npm run build

# ---- 3. runtime -------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Re-install production deps only — keeps the final image small.
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY backend/scripts ./scripts

# Non-root runtime user.
RUN addgroup -S hireorbit && adduser -S hireorbit -G hireorbit \
 && mkdir -p /var/lib/hireorbitai/uploads \
 && chown -R hireorbit:hireorbit /var/lib/hireorbitai
USER hireorbit

EXPOSE 4000

# Liveness probe — Docker / Kubernetes / Compose all read this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:4000/healthz || exit 1

CMD ["node", "dist/server.js"]
