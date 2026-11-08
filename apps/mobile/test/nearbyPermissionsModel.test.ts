import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  afterPrompt, missingPermissions, NEARBY_MIN_SDK, nearbyPermissionsFor, permissionReasonOf, permissionsStateOf, permissionStepOf, radiosOffOf,
  unavailableReasonOf, type PermissionAnswers, type PhoneFacts
} from '../src/nearby/nearbyPermissionsModel';

/**
 * What Share nearby asks of Android (src/nearby/nearbyPermissionsModel.ts; docs/nearby-sync-plan.md
 * 5.8, section 9, Carl's answers 7 and 15): by API level, what is said first, the one warning on a
 * worn phone, what a refusal means, and why the row is disabled.
 */

const ALL: PermissionAnswers = {
  ACCESS_FINE_LOCATION: 'granted', ACCESS_COARSE_LOCATION: 'granted', BLUETOOTH_SCAN: 'granted', BLUETOOTH_ADVERTISE: 'granted', BLUETOOTH_CONNECT: 'granted',
  NEARBY_WIFI_DEVICES: 'granted'
};

describe('what each Android version asks', () => {
  it('asks nothing below Android 10, location on 10 and 11, Bluetooth and location on 12, Nearby devices from 13', () => {
    expect(NEARBY_MIN_SDK).toBe(29);
    expect(nearbyPermissionsFor(28)).toEqual([]);
    expect(nearbyPermissionsFor(29)).toEqual(['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']);
    expect(nearbyPermissionsFor(30)).toEqual(['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']);
    for (const sdk of [31, 32]) expect(nearbyPermissionsFor(sdk)).toEqual(['BLUETOOTH_SCAN', 'BLUETOOTH_ADVERTISE', 'BLUETOOTH_CONNECT', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']);
    for (const sdk of [33, 34, 36]) expect(nearbyPermissionsFor(sdk)).toEqual(['BLUETOOTH_SCAN', 'BLUETOOTH_ADVERTISE', 'BLUETOOTH_CONNECT', 'NEARBY_WIFI_DEVICES']);
  });

  it('asks only what the module\'s manifest declares, within each one\'s maxSdkVersion', () => {
    const manifest = readFileSync(join(import.meta.dirname, '../modules/nearby-link/android/src/main/AndroidManifest.xml'), 'utf8');
    for (const sdk of [29, 30, 31, 32, 33, 35]) {
      for (const p of nearbyPermissionsFor(sdk)) {
        const line = new RegExp(`android\\.permission\\.${p}"([^>]*)/>`).exec(manifest);
        expect(line, p).not.toBeNull();
        const max = /maxSdkVersion="(\d+)"/.exec(line![1]!);
        if (max) expect(sdk, p).toBeLessThanOrEqual(Number(max[1]));
      }
    }
  });
});

describe('where the permissions stand', () => {
  it('is granted with everything, none below 10, and needed with something missing', () => {
    for (const sdk of [29, 31, 33]) expect(permissionsStateOf(sdk, ALL)).toBe('granted');
    expect(permissionsStateOf(28, {})).toBe('none');
    expect(permissionsStateOf(33, {})).toBe('needed');
    expect(permissionsStateOf(33, { ...ALL, NEARBY_WIFI_DEVICES: 'denied' })).toBe('needed');
    expect(missingPermissions(33, { ...ALL, NEARBY_WIFI_DEVICES: 'denied' })).toEqual(['NEARBY_WIFI_DEVICES']);
    // Location granted means nothing from 13.
    expect(permissionsStateOf(33, { ACCESS_FINE_LOCATION: 'granted', ACCESS_COARSE_LOCATION: 'granted' })).toBe('needed');
  });

  it('reads "Approximate" on 12 and 12L as asking again for precise, and nowhere else', () => {
    const approximate: PermissionAnswers = { ...ALL, ACCESS_FINE_LOCATION: 'denied' };
    expect(permissionsStateOf(31, approximate)).toBe('approximate');
    expect(permissionsStateOf(32, approximate)).toBe('approximate');
    expect(permissionReasonOf(31, 'approximate')).toBe('precise');
    expect(permissionsStateOf(30, approximate)).toBe('needed');
    expect(permissionsStateOf(31, { ...approximate, BLUETOOTH_SCAN: 'denied' })).toBe('needed');
  });

  it('reads "Don\'t ask again" as blocked, so the way is the app\'s settings', () => {
    const blocked: PermissionAnswers = { ...ALL, BLUETOOTH_SCAN: 'never_ask_again' };
    expect(permissionsStateOf(33, blocked)).toBe('blocked');
    expect(permissionReasonOf(33, 'blocked')).toBe('settings');
    expect(permissionStepOf({ sdk: 33, answers: blocked, worn: false, warned: false, firstPress: false })).toEqual({ t: 'settings' });
  });

  it('merges a prompt\'s answers over what was held', () => {
    expect(afterPrompt({ BLUETOOTH_SCAN: 'denied', BLUETOOTH_CONNECT: 'granted' }, { BLUETOOTH_SCAN: 'never_ask_again' }))
      .toEqual({ BLUETOOTH_SCAN: 'never_ask_again', BLUETOOTH_CONNECT: 'granted' });
  });
});

describe('what is said before a prompt', () => {
  it('names location on 10 and 11, both on 12, Nearby devices from 13, and nothing once granted', () => {
    expect(permissionReasonOf(29, 'needed')).toBe('location');
    expect(permissionReasonOf(30, 'needed')).toBe('location');
    expect(permissionReasonOf(32, 'needed')).toBe('nearby-and-location');
    expect(permissionReasonOf(34, 'needed')).toBe('nearby-devices');
    expect(permissionReasonOf(34, 'granted')).toBeNull();
    expect(permissionReasonOf(28, 'none')).toBeNull();
  });

  it('explains, then asks for what is missing, on a phone with no cover', () => {
    expect(permissionStepOf({ sdk: 30, answers: {}, worn: false, warned: false, firstPress: true }))
      .toEqual({ t: 'explain', reason: 'location', permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'] });
    expect(permissionStepOf({ sdk: 33, answers: ALL, worn: false, warned: false, firstPress: true })).toEqual({ t: 'ready' });
  });

  it('warns a worn phone once before any prompt, at its first press, and again at any press that would prompt', () => {
    // The first press warns even with everything granted.
    expect(permissionStepOf({ sdk: 33, answers: ALL, worn: true, warned: false, firstPress: true })).toEqual({ t: 'warn' });
    expect(permissionStepOf({ sdk: 33, answers: ALL, worn: true, warned: false, firstPress: false })).toEqual({ t: 'ready' });
    // A later press that would prompt warns again, and after it the prompt is explained.
    expect(permissionStepOf({ sdk: 33, answers: {}, worn: true, warned: false, firstPress: false })).toEqual({ t: 'warn' });
    expect(permissionStepOf({ sdk: 33, answers: {}, worn: true, warned: true, firstPress: false }))
      .toMatchObject({ t: 'explain', reason: 'nearby-devices' });
    expect(permissionStepOf({ sdk: 31, answers: { ...ALL, ACCESS_FINE_LOCATION: 'denied' }, worn: true, warned: false, firstPress: false })).toEqual({ t: 'warn' });
  });
});

describe('whether the phone can share at all', () => {
  const ok: PhoneFacts = { sdk: 33, bluetoothLe: true, directByName: true, bluetoothOn: true, wifiOn: true, locationOn: false };

  it('is disabled with a reason below Android 10, without the module, Bluetooth LE or Wi-Fi Direct', () => {
    expect(unavailableReasonOf(ok, true, 33)).toBeNull();
    expect(unavailableReasonOf(null, false, 33)).toBe('not-in-build');
    expect(unavailableReasonOf({ ...ok, sdk: 28, directByName: false }, true, 28)).toBe('android-too-old');
    // Before the module answers, the Android version alone says so.
    expect(unavailableReasonOf(null, true, 26)).toBe('android-too-old');
    expect(unavailableReasonOf(null, true, 33)).toBeNull();
    expect(unavailableReasonOf({ ...ok, bluetoothLe: false }, true, 33)).toBe('no-bluetooth-le');
    expect(unavailableReasonOf({ ...ok, directByName: false }, true, 33)).toBe('no-wifi-direct');
  });

  it('names radios that are off, and Location only on Android 10 and 11', () => {
    expect(radiosOffOf(null)).toEqual([]);
    expect(radiosOffOf(ok)).toEqual([]);
    expect(radiosOffOf({ ...ok, bluetoothOn: false, wifiOn: false })).toEqual(['bluetooth', 'wifi']);
    expect(radiosOffOf({ ...ok, sdk: 30 })).toEqual(['location']);
    expect(radiosOffOf({ ...ok, sdk: 31 })).toEqual([]);
  });
});
