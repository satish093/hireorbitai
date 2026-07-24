# @hireorbitai/shared

Types and constants used by **both** halves of the monorepo. Pure TS, no runtime deps.

This is a real npm workspace package — `backend` and `frontend` consume it as `@hireorbitai/shared`. Edits flow automatically into both halves; no copy-paste, no drift.

## What lives here

- [`src/roles.ts`](src/roles.ts) — `Role` enum, tier helpers (`OWNER_TIER` / `ADMIN_TIER` / `MANAGER_TIER` / `OPERATOR_TIER` / `ALL_ROLES`), `isAdmin`, `isManagerOrUp`.
- [`src/tasks.ts`](src/tasks.ts) — `TaskStatus`, `TaskPriority`, and their constant arrays.

## What does NOT belong here

- Anything that imports a Node-only or browser-only API (`fs`, `express`, `react`, etc.).
- Anything that needs a database, network, or filesystem.
- UI capitalisation maps (`ROLE_LABEL`, `TASK_STATUS_LABEL`) — those live in `frontend/src/types/index.ts` where the visual style decisions are.

The bar for adding to `shared/` is "if the two halves disagree on this, we'll ship a bug".

## How to consume

```ts
// backend/src/types/index.ts and frontend/src/types/index.ts
export * from '@hireorbitai/shared';
import type { Role } from '@hireorbitai/shared';
```

The rest of the codebase keeps importing from `./types` / `../types` exactly as before — `types/index.ts` is the seam.

## Workflow

```bash
# Edit src/*.ts in this directory.
npm run shared:build          # from repo root — compiles to shared/dist
# Backend + frontend pick the change up on their next typecheck/build.

# CI runs `npm ci && npm run shared:build` before each half's build step;
# see .github/workflows/ci.yml.
```

For local dev with hot reload, backend's `tsx --watch` and frontend's Vite both follow the symlink npm puts at `node_modules/@hireorbitai/shared` → `shared/`. After editing `shared/src/*.ts`:

- Backend: a single `npm run shared:build` makes the new types visible to the next `tsc` pass. (No restart needed if you're using `tsx --watch` — the require cache reloads.)
- Frontend: Vite watches the symlink target; HMR fires within seconds.

## Why workspaces and not project references?

Considered: tsconfig project references with `composite: true`. Workspaces won because:

1. npm already understands workspaces natively — zero extra tooling.
2. `node dist/server.js` resolves `@hireorbitai/shared` through `node_modules` the way any other dep would, with no path-mapping loader.
3. Frontend's Vite resolves the symlink without extra config.
4. The shared package can grow to include runtime utilities (not just types) without changing the import shape.
