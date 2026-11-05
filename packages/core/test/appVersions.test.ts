import { describe, expect, it } from 'vitest';
import { compareVersions, VERSION_PATTERN, versionParts } from '../src';

describe('app versions', () => {
  it('reads one to three numbers and nothing else', () => {
    expect(versionParts('2026.1022.1830')).toEqual([2026, 1022, 1830]);
    expect(versionParts('1.0')).toEqual([1, 0]);
    expect(versionParts('1.0.0.0')).toBeNull();
    expect(versionParts('v1')).toBeNull();
    expect(versionParts(null)).toBeNull();
    expect(VERSION_PATTERN.test('1.2.3')).toBe(true);
  });
  it('orders by number, and 1.0 is 1.0.0', () => {
    expect(compareVersions('1.9', '1.10')).toBeLessThan(0);
    expect(compareVersions('2.0', '1.99.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });
});
