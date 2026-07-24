# =============================================================================
# HireOrbit AI — frontend image
#
# Multi-stage:
#   1. builder — vite build → dist/
#   2. runtime — nginx:alpine serving dist/, with SPA fallback to index.html
#
# Build args (so the VITE_* values get baked into the bundle):
#   --build-arg VITE_API_URL=https://hireorbitai.com/api
#
# Build from the repo root:
#   docker build -f docker/frontend.Dockerfile \
#     --build-arg VITE_API_URL=https://hireorbitai.com/api \
#     -t hireorbitai-frontend:latest .
# =============================================================================

# ---- 1. builder -------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/. .
RUN npm run build

# ---- 2. runtime -------------------------------------------------------------
FROM nginx:alpine AS runtime

# SPA fallback + long-cache hashed assets. Same shape as nginx/hireorbitai.conf.example
# but trimmed to what makes sense for a container with no reverse proxy in front.
RUN rm /etc/nginx/conf.d/default.conf
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --quiet --spider http://127.0.0.1/ || exit 1
