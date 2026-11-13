import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NEARBY_DROP_CODES, NEARBY_NATIVE_CODES } from '../modules/nearby-link/src/codes';

/**
 * Text guards over the nearby module's Kotlin (docs/nearby-sync-plan.md section 8, Native, and
 * section 9). Nothing compiles Kotlin on a developer's machine, and the `android-native` job
 * compiles it only when the module changes, so the rules that keep a phone safe are held here on
 * every run: nothing logged, nothing fixed in an advert, no Google Play services, every
 * permission used declared and none past the plan's list, API 29 classes kept off a phone below
 * Android 10, and the JavaScript face equal to the Kotlin.
 */

const MODULE = 'apps/mobile/modules/nearby-link';
const KOTLIN = `${MODULE}/android/src/main/java/expo/modules/nearbylink`;
const MANIFEST = `${MODULE}/android/src/main/AndroidManifest.xml`;

const kotlinFiles = readdirSync(KOTLIN).filter((f) => f.endsWith('.kt'));
const kotlin = new Map(kotlinFiles.map((f) => [f, readFileSync(join(KOTLIN, f), 'utf8')]));
const allKotlin = [...kotlin.values()].join('\n');
/** Code without comments, so a rule reads what runs. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const kotlinCode = code(allKotlin);
const manifest = readFileSync(MANIFEST, 'utf8');
const manifestCode = manifest.replace(/<!--[\s\S]*?-->/g, '');
const ts = readFileSync(`${MODULE}/src/NearbyLinkModule.ts`, 'utf8');
const moduleKt = code(kotlin.get('NearbyLinkModule.kt')!);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const declared = new Map([...manifestCode.matchAll(/<uses-permission\s+([^>]*?)\/>/g)].map((m) => {
  const name = /android:name="([^"]+)"/.exec(m[1]!)![1]!;
  return [name.replace('android.permission.', ''), m[1]!] as const;
}));

describe('the nearby module logs nothing and puts nothing fixed in the air', () => {
  it('never logs: no Log, println or stack trace that could print a key', () => {
    expect(kotlinCode).not.toMatch(/\bLog\.[a-z]+\(/);
    expect(kotlinCode).not.toMatch(/import android\.util\.Log\b/);
    expect(kotlinCode).not.toMatch(/\bprintln\(|printStackTrace\(|System\.(out|err)\./);
  });

  it('advertises only UUIDs worked out from kFind and a salt, with no name, power, manufacturer or service data', () => {
    const uuids = [...kotlinCode.matchAll(/addServiceUuid\(([^\n]*)\)/g)].map((m) => m[1]!);
    expect(uuids.length).toBeGreaterThan(0);
    for (const u of uuids) expect(u).toMatch(/FindCodec\.uuidOf\(FindCodec\.(advertId|scanResponse)\(/);
    expect(kotlinCode).not.toMatch(/addManufacturerData|addServiceData|addServiceSolicitationUuid|addTransportDiscoveryData/);
    expect(kotlinCode).not.toMatch(/setIncludeDeviceName\(true\)|setIncludeTxPowerLevel\(true\)/);
    expect([...kotlinCode.matchAll(/setIncludeDeviceName\(false\)/g)].length).toBeGreaterThanOrEqual(2);
    // The phone's own Bluetooth name stays as it is (5.12, "The phone's own names").
    expect(kotlinCode).not.toMatch(/\.setName\(|\.name\s*=/);
  });

  it('names no fixed UUID but the standard notification descriptor, and no app name', () => {
    const fixed = [...kotlinCode.matchAll(/UUID\.fromString\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(fixed).toEqual(['00002902-0000-1000-8000-00805f9b34fb']);
    // Nor one written as hex or as two longs.
    expect(kotlinCode.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)).toEqual(['00002902-0000-1000-8000-00805f9b34fb']);
    expect(kotlinCode).not.toMatch(/UUID\(\s*-?\d|ParcelUuid\.fromString/);
    for (const name of ['LangQuest', 'langquest', 'frontierrnd', 'nearby-sync']) expect(code(allKotlin.replace(/^package .*$/m, '')).toLowerCase()).not.toContain(name.toLowerCase());
    // A group's name is chosen in JavaScript in Android's usual form; Kotlin makes none.
    expect(kotlinCode).not.toMatch(/"DIRECT-/);
  });

  it('never makes a persistent group, which would keep the device address', () => {
    expect(kotlinCode).toMatch(/enablePersistentMode\(false\)/);
    expect(kotlinCode).not.toMatch(/enablePersistentMode\(true\)/);
    // The calls that need Location Mode are never made.
    expect(kotlinCode).not.toMatch(/discoverPeers|discoverServices\(channel|requestPeers|addLocalService/);
  });
});

describe('the nearby module needs nothing from Google', () => {
  it('imports no Google Play services, in the Kotlin or the build', () => {
    expect(allKotlin).not.toMatch(/com\.google\.android\.(gms|play)/);
    expect(readFileSync(`${MODULE}/android/build.gradle`, 'utf8')).not.toMatch(/com\.google\.android\.(gms|play)|play-services/);
  });

  it('adds no runtime dependency the app does not already carry', () => {
    const gradle = code(readFileSync(`${MODULE}/android/build.gradle`, 'utf8'));
    const runtime = [...gradle.matchAll(/^\s*(implementation|api)\s+'([^']+)'/gm)].map((m) => m[2]);
    expect(runtime).toEqual(['androidx.annotation:annotation:1.9.1']);
    // And expo-modules-core already brings that one.
    expect(readFileSync('node_modules/expo-modules-core/android/build.gradle', 'utf8')).toContain("'androidx.annotation:annotation:1.9.1'");
  });
});

describe('the nearby module\'s permissions', () => {
  it('are the plan\'s list, by API level, and nothing else (section 9)', () => {
    expect(Object.fromEntries([...declared].map(([n, attrs]) => [n, (/android:(maxSdkVersion|usesPermissionFlags)="([^"]+)"/.exec(attrs) ?? []).slice(1).join('=')]))).toEqual({
      BLUETOOTH: 'maxSdkVersion=30',
      BLUETOOTH_ADMIN: 'maxSdkVersion=30',
      BLUETOOTH_SCAN: 'usesPermissionFlags=neverForLocation',
      BLUETOOTH_ADVERTISE: '',
      BLUETOOTH_CONNECT: '',
      ACCESS_FINE_LOCATION: 'maxSdkVersion=32',
      ACCESS_COARSE_LOCATION: 'maxSdkVersion=32',
      ACCESS_WIFI_STATE: '',
      CHANGE_WIFI_STATE: '',
      CHANGE_NETWORK_STATE: '',
      ACCESS_NETWORK_STATE: '',
      NEARBY_WIFI_DEVICES: 'usesPermissionFlags=neverForLocation'
    });
    for (const never of ['ACCESS_LOCAL_NETWORK', 'FOREGROUND_SERVICE', 'REQUEST_INSTALL_PACKAGES', 'ACCESS_BACKGROUND_LOCATION']) expect(manifestCode).not.toContain(never);
  });

  it('declare every permission the Kotlin uses', () => {
    const needs: [RegExp, string[]][] = [
      [/\.startScan\(/, ['BLUETOOTH_SCAN', 'ACCESS_FINE_LOCATION', 'BLUETOOTH_ADMIN']],
      [/startAdvertisingSet\(/, ['BLUETOOTH_ADVERTISE', 'BLUETOOTH_ADMIN']],
      [/connectGatt\(|openGattServer\(/, ['BLUETOOTH_CONNECT', 'BLUETOOTH']],
      [/\.createGroup\(|\.connect\(channel/, ['NEARBY_WIFI_DEVICES', 'ACCESS_FINE_LOCATION', 'CHANGE_WIFI_STATE', 'ACCESS_WIFI_STATE']],
      [/startLocalOnlyHotspot\(/, ['NEARBY_WIFI_DEVICES', 'ACCESS_FINE_LOCATION', 'CHANGE_WIFI_STATE']],
      [/requestNetwork\(/, ['CHANGE_NETWORK_STATE', 'ACCESS_NETWORK_STATE']]
    ];
    for (const [use, perms] of needs) {
      expect(kotlinCode, String(use)).toMatch(use);
      for (const p of perms) expect([...declared.keys()], `${use} needs ${p}`).toContain(p);
    }
    for (const m of kotlinCode.matchAll(/Manifest\.permission\.([A-Z_]+)/g)) expect([...declared.keys()]).toContain(m[1]);
  });

  it('are asked at run time as the manifest allows, by API level', () => {
    const radios = code(kotlin.get('Radios.kt')!);
    const asked = [...radios.matchAll(/Manifest\.permission\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(new Set(asked)).toEqual(new Set(['BLUETOOTH_SCAN', 'BLUETOOTH_ADVERTISE', 'BLUETOOTH_CONNECT', 'NEARBY_WIFI_DEVICES', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']));
  });

  it('do not keep the app from phones without the radios, and the manifest has no components', () => {
    for (const f of ['android.hardware.bluetooth', 'android.hardware.bluetooth_le', 'android.hardware.wifi.direct']) {
      expect(manifestCode).toMatch(new RegExp(`<uses-feature android:name="${f.replace(/\./g, '\\.')}" android:required="false" />`));
    }
    expect(manifestCode).not.toMatch(/<(application|activity|service|receiver|provider)\b/);
    expect(manifestCode).not.toMatch(/android:required="true"/);
  });

  it('stay right while the app targets below API 37, where ACCESS_LOCAL_NETWORK would start to apply', () => {
    // The app's targetSdk comes from React Native's defaults (no expo-build-properties in app.json).
    const app = readFileSync('apps/mobile/app.json', 'utf8');
    expect(app).not.toContain('expo-build-properties');
    const rn = /^targetSdk\s*=\s*"(\d+)"/m.exec(readFileSync('node_modules/react-native/gradle/libs.versions.toml', 'utf8'))?.[1];
    expect(Number(rn), 'targetSdk reached 37: read section 9 on ACCESS_LOCAL_NETWORK before raising it').toBeLessThan(37);
  });
});

describe('the nearby module leaves nothing served or open behind a stop', () => {
  it('a Find stopped while a new salt\'s pipe service was being added takes that service down', () => {
    // Why: \`stop\` unserves the pipe, but a \`serve\` already under way answers after it; left up,
    // that salt's GATT service would go on answering after Share nearby stopped (JUnit cannot run BleFind).
    const ble = code(kotlin.get('BleFind.kt')!);
    const startSet = /private fun startSet\([\s\S]*?\n  \}\n/.exec(ble)![0];
    const served = /pipes\.serve\(key, newSalt\) \{ served ->([\s\S]*)/.exec(startSet)![1]!;
    expect(served).toMatch(/if \(kFind == null\) \{\s*pipes\.unserve\(\)/);
  });
});

describe('the nearby module stays off phones it cannot run on', () => {
  const API29 = /WifiP2pConfig\.Builder|WifiNetworkSpecifier|AdvertisingSet\b|startLocalOnlyHotspot|BluetoothGattServer\b/;

  it('keeps every API 29 class behind @RequiresApi(Q), and names none in the module\'s fields', () => {
    for (const [file, text] of kotlin) {
      if (!API29.test(code(text))) continue;
      // Every class in a file that uses one is marked, so lint holds each call to an SDK_INT check.
      const classes = [...code(text).matchAll(/^((?:@[^\n]+\n)*)class (\w+)/gm)];
      for (const c of classes) if (c[2] !== 'PipeTransport') expect(c[1], `${file} ${c[2]}`).toContain('@RequiresApi(Build.VERSION_CODES.Q)');
    }
    expect(moduleKt).not.toMatch(/(val|var)\s+\w+\s*:\s*(RadioKit|BleFind|GattServerPipes|GattClientPipe|WifiDirect|Hotspot)\b/);
    // The kit is reached only after a check of the Android version.
    for (const line of moduleKt.split('\n').filter((l) => /\bkit\(\)|as\? RadioKit/.test(l) && !/fun kit\(\)/.test(l))) expect(line).toMatch(/SDK_INT >= Build\.VERSION_CODES\.Q|^\s*(val kit|\(kitHeld as\? RadioKit\)\?\.let|if \(Build)/);
  });

  it('autolinks on Android only, so no iPhone build carries it', () => {
    expect(JSON.parse(readFileSync(`${MODULE}/expo-module.config.json`, 'utf8')).platforms).toEqual(['android']);
    expect(existsSync(`${MODULE}/ios`)).toBe(false);
    expect(readdirSync(MODULE).some((f) => f.endsWith('.podspec'))).toBe(false);
  });

  it('is imported only by .android files in the app, so the web and iPhone bundles carry none of it', () => {
    const importers = walk('apps/mobile/src').filter((p) => /\.(ts|tsx)$/.test(p) && /from '[^']*modules\/nearby-link|nearby-link'/.test(readFileSync(p, 'utf8')));
    for (const p of importers) expect(p).toMatch(/\.android\.tsx?$/);
    // Its binding is optional, so a build without the module says "not available".
    expect(ts).toMatch(/requireOptionalNativeModule<NearbyLinkNative>\('NearbyLink'\)/);
    expect(ts).not.toMatch(/requireNativeModule\b/);
  });
});

describe('the nearby module\'s JavaScript face equals its Kotlin', () => {
  it('offers the same functions', () => {
    const native = [...moduleKt.matchAll(/AsyncFunction\("(\w+)"\)/g)].map((m) => m[1]).sort();
    const body = /export interface NearbyLinkNative extends NativeModule<NearbyLinkEvents> \{([\s\S]*?)\n\}/.exec(code(ts))![1]!;
    const typed = [...body.matchAll(/^\s+(\w+)\(/gm)].map((m) => m[1]).sort();
    expect(typed).toEqual(native);
  });

  it('sends the same events', () => {
    const native = /Events\(([^)]*)\)/.exec(moduleKt)![1]!.match(/"(\w+)"/g)!.map((s) => s.slice(1, -1)).sort();
    const body = /export type NearbyLinkEvents = \{([\s\S]*?)\n\};/.exec(code(ts))![1]!;
    expect([...body.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]).sort()).toEqual(native);
    for (const e of native) expect(moduleKt).toContain(`emit("${e}"`);
  });

  it('rejects with the same enumerated codes, which the diagnostics allowlist can hold', () => {
    const enumBody = /enum class NearbyCode \{([\s\S]*?)\}/.exec(code(kotlin.get('NearbyError.kt')!))![1]!;
    const codes = [...enumBody.matchAll(/^\s*([A-Z0-9_]+),/gm)].map((m) => m[1]);
    expect([...NEARBY_NATIVE_CODES]).toEqual(codes);
    // Every rejection carries one of them by name, never a message as its code.
    expect(moduleKt).toMatch(/promise\.reject\(e\.code\.name/);
    for (const m of kotlinCode.matchAll(/NearbyCode\.([A-Z0-9_]+)/g)) expect(codes).toContain(m[1]);
  });

  it('calls the same codes a drop as the adapter does', () => {
    // Why: a call on a link that went rejects with one of these, which the adapter must read as OfflineError.
    const set = /val DROP_CODES: Set<NearbyCode> = setOf\(([\s\S]*?)\)/.exec(code(kotlin.get('NearbyError.kt')!))![1]!;
    expect([...set.matchAll(/NearbyCode\.([A-Z0-9_]+)/g)].map((m) => m[1]).sort()).toEqual([...NEARBY_DROP_CODES].sort());
  });

  it('reads its test vectors from the file vitest checks', () => {
    expect(readFileSync(`${MODULE}/android/build.gradle`, 'utf8')).toContain("file('../test-vectors.json')");
    expect(existsSync(`${MODULE}/test-vectors.json`)).toBe(true);
  });
});
