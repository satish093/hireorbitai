import { describe, it, expect } from 'vitest';
import { compareVersions, requiresUpdate, isValidVersion } from '@hireorbitai/shared';

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    // The bug this function exists to prevent: "1.10.0" < "1.9.0" as strings.
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0);
  });

  it('treats missing trailing segments as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.1', '1.2')).toBeGreaterThan(0);
  });

  it('compares equal versions as equal', () => {
    expect(compareVersions('2.3.4', '2.3.4')).toBe(0);
  });
});

describe('isValidVersion', () => {
  it('accepts dotted numerics only', () => {
    expect(isValidVersion('1')).toBe(true);
    expect(isValidVersion('1.0.0')).toBe(true);
    expect(isValidVersion('1.2.10')).toBe(true);
  });

  it('rejects store-meaningless semver extras', () => {
    // A floor of "1.2.0-rc1" could never be satisfied by a shipped build.
    expect(isValidVersion('1.2.0-rc1')).toBe(false);
    expect(isValidVersion('1.2.0+build5')).toBe(false);
    expect(isValidVersion('v1.2.0')).toBe(false);
    expect(isValidVersion('')).toBe(false);
  });
});

describe('requiresUpdate', () => {
  it('blocks a build below the floor', () => {
    expect(requiresUpdate('1.0.0', '1.1.0')).toBe(true);
    expect(requiresUpdate('1.9.0', '1.10.0')).toBe(true);
  });

  it('allows a build at or above the floor', () => {
    expect(requiresUpdate('1.1.0', '1.1.0')).toBe(false);
    expect(requiresUpdate('2.0.0', '1.1.0')).toBe(false);
  });

  // The critical property. A bad env value or an unreadable bundle version
  // must never wall off the entire install base — the only remedy would be
  // another store release, which takes days.
  it('fails open on empty or malformed input', () => {
    expect(requiresUpdate('1.0.0', '')).toBe(false);
    expect(requiresUpdate('', '1.0.0')).toBe(false);
    expect(requiresUpdate('1.0.0', 'not-a-version')).toBe(false);
    expect(requiresUpdate('garbage', '1.0.0')).toBe(false);
    expect(requiresUpdate('1.0.0', '1.2.0-rc1')).toBe(false);
  });
});
