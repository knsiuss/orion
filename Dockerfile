# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma
RUN pnpm run build && pnpm exec prisma generate

# ---- Runtime stage ----
FROM node:22-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Copy generated Prisma client from builder (avoids needing prisma CLI in prod)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

COPY --from=builder /app/dist ./dist

EXPOSE 18789 8080

ENV DATABASE_URL=file:/data/edith.db
VOLUME ["/data"]

CMD ["node", "dist/main.js", "--mode", "gateway"]
