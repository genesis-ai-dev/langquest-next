import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CARRIED_APK_PATH, CARRIED_FILE_TYPE, carriedApkName, carriedApkNameHere, carriedApkNameOf, carriedApkVersionsPart, carriedFileName, parseCarriedApkName, sameCarriedVersions } from '../src/carriedApk';
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

  it('says which phones a file fits by the start of its name, the versions without the fingerprint', () => {
    expect(carriedApkVersionsPart('r21-l1-p1-0a1b2c3d.apk')).toBe('r21-l1-p1-');
    expect(carriedApkVersionsPart('r22-l3-p1.2-0a1b2c3d.apk')).toBe('r22-l3-p1.2-');
    for (const other of ['', 'current.json', 'r21-l1-p1-0A1B2C3D.apk', 'r21-l1-p1.1-0a1b2c3d.apk']) expect(carriedApkVersionsPart(other), other).toBeNull();
    // A start is never the start of another versions' start: p1- is not p1.2-, r2- is not r21-.
    expect('r21-l1-p1.2-0a1b2c3d.apk'.startsWith(carriedApkVersionsPart('r21-l1-p1-0a1b2c3d.apk')!)).toBe(false);
    expect('r21-l1-p1-0a1b2c3d.apk'.startsWith(carriedApkVersionsPart('r2-l1-p1-0a1b2c3d.apk')!)).toBe(false);
  });

  it('counts two files as the same versions whatever their fingerprints, and any change of version as not', () => {
    fc.assert(fc.property(
      fc.nat(999), fc.nat(999), fc.nat(990), fc.nat(5), fc.stringMatching(/^[0-9a-f]{8}$/), fc.stringMatching(/^[0-9a-f]{8}$/),
      fc.constantFrom('reducer', 'lines', 'min', 'max'),
      (reducer, lines, min, span, a, b, moved) => {
        const v = { reducer, lines, protocol: { min, max: min + span } };
        const one = carriedApkName({ ...v, fingerprint: a })!;
        expect(sameCarriedVersions(one, carriedApkName({ ...v, fingerprint: b })!)).toBe(true);
        const other = moved === 'reducer' ? { ...v, reducer: reducer + 1 } : moved === 'lines' ? { ...v, lines: lines + 1 }
          : moved === 'min' ? { ...v, protocol: { min: min + span + 1, max: min + span + 1 } } : { ...v, protocol: { min, max: min + span + 1 } };
        expect(sameCarriedVersions(one, carriedApkName({ ...other, fingerprint: a })!)).toBe(false);
      }
    ));
    expect(sameCarriedVersions('current.json', 'current.json')).toBe(false);
    expect(sameCarriedVersions('r21-l1-p1-0a1b2c3d.apk', 'r21-l1-p1-0a1b2c3d (1).apk')).toBe(false);
  });

  it('names this build\'s file from the runtime version it runs on, and nothing without one', () => {
    expect(carriedApkNameHere(FP)).toBe(carriedApkName({ reducer: REDUCER_VERSION, lines: LINES_VERSION, protocol: NEARBY_PROTOCOL, fingerprint: FP }));
    expect(carriedApkNameHere(null)).toBeNull();
    expect(carriedApkNameHere(undefined)).toBeNull();
    expect(carriedApkNameHere('1.0.0')).toBeNull();
  });
});

describe('the name a carrier\'s browser downloads it under for the app', () => {
  const name = 'r21-l1-p1.2-0a1b2c3d.apk';

  it('is the same versions ending .carried, under a type that is not an install file\'s, and names nothing', () => {
    expect(carriedFileName(name)).toBe('r21-l1-p1.2-0a1b2c3d.carried');
    expect(CARRIED_FILE_TYPE).toBe('application/x-carried-build');
    expect(`${carriedFileName(name)} ${CARRIED_FILE_TYPE}`.toLowerCase()).not.toMatch(/lang|quest|frontier|next|apk|android/);
  });

  it('stands for the install file it was named from, and an install file\'s own name for itself', () => {
    expect(carriedApkNameOf(carriedFileName(name)!)).toBe(name);
    expect(carriedApkNameOf(name)).toBe(name);
  });

  it('is written only for a carried build\'s name, and read back only from one', () => {
    for (const bad of ['r21-l1-p1-0a1b2c3d.zip', 'r21-l1-p1-0A1B2C3D.apk', 'r021-l1-p1-0a1b2c3d.apk', 'notes.carried', 'r21-l1-p1-0a1b2c3d.apk.carried', 'r21-l1-p1-0a1b2c3d (1).carried', '../r21-l1-p1-0a1b2c3d.carried', '']) {
      expect(carriedFileName(bad)).toBeNull();
      if (bad !== 'r21-l1-p1-0A1B2C3D.apk') expect(carriedApkNameOf(bad)).toBeNull();
    }
  });

  it('goes there and back for every name core writes', () => {
    fc.assert(fc.property(
      fc.nat(999), fc.nat(999), fc.nat(99), fc.nat(9), fc.stringMatching(/^[0-9a-f]{8,40}$/),
      (reducer, lines, min, extra, fingerprint) => {
        const apk = carriedApkName({ reducer, lines, protocol: { min, max: min + extra }, fingerprint })!;
        expect(carriedApkNameOf(carriedFileName(apk)!)).toBe(apk);
        expect(sameCarriedVersions(carriedApkNameOf(carriedFileName(apk)!)!, apk)).toBe(true);
      }
    ));
  });
});
