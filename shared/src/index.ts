/**
 * @hireorbitai/shared — types and constants used by BOTH backend and frontend.
 *
 * Pure TypeScript. No runtime deps. No browser-only or Node-only APIs.
 *
 * Both halves still maintain their own `types/index.ts` for legacy reasons;
 * those modules should re-export from here rather than redeclaring. Until
 * every callsite is migrated, a duplicated definition is allowed to live in
 * the half-specific file BUT must be marked `@deprecated` and pointed at
 * this module.
 */

export * from './roles';
export * from './tasks';
