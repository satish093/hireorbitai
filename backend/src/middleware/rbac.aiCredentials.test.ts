/**
 * Route-gate pin for the Claude / AI credential management endpoints.
 *
 * These routes (training.routes.ts /ai/check-token + /ai/claude-auth/*) run
 * `claude setup-token` / `claude auth login`, write backend/.env, and trigger
 * a PM2 reload. They were ADMIN_TIER (any of SUPER_ADMIN/CEO/CTO/DIRECTOR
 * could rotate the workspace's AI identity); the new gate is OWNER_TIER so
 * only SUPER_ADMIN and CEO can.
 *
 * Uses the real requireRole middleware — no controller mocking.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/db', () => ({ db: {}, pool: {} }));
vi.mock('../config/env', () => ({ env: {} }));

import { requireRole } from './auth';
import { OWNER_TIER, type Role } from '../types';

function gate(mw: ReturnType<typeof requireRole>, role: Role): number {
  let passed = false;
  try {
    mw({ user: { id: 'u', role } } as any, {} as any, () => {
      passed = true;
    });
  } catch (e) {
    return (e as { status?: number }).status ?? 0;
  }
  return passed ? 200 : 0;
}

describe('AI credential management gate — OWNER_TIER (SUPER_ADMIN + CEO) only', () => {
  const mw = requireRole(...OWNER_TIER);

  it('admits SUPER_ADMIN and CEO', () => {
    expect(gate(mw, 'SUPER_ADMIN')).toBe(200);
    expect(gate(mw, 'CEO')).toBe(200);
  });

  it('DENIES CTO and DIRECTOR — they are admin-tier but not owners', () => {
    expect(gate(mw, 'CTO')).toBe(403);
    expect(gate(mw, 'DIRECTOR')).toBe(403);
  });

  it('DENIES HR_MANAGER / MANAGER / RECRUITER / CONSULTANT / DEVELOPER', () => {
    expect(gate(mw, 'HR_MANAGER')).toBe(403);
    expect(gate(mw, 'MANAGER')).toBe(403);
    expect(gate(mw, 'RECRUITER')).toBe(403);
    expect(gate(mw, 'CONSULTANT')).toBe(403);
    expect(gate(mw, 'DEVELOPER')).toBe(403);
  });
});
