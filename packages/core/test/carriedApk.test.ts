import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CARRIED_APK_PATH, carriedApkName, carriedApkNameHere, parseCarriedApkName } from '../src/carriedApk';
import { LINES_VERSION, NEARBY_PROTOCOL, REDUCER_VERSION } from '../src';

/**
 * The carried build's file name (docs/nearby-sync-plan.md 14.4): one function for the script, the
 * Worker's route and Let someone in, holding only versions, so a file in Downloads names nothing.
 */

const FP = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567';

describe('the carried build\'s file name', () => {
  it('holds the reducer, lines and protocol versions and the first 8 of the fingerprint, and nothing else', () => {
    expect(carriedApkName({ reducer: 21, lines: 1, protocol: { min: 1, max: 1 }, fingerprint: FP })).toBe('r21-l1-p1-0a1b2c3d.apk');
    expect(carriedApkName({ reducer: 22, lines: 3, protocol: { min: 1, max: 2 }, fingerprint: FP.toUpperCase() })).toBe('r22-l3-p1.2-0a1b2c3d.apk');
    expect(CARRIED_APK_PATH).toBe('/apk/');
  });

  it('changes with each version and the fingerprint, so a merge that moves any of them needs a new file', () => {
    const base = { reducer: 21, lines: 1, protocol: { min: 1, max: 1 }, fingerprint: FP };
    const names = new Set([
      carriedApkName(base), carriedApkName({ ...base, reducer: 22 }), carriedApkName({ ...base, lines: 2 }),
      carriedApkName({ ...base, protocol: { min: 1, max: 2 } }), carriedApkName({ ...base, protocol: { min: 2, max: 2 } }),
      carriedApkName({ ...base, fingerprint: `f${FP.slice(1)}` })
    ]);
    expect(names.size).toBe(6);
  });

  it('names nothing for a version that is not one or a fingerprint that is not 8 hex', () => {
    const base = { reducer: 21, lines: 1, protocol: { min: 1, max: 1 }, fingerprint: FP };
    expect(carriedApkName({ ...base, fingerprint: 'abc' })).toBeNull();
    expect(carriedApkName({ ...base, fingerprint: '../../etc/passwd' })).toBeNull();
    expect(carriedApkName({ ...base, fingerprint: '' })).toBeNull();
    expect(carriedApkName({ ...base, reducer: -1 })).toBeNull();
    expect(carriedApkName({ ...base, lines: 1.5 })).toBeNull();
    expect(carriedApkName({ ...base, protocol: { min: 2, max: 1 } })).toBeNull();
    expect(carriedApkName({ ...base, reducer: Number.NaN })).toBeNull();
  });

  it('reads back what it writes, and only that', () => {
    fc.assert(fc.property(
      fc.nat(999_999), fc.nat(999_999), fc.nat(999_990), fc.nat(5), fc.stringMatching(/^[0-9a-f]{8,40}$/),
      (reducer, lines, min, span, fingerprint) => {
        const name = carriedApkName({ reducer, lines, protocol: { min, max: min + span }, fingerprint })!;
        expect(parseCarriedApkName(name)).toEqual({ reducer, lines, protocol: { min, max: min + span }, fingerprint: fingerprint.slice(0, 8) });
      }
    ));
    for (const other of ['', 'index.html', 'r21-l1-p1-0a1b2c3d.APK', 'r21-l1-p1.1-0a1b2c3d.apk', 'r021-l1-p1-0a1b2c3d.apk', 'r21-l1-p1-0a1b2c3.apk',
      'r21-l1-p1-0a1b2c3d.apk/x', '../r21-l1-p1-0a1b2c3d.apk', 'r21-l1-p1-0A1B2C3D.apk', 'langquest-r21-l1-p1-0a1b2c3d.apk', 'current.json']) {
      expect(parseCarriedApkName(other), other).toBeNull();
    }
  });

  it('names this build\'s file from the runtime version it runs on, and nothing without one', () => {
    expect(carriedApkNameHere(FP)).toBe(carriedApkName({ reducer: REDUCER_VERSION, lines: LINES_VERSION, protocol: NEARBY_PROTOCOL, fingerprint: FP }));
    expect(carriedApkNameHere(null)).toBeNull();
    expect(carriedApkNameHere(undefined)).toBeNull();
    expect(carriedApkNameHere('1.0.0')).toBeNull();
  });
});
