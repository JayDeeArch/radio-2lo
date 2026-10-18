# ---- Budowanie ----
FROM node:26-alpine AS builder

# Node 26 nie dostarcza już corepacka, więc pnpm instalujemy globalnie przez npm.
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@10

WORKDIR /app

# Najpierw manifesty - warstwa zależności jest cache'owana niezależnie od kodu.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

# Shared musi być zbudowany przed API, bo API importuje z niego typy.
COPY packages/shared ./packages/shared
RUN pnpm --filter @radio/shared run build

COPY apps/api ./apps/api
RUN pnpm --filter @radio/api run build

# ---- Uruchomienie ----
FROM node:26-alpine AS runner

ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache tini

# pnpm tworzy dowiązania symboliczne, więc trzeba skopiować CAŁE drzewa node_modules
# w tej samej strukturze relatywnej - wtedy dowiązania wskazują na poprawne cele.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Użytkownik bez uprawnień - kontener nie potrzebuje roota.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
# Migracje uruchamiają się na starcie aplikacji (src/index.ts -> runMigrations).
CMD ["node", "apps/api/dist/index.js"]
