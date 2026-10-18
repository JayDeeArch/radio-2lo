<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# Szkolne Radio

pnpm monorepo (Node >=22, pnpm 10). Workspaces: `apps/api`, `apps/web`, `packages/shared`.

## Commands

Root:
- `pnpm dev` — turbo run dev (api + web), requires `^build` (shared builds first).
- `pnpm build` / `pnpm typecheck` — turbo; typecheck depends on `^build`.
- `pnpm db:migrate`, `pnpm db:seed`, `pnpm spike` — delegate to `@radio/api`.
- `pnpm clean` — wipes node_modules/dist/.turbo.

Per package: `pnpm --filter @radio/<name> run <script>`.

API scripts: `dev` (tsx watch), `build` (tsc + copy-migrations.mjs), `start`, `typecheck`, `db:migrate`, `db:seed`, `spike`, `accounts`.
Web scripts: `dev` (vite), `build` (tsc -b && vite build), `preview`, `typecheck`.
Shared: `build`, `typecheck`.

## Build order quirk

`packages/shared` ships compiled output (`dist/`) consumed via `main`/`exports`. It must be built before api/web typecheck or build. Turbo encodes this via `^build`, but running a single package manually requires building shared first:
`pnpm --filter @radio/shared run build && pnpm --filter @radio/api run typecheck`.

## Migrations

- Custom runner in `apps/api/src/db/migrate.ts`: reads `src/db/migrations/*.sql`, tracks `__migrations` with SHA-256 checksums (first 16 hex). Editing an already-applied migration throws.
- Migrations run automatically on API startup (`runMigrations()` in index.ts). `pnpm db:migrate` runs the same runner directly.
- `tsc` does not copy `.sql`; `apps/api/scripts/copy-migrations.mjs` copies `src/db/migrations` → `dist/db/migrations`. The API build includes this step; running `tsc` alone leaves migrations missing.
- `MIGRATIONS_DIR` resolves relative to compiled file (`dist/db/migrate.js`), so dist layout must be preserved.

## Environment

- Copy `.env.example` → `.env`. `apps/api/src/config.ts` validates `process.env` with Zod and exits on failure. Docker compose interpolates `.env`.
- In dev without Docker, set `DATABASE_URL` to localhost Postgres and run Postgres yourself. `db` hostname only exists inside the compose network.
- Vite dev server proxies `/api` to `VITE_API_PROXY` (default `http://localhost:3000`); API listens on 3000.

## Docker dev

- Dev overlay is NOT auto-loaded (filename is `docker-compose.dev.yml`, not override). Run explicitly:
  `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`, or simpler `docker compose up -d db` then `pnpm dev`.
- Dev API mounts `apps/api/src` and `packages/shared/src` read-only and runs `node --watch --experimental-strip-types apps/api/src/index.ts`.
- Dev web runs `pnpm install`, builds shared, then `vite`.

## TypeScript / import conventions

- Base tsconfig: strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `module: NodeNext` (api/shared). Use `.js` extensions in relative imports in api/shared.
- Web uses bundler resolution (`tsconfig.app.json`), JSX transform, `noEmit`; `tsc -b` with project references.
- Shared is consumed from `dist`; typecheck after building shared.

## Architecture quick map

- `packages/shared` — Zod schemas + shared types (single source of truth for API contracts).
- `apps/api` — Fastify 5 + Drizzle + Postgres; routes in `src/routes`, services in `src/services`, Spotify client in `src/spotify`.
- `apps/web` — React 19 + Vite + Tailwind v4; nginx in prod proxies `/api` and serves SPA.
- Migrations in `apps/api/src/db/migrations`; schema in `apps/api/src/db/schema.ts`.

## Testing

No test suite exists in this repo. Verification is `pnpm typecheck` and `pnpm build` (plus `pnpm spike` for Spotify integration, requires logged-in admin). Do not invent test commands.