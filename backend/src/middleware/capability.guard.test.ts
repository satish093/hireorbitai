import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/db', () => ({ db: {}, pool: {} }));
vi.mock('../config/env', () => ({ env: {} }));

import { hasCapability, requireRole, requireRoleOrCapability } from './auth';
import { MANAGER_TIER } from '../types';

function statusOf(middleware: ReturnType<typeof requireRole>, user: any): number {
  let passed = false;
  try {
    middleware({ user } as any, {} as any, () => {
      passed = true;
    });
  } catch (error) {
    return (error as { status?: number }).status ?? 0;
  }
  return passed ? 200 : 0;
}

describe('capability guards', () => {
  it('keeps admin capabilities developer-only', () => {
    expect(hasCapability({ role: 'DEVELOPER', capabilities: ['reports'] }, 'reports')).toBe(true);
    expect(hasCapability({ role: 'RECRUITER', capabilities: ['reports'] }, 'reports')).toBe(false);
    expect(hasCapability({ role: 'MANAGER', capabilities: ['users'] }, 'users')).toBe(false);
  });

  it('admits tier roles or a developer with the matching admin capability', () => {
    const gate = requireRoleOrCapability(MANAGER_TIER, 'reports');
    expect(statusOf(gate, { role: 'MANAGER' })).toBe(200);
    expect(statusOf(gate, { role: 'DEVELOPER', capabilities: ['reports'] })).toBe(200);
    expect(statusOf(gate, { role: 'DEVELOPER', capabilities: [] })).toBe(403);
  });

  it('invoice role gate ignores stale capability arrays', () => {
    const gate = requireRole(...MANAGER_TIER);
    expect(statusOf(gate, { role: 'MANAGER' })).toBe(200);
    expect(statusOf(gate, { role: 'DIRECTOR' })).toBe(200);
    expect(statusOf(gate, { role: 'RECRUITER', capabilities: ['invoices'] })).toBe(403);
    expect(statusOf(gate, { role: 'CONSULTANT', capabilities: ['invoices'] })).toBe(403);
    expect(statusOf(gate, { role: 'DEVELOPER', capabilities: ['invoices'] })).toBe(403);
  });
});
