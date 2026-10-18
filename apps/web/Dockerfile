# ---- Budowanie ----
FROM node:26-alpine AS builder

# Node 26 nie dostarcza już corepacka, więc pnpm instalujemy globalnie przez npm.
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@10

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
RUN pnpm --filter @radio/shared run build

COPY apps/web ./apps/web
RUN pnpm --filter @radio/web run build

# ---- Serwowanie statyczne ----
FROM nginx:1.27-alpine AS runner

# Kontekst builda to korzeń repozytorium, więc ścieżki są względem niego.
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
