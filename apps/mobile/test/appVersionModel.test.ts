import { describe, expect, it } from 'vitest';
import { compareVersions, offerFor, storeUrl, versionParts } from '../src/appVersion/appVersionModel';

// Telling people to update (appVersionModel.ts, decisions.md 154).

const ios = (version: string | null, minVersion = '0') => ({ platform: 'ios' as const, version, minVersion });

describe('versions', () => {
  it('compare as numbers, part by part', () => {
    expect(compareVersions('1.0.0', '2026.1022.1830')).toBeLessThan(0);
    expect(compareVersions('2026.1022.930', '2026.1022.1830')).toBeLessThan(0);
    expect(compareVersions('2026.1101.5', '2026.1022.1830')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });

  it('read only numbers', () => {
    expect(versionParts('1.0.0-beta')).toBeNull();
    expect(versionParts(null)).toBeNull();
  });
});

describe('what a phone shows', () => {
  it('says a new version is available on an older version, until it is dismissed', () => {
    expect(offerFor({ running: '2026.1022.1830', versions: ios('2026.1101.900'), dismissed: null })).toBe('available');
    expect(offerFor({ running: '2026.1022.1830', versions: ios('2026.1101.900'), dismissed: '2026.1101.900' })).toBe('none');
    expect(offerFor({ running: '2026.1022.1830', versions: ios('2026.1201.900'), dismissed: '2026.1101.900' })).toBe('available');
  });

  it('says nothing on the newest version or when nothing is known', () => {
    expect(offerFor({ running: '2026.1101.900', versions: ios('2026.1101.900'), dismissed: null })).toBe('none');
    expect(offerFor({ running: '2026.1101.900', versions: ios(null), dismissed: null })).toBe('none');
    expect(offerFor({ running: '2026.1101.900', versions: null, dismissed: null })).toBe('none');
  });

  it('requires an update below the minimum, dismissed or not', () => {
    expect(offerFor({ running: '1.0.0', versions: ios('2026.1101.900', '2026.1022.1830'), dismissed: '2026.1101.900' })).toBe('required');
    expect(offerFor({ running: '2026.1022.1830', versions: ios('2026.1101.900', '2026.1022.1830'), dismissed: null })).toBe('available');
  });

  it('never stops a version that it cannot read', () => {
    expect(offerFor({ running: null, versions: ios('2026.1101.900', '9999'), dismissed: null })).toBe('none');
  });
});

describe('the Update button', () => {
  it('opens the app\'s own store page', () => {
    expect(storeUrl('ios')).toBe('https://apps.apple.com/app/id6812492008');
    expect(storeUrl('android')).toBe('https://play.google.com/store/apps/details?id=com.frontierrnd.langquestnext');
  });
});

describe('the server rows and the saved answer', () => {
  it('picks this platform\'s row and renames min_version', async () => {
    const { versionsFromRows } = await import('../src/appVersion/appVersionModel');
    const rows = [{ platform: 'android', version: '2.0.0', min_version: '1.0.0' }, { platform: 'ios', version: null, min_version: '1.5.0' }];
    expect(versionsFromRows(rows, 'ios')).toEqual({ platform: 'ios', version: null, minVersion: '1.5.0' });
    expect(versionsFromRows(rows, 'android')).toEqual({ platform: 'android', version: '2.0.0', minVersion: '1.0.0' });
    expect(versionsFromRows([], 'ios')).toBeNull();
    expect(versionsFromRows(null, 'ios')).toBeNull();
    expect(versionsFromRows([{ platform: 'ios', version: '1' }], 'ios')).toBeNull();
  });

  it('asks at most once an hour', async () => {
    const { dueToAsk, ASK_EVERY_MS } = await import('../src/appVersion/appVersionModel');
    expect(dueToAsk(0, Date.now())).toBe(true);
    expect(dueToAsk(1000, 1000 + ASK_EVERY_MS - 1)).toBe(false);
    expect(dueToAsk(1000, 1000 + ASK_EVERY_MS)).toBe(true);
  });

  it('trusts a saved answer only when it has the shape that was saved', async () => {
    const { parseCachedVersions } = await import('../src/appVersion/appVersionModel');
    const good = { platform: 'ios', version: '2.0.0', minVersion: '1.0.0' };
    expect(parseCachedVersions(JSON.stringify({ versions: good }))).toEqual(good);
    expect(parseCachedVersions(null)).toBeNull();
    expect(parseCachedVersions('not json')).toBeNull();
    expect(parseCachedVersions('{"versions":null}')).toBeNull();
    expect(parseCachedVersions(JSON.stringify({ versions: { platform: 'web', version: null, minVersion: '1' } }))).toBeNull();
    expect(parseCachedVersions(JSON.stringify({ versions: { platform: 'ios', version: 3, minVersion: '1' } }))).toBeNull();
  });
});
