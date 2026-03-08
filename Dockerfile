# ─── Stage 1: Node dependencies + build ──────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy manifests first for better layer caching
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source files
COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma
COPY workspace ./workspace

# Generate Prisma client and compile TypeScript via tsup
RUN pnpm exec prisma generate && pnpm run build

# ─── Stage 2: Python dependencies ────────────────────────────────────────────
FROM python:3.11-slim AS python-deps

WORKDIR /python
# Copy requirements file(s) — use a wildcard to handle requirements.txt or requirements/*.txt
COPY python/requirements*.txt ./
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || echo "No requirements.txt found, skipping"

# ─── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Install Python + pip + curl (for health check)
RUN apk add --no-cache python3 py3-pip curl

WORKDIR /app

# Create non-root user for security
RUN addgroup -S edith && adduser -S edith -G edith

# Copy Node artifacts from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/workspace ./workspace
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./

# Copy Python sidecar files
COPY python ./python

# Copy Python site-packages from python-deps stage
COPY --from=python-deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages

# Create data directories
RUN mkdir -p .edith/backups logs && chown -R edith:edith /app

USER edith

# Expose gateway port (default 18789, configurable via GATEWAY_PORT)
EXPOSE 18789

# Health check using the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:${GATEWAY_PORT:-18789}/health || exit 1

# Run migrations then start EDITH (uses compiled dist/main.js — see pnpm start)
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy --schema ./prisma/schema.prisma && node dist/main.js --mode gateway"]
