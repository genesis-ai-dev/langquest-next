import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NEARBY_DROP_CODES, NEARBY_NATIVE_CODES } from '../modules/nearby-link/src/codes';

/**
 * Text guards over the nearby module's Kotlin and Swift (docs/nearby-sync-plan.md section 8, Native,
 * section 9, and section 7's phase 5). Nothing compiles Kotlin or Swift on a developer's machine, and
 * the `android-native` and `ios-native` jobs compile them only when the module changes, so the rules
 * that keep a phone safe are held here on every run: nothing logged, nothing fixed in an advert, no
 * Google Play services, every permission used declared and none past the plan's list, API 29 classes
 * kept off a phone below Android 10, no Bluetooth prompt before the screen asks, no background mode,
 * Give the app's page served on its group's address alone, and the JavaScript face equal to the
 * Kotlin and to the Swift.
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

/** The Swift an iPhone build compiles: `ios/*.swift` and `ios/Pure/*.swift`, not the test package. */
const SWIFT = `${MODULE}/ios`;
const swiftFiles = [
  ...readdirSync(SWIFT).filter((f) => f.endsWith('.swift') && f !== 'Package.swift'),
  ...readdirSync(`${SWIFT}/Pure`).filter((f) => f.endsWith('.swift')).map((f) => `Pure/${f}`)
];
const swift = new Map(swiftFiles.map((f) => [f, readFileSync(join(SWIFT, f), 'utf8')]));
const allSwift = [...swift.values()].join('\n');
const swiftCode = code(allSwift);
const swiftOf = (file: string) => code(swift.get(file)!);
const moduleSwift = swiftOf('NearbyLinkModule.swift');
const infoPlist = (JSON.parse(readFileSync('apps/mobile/app.json', 'utf8')) as { expo: { ios?: { infoPlist?: Record<string, unknown>; entitlements?: Record<string, unknown> } } }).expo.ios ?? {};

/** The functions in `text` whose bodies match `needle`, by name. */
function functionsWith(text: string, needle: RegExp): string[] {
  return text.split(/\n(?=\s*(?:(?:private|public|static|override|final|fileprivate)\s+)*func\s)/)
    .filter((part) => needle.test(part)).map((part) => /func\s+(\w+)/.exec(part)?.[1] ?? '(outside a function)');
}

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

  it('never logs in Swift either: no print, NSLog, os_log, Logger or dump', () => {
    expect(swiftFiles.length).toBeGreaterThan(10);
    expect(swiftCode).not.toMatch(/\b(print|debugPrint|NSLog|os_log|dump|assertionFailure)\(/);
    expect(swiftCode).not.toMatch(/\bLogger\b|\bOSLog\b|^\s*import\s+(os|OSLog)\b|FileHandle\.standard(Error|Output)/m);
  });

  it('advertises from Swift only one service UUID worked out from kFind and a salt: no name, data or power', () => {
    const adverts = [...swiftCode.matchAll(/startAdvertising\(([^\n]*)\)/g)].map((m) => m[1]!);
    expect(adverts.length).toBeGreaterThan(0);
    for (const a of adverts) {
      expect(a).toMatch(/^\[CBAdvertisementDataServiceUUIDsKey: \[CBUUID\(nsuuid: FindCodec\.uuidOf\(FindCodec\.advertId\([^)]*\)\)\)\]\]$/);
    }
    // A name, manufacturer or service data, solicitations and power are only ever read from what was heard.
    expect(swiftCode).not.toMatch(/(?<!ad\[)CBAdvertisementData(LocalName|ManufacturerData|ServiceData|SolicitedServiceUUIDs|OverflowServiceUUIDs|TxPowerLevel)Key/);
    // An iPhone sends no scan response: a new payload changes nothing on the air (phase 5).
    const update = /func update\(payload:[\s\S]*?\n  \}\n/.exec(swiftOf('BleFind.swift'))![0];
    expect(update).not.toMatch(/startAdvertising|updateValue|stopAdvertising/);
  });

  it('names no fixed UUID in Swift, and no app name', () => {
    expect(swiftCode.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).toEqual([]);
    expect(swiftCode).not.toMatch(/CBUUID\(string:|UUID\(uuidString:\s*"|CBUUIDClientCharacteristicConfigurationString/);
    // Every Bluetooth UUID is worked out from a key and a salt.
    const made = [...swiftCode.matchAll(/CBUUID\(([^\n]*)/g)].map((m) => m[1]!);
    expect(made.length).toBeGreaterThan(0);
    for (const m of made) expect(m).toMatch(/^nsuuid: FindCodec\.uuidOf\(FindCodec\.(advertId|gattUuid)\(/);
    for (const name of ['LangQuest', 'langquest', 'frontierrnd', 'nearby-sync']) expect(swiftCode.toLowerCase()).not.toContain(name.toLowerCase());
    expect(swiftCode).not.toMatch(/"DIRECT-/);
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
    // A nearby group's name is chosen in JavaScript in Android's usual form; Kotlin makes only Give the app's (14.5).
    expect([...kotlin].filter(([, text]) => /"DIRECT-/.test(code(text))).map(([f]) => f)).toEqual(['GiveApp.kt']);
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

  it('and so does the Swift', () => {
    const ble = swiftOf('BleFind.swift');
    const startSet = /private func startSet\([\s\S]*?\n  \}\n/.exec(ble)![0];
    const served = /pipes\.serve\(p, key, newSalt\) \{ \[weak self\] served in([\s\S]*)/.exec(startSet)![1]!;
    expect(served).toMatch(/if self\.kFind == nil \{\s*self\.pipes\.unserve\(\)/);
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

  it('autolinks on both phones, and an iPhone build compiles only the module\'s own Swift', () => {
    const config = JSON.parse(readFileSync(`${MODULE}/expo-module.config.json`, 'utf8')) as { platforms: string[]; ios: unknown };
    expect([...config.platforms].sort()).toEqual(['android', 'ios']);
    expect(config.ios).toEqual({ modules: ['NearbyLinkModule'], podspecPath: 'NearbyLink.podspec' });
    expect(readdirSync(MODULE).filter((f) => f.endsWith('.podspec'))).toEqual(['NearbyLink.podspec']);
    const podspec = readFileSync(`${MODULE}/NearbyLink.podspec`, 'utf8');
    expect(podspec).toMatch(/s\.name\s*=\s*'NearbyLink'/);
    expect(podspec).toMatch(/^\s*s\.source_files\s*=\s*'ios\/\*\.swift', 'ios\/Pure\/\*\.swift'\s*$/m);
    // The XCTest package beside the sources never ships.
    for (const left of ['ios/Package.swift', 'ios/Tests/**/*', 'ios/.build/**/*']) expect(/s\.exclude_files\s*=([^\n]*)/.exec(podspec)![1]).toContain(`'${left}'`);
    // No pod beside Expo's own: CryptoKit, Core Bluetooth and Network framework come with the phone.
    expect([...podspec.matchAll(/s\.dependency\s+'([^']+)'/g)].map((m) => m[1])).toEqual(['ExpoModulesCore']);
    expect(moduleSwift).toMatch(/public final class NearbyLinkModule: Module\b/);
    expect(moduleSwift).toContain('Name("NearbyLink")');
  });

  it('keeps the Swift to Apple\'s frameworks and Expo, and its pure parts to Foundation and CryptoKit', () => {
    for (const [file, text] of swift) {
      const imports = [...code(text).matchAll(/^\s*import\s+(\w+)/gm)].map((m) => m[1]!);
      const allowed = file.startsWith('Pure/') ? ['Foundation', 'CryptoKit', 'Crypto'] : ['Foundation', 'CoreBluetooth', 'Network', 'NetworkExtension', 'ExpoModulesCore'];
      for (const i of imports) expect(allowed, `${file} imports ${i}`).toContain(i);
      // swift-crypto stands in for CryptoKit only where there is none: the package's tests on Linux.
      if (imports.includes('Crypto')) expect(code(text)).toMatch(/#if canImport\(CryptoKit\)\s*import CryptoKit\s*#else\s*import Crypto\s*#endif/);
    }
    // The module itself is one file; Expo is nowhere else.
    expect(swiftFiles.filter((f) => /import ExpoModulesCore/.test(swiftOf(f)))).toEqual(['NearbyLinkModule.swift']);
  });

  it('is imported only by .android, .ios and .native files in the app, so the web bundle carries none of it', () => {
    const importers = walk('apps/mobile/src').filter((p) => /\.(ts|tsx)$/.test(p) && /from '[^']*modules\/nearby-link|nearby-link'/.test(readFileSync(p, 'utf8')));
    for (const p of importers) expect(p).toMatch(/\.(android|ios|native)\.tsx?$/);
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
    // The Swift package's XCTest reads the same file, from the module's root.
    expect(readFileSync(`${SWIFT}/Tests/NearbyLinkTests/Vectors.swift`, 'utf8')).toMatch(/appendingPathComponent\("test-vectors\.json"\)/);
    expect(readFileSync(`${SWIFT}/Package.swift`, 'utf8')).toMatch(/\.testTarget\(name: "NearbyLinkTests"[^\n]*path: "Tests\/NearbyLinkTests"\)/);
  });
});

describe('the nearby module\'s JavaScript face equals its Swift', () => {
  const tsBody = /export interface NearbyLinkNative extends NativeModule<NearbyLinkEvents> \{([\s\S]*?)\n\}/.exec(code(ts))![1]!;
  const typed = [...tsBody.matchAll(/^\s+(\w+)\(/gm)].map((m) => m[1]).sort();

  it('offers the same functions', () => {
    expect([...moduleSwift.matchAll(/AsyncFunction\("(\w+)"\)/g)].map((m) => m[1]).sort()).toEqual(typed);
  });

  it('sends the same events', () => {
    const native = /Events\(([^)]*)\)/.exec(moduleSwift)![1]!.match(/"(\w+)"/g)!.map((s) => s.slice(1, -1)).sort();
    const body = /export type NearbyLinkEvents = \{([\s\S]*?)\n\};/.exec(code(ts))![1]!;
    expect(native).toEqual([...body.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]).sort());
    for (const e of native) expect(moduleSwift).toContain(`emit("${e}"`);
  });

  it('rejects with the same enumerated codes, in the same order', () => {
    const enumBody = /enum NearbyCode: String, CaseIterable \{([\s\S]*?)\n\}/.exec(swiftOf('Pure/NearbyError.swift'))![1]!;
    expect([...enumBody.matchAll(/^\s*case ([A-Z0-9_]+)\s*$/gm)].map((m) => m[1])).toEqual([...NEARBY_NATIVE_CODES]);
    expect(moduleSwift).toMatch(/promise\.reject\(e\.code\.rawValue, e\.message\)/);
    expect(moduleSwift).toMatch(/promise\.reject\(NearbyCode\.INTERNAL\.rawValue,/);
    for (const m of swiftCode.matchAll(/NearbyCode\.([A-Z0-9_]+)/g)) expect(NEARBY_NATIVE_CODES as readonly string[]).toContain(m[1]);
    // Every code is named in full, so the line above sees each one; none is made from text.
    expect(swiftCode).not.toMatch(/NearbyError\(\s*\.|NearbyCode\(rawValue:|promise\.reject\("/);
  });

  it('calls the same codes a drop', () => {
    const set = /let DROP_CODES: Set<NearbyCode> = \[([\s\S]*?)\]/.exec(swiftOf('Pure/NearbyError.swift'))![1]!;
    expect([...set.matchAll(/NearbyCode\.([A-Z0-9_]+)/g)].map((m) => m[1]).sort()).toEqual([...NEARBY_DROP_CODES].sort());
  });

  it('says what an iPhone can do with the fields the screen reads', () => {
    const iface = /export interface NativeCapabilities \{([\s\S]*?)\n\}/.exec(code(ts))![1]!;
    const fields = [...iface.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]).sort();
    const radios = swiftOf('Radios.swift');
    const said = Object.fromEntries([...radios.matchAll(/^\s*"(\w+)": ([^,\n]+),?$/gm)].map((m) => [m[1]!, m[2]!.trim()]));
    expect(Object.keys(said).sort()).toEqual(fields);
    // An iPhone hosts nothing but awdl, joins an Android's network by name, and sends its advert alone (phase 5).
    expect(said).toMatchObject({
      bluetoothLe: 'true', advertise: 'true', directByName: 'false', band5: 'true', hotspot: 'false', joinHotspot: 'true', wifiOn: 'true', locationOn: 'true',
      scanResponse: 'false', awdl: 'true', joinDirect: 'true'
    });
    expect(said.granted).toBe('granted');
    expect(radios).toMatch(/CBManager\.authorization == \.allowedAlways/);
  });
});

describe('the nearby module on an iPhone', () => {
  it('makes no Bluetooth manager before the screen asks, so reading the capabilities shows no prompt', () => {
    expect(functionsWith(swiftOf('BleFind.swift'), /CBCentralManager\(/)).toEqual(['makeCentral']);
    expect(functionsWith(swiftOf('BleFind.swift'), /CBPeripheralManager\(/)).toEqual(['makePeripheral']);
    expect(swiftCode.match(/CBCentralManager\(|CBPeripheralManager\(/g)).toHaveLength(2);
    expect(functionsWith(swiftOf('RadioKit.swift'), /makeCentral\(\)/).sort()).toEqual(['askPermission', 'startFind']);
    expect(functionsWith(swiftOf('RadioKit.swift'), /makePeripheral\(\)/)).toEqual(['startFind']);
    expect(swiftFiles.filter((f) => /make(Central|Peripheral)\(\)/.test(swiftOf(f))).sort()).toEqual(['BleFind.swift', 'RadioKit.swift']);
    // `capabilities` reads only what was already made.
    const capabilities = /AsyncFunction\("capabilities"\)[\s\S]*?\n    \}/.exec(moduleSwift)![0];
    expect(capabilities).not.toMatch(/kit\(\)/);
    expect(capabilities).toMatch(/made\(\)/);
    // Nothing at construction: the radios and the links come at the first call that needs them.
    expect(moduleSwift).not.toMatch(/^ {2}(?:private\s+)?(?:let|var)\s+\w+\s*(?::[^=\n]+)?=\s*(?:RadioKit|LinkRegistry|BleFind|GattServerPipes)\(/m);
    expect(moduleSwift).toMatch(/private var kitHeld: RadioKit\?/);
  });

  it('runs nothing in the background, and stops everything when it goes', () => {
    expect(swiftCode).not.toMatch(/RestoreIdentifierKey|beginBackgroundTask|BGTaskScheduler|UIApplication/);
    const modes = (infoPlist.infoPlist?.['UIBackgroundModes'] ?? []) as string[];
    for (const mode of ['bluetooth-central', 'bluetooth-peripheral', 'fetch', 'processing']) expect(modes).not.toContain(mode);
    expect(moduleSwift).toMatch(/OnDestroy \{\s*self\.stopAll\(\)/);
    expect(moduleSwift).toMatch(/OnAppEntersBackground \{/);
  });

  it('asks only for what the app declares: Bluetooth, the local network and joining a network', () => {
    expect(typeof infoPlist.infoPlist?.['NSBluetoothAlwaysUsageDescription']).toBe('string');
    expect(typeof infoPlist.infoPlist?.['NSLocalNetworkUsageDescription']).toBe('string');
    expect(infoPlist.entitlements?.['com.apple.developer.networking.HotspotConfiguration']).toBe(true);
  });

  it('serves awdl under the one Bonjour type Info.plist declares, peer to peer', () => {
    expect([...swiftCode.matchAll(/"(_[a-z0-9-]+\._(?:tcp|udp))"/g)].map((m) => m[1])).toEqual(['_nlink._tcp']);
    expect(infoPlist.infoPlist?.['NSBonjourServices']).toEqual(['_nlink._tcp']);
    const awdl = swiftOf('Awdl.swift');
    expect(awdl).toMatch(/NWListener\.Service\(name: name, type: serviceType\)/);
    expect(awdl).toMatch(/NWEndpoint\.service\(name: name, type: serviceType, domain: "local\.", interface: nil\)/);
    expect(awdl.match(/NetLinks\.tcp\(peerToPeer: true\)/g)).toHaveLength(2);
    // Anyone nearby can reach the service, so every connection is a candidate until one proves the keys.
    expect(awdl).toMatch(/candidates: true/);
  });

  it('joins an Android\'s network for this run only, over Wi-Fi alone, and leaves it', () => {
    const join = swiftOf('WifiJoin.swift');
    expect(join).toMatch(/NEHotspotConfiguration\(ssid: ssid, passphrase: passphrase, isWEP: false\)/);
    expect(join).toMatch(/config\.joinOnce = true/);
    expect(join).toMatch(/NetLinks\.tcp\(wifiOnly: true\)/);
    expect(swiftOf('NetLinks.swift')).toMatch(/if wifiOnly \{ p\.requiredInterfaceType = \.wifi \}/);
    expect(join).toMatch(/removeConfiguration\(forSSID: ssid\)/);
    expect(swiftOf('RadioKit.swift')).toMatch(/removeConfiguration\(forSSID: ssid\)/);
    // It hosts neither, and says so with the codes the Kotlin uses for a phone that cannot.
    const host = /func host\(kind:[\s\S]*?\n  \}\n/.exec(swiftOf('RadioKit.swift'))![0];
    expect(host).toMatch(/case "wifi-direct": throw NearbyError\(NearbyCode\.P2P_UNSUPPORTED/);
    expect(host).toMatch(/case "hotspot": throw NearbyError\(NearbyCode\.HOTSPOT_INCOMPATIBLE/);
  });

  it('sends files only from the app\'s own folders and writes them only there', () => {
    const roots = /private static func roots\(\)[\s\S]*?\n  \}/.exec(moduleSwift)![0];
    expect([...roots.matchAll(/\.(documentDirectory|libraryDirectory|cachesDirectory|temporaryDirectory)\b/g)].map((m) => m[1]).sort())
      .toEqual(['cachesDirectory', 'documentDirectory', 'libraryDirectory', 'temporaryDirectory']);
    expect(swiftOf('Pure/LinkSession.swift')).toMatch(/if !Paths\.inside\(file, roots\) \{ throw NearbyError\(NearbyCode\.FILE_UNREADABLE/);
    expect(swiftOf('Pure/PartWriter.swift')).toMatch(/if !Paths\.inside\(target, roots\) \{ throw NearbyError\(NearbyCode\.STAGING_REFUSED/);
  });
});

describe('Give the app (docs/nearby-sync-plan.md 14.5)', () => {
  const kit = code(kotlin.get('RadioKit.kt')!);
  const server = code(kotlin.get('InstallFileServer.kt')!);
  const keep = code(kotlin.get('InstallFile.kt')!);
  const kitFun = (name: string) => new RegExp(`\\n {2}fun ${name}\\([\\s\\S]*?\\n {2}\\}\\n`).exec(kit)![0];

  it('serves on the group\'s own address, never on every network this phone is on', () => {
    const bind = /private fun giveSocket\(address: InetAddress\)[\s\S]*?\n {2}\}\n/.exec(kit)![0];
    expect([...bind.matchAll(/ServerSocket\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['GIVE_PORT, GIVE_BACKLOG, address', '0, GIVE_BACKLOG, address']);
    expect(kit).toMatch(/val socket = giveSocket\(group\.address\)/);
    expect(code(kotlin.get('WifiLinks.kt')!)).toMatch(/return Owned\(info\.groupOwnerAddress, down\)/);
    // The server binds nothing itself; and every server socket in the module names an address but
    // the hotspot's, whose own address cannot be found (Hosted.kt).
    expect(server).not.toMatch(/ServerSocket\(|\.bind\(/);
    expect([...kotlinCode.matchAll(/ServerSocket\(([^)]*)\)/g)].map((m) => m[1]).filter((args) => args!.split(',').length < 3)).toEqual(['0, 4']);
  });

  it('serves the page and the one file by exact path, in pure Kotlin on java.* alone, and logs nothing', () => {
    for (const m of server.matchAll(/^import\s+([\w.]+)/gm)) expect(m[1]).toMatch(/^java\./);
    expect(server).toMatch(/when \(r\.target\) \{\s*"\/" ->[^\n]*\n\s*filePath ->[^\n]*\n\s*else -> answer\(conn, out, 404/);
    expect(server).toMatch(/private val filePath = "\/\$name"/);
    // Nothing decodes, resolves or normalises a path, so nothing else on the phone is reachable.
    expect(server).not.toMatch(/URLDecoder|URI\(|normalize|canonical|\bFile\(/);
    for (const header of ['"Cache-Control" to "no-store"', '"X-Content-Type-Options" to "nosniff"', '"Connection" to "close"']) expect(server).toContain(header);
  });

  it('keeps the install file only in the app\'s own files folder, under a carried build\'s name', () => {
    expect(keep).toMatch(/private val folder: File get\(\) = File\(context\.filesDir, FOLDER\)/);
    expect(keep).toMatch(/const val FOLDER = "install-file"/);
    expect(keep).toMatch(/val dir = folder\n/);
    // It writes only `<name>.part` there, then renames it there.
    expect([...keep.matchAll(/FileOutputStream\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['part, false']);
    expect(keep).toMatch(/val part = File\(dir, "\$name\.part"\)/);
    expect(keep).toMatch(/val kept = File\(dir, name\)/);
    expect(keep).toMatch(/if \(!nameOk\(name\)\) throw NearbyException\(NearbyCode\.BAD_ARGUMENT/);
    expect(keep).toContain('Regex("^r[0-9]+-l[0-9]+-p[0-9]+(\\\\.[0-9]+)?-[0-9a-f]{8}\\\\.apk$")');
    // A copy, not a lasting grant on the person's file, and nowhere outside the app's own folder.
    expect(keep).not.toMatch(/takePersistableUriPermission|cacheDir|getExternalFilesDir|getExternalStorage|Environment\.|openFileOutput/);
  });

  it('keeps only this app\'s own file: its package name and exactly its signers', () => {
    expect(keep).toMatch(/if \(archive\.packageName != context\.packageName\) return false/);
    expect(keep).toMatch(/return sameSigners\(signers\(archive\), signers\(own\)\)/);
    expect(keep).toMatch(/if \(!ours\(part\)\) throw NearbyException\(NearbyCode\.FILE_REFUSED/);
    expect(keep).toMatch(/catch \(e: Exception\) \{\s*part\.delete\(\)/);
  });

  it('makes its Wi-Fi name and passphrase with SecureRandom, and nothing in the module uses a weaker one', () => {
    const give = code(kotlin.get('GiveApp.kt')!);
    expect(give).toMatch(/fun ssid\(random: SecureRandom\)/);
    expect(give).toMatch(/fun passphrase\(random: SecureRandom\)/);
    expect(kit).toMatch(/private val random = SecureRandom\(\)/);
    expect(kitFun('startGiveApp')).toMatch(/giveOnNewGroup\(/);
    expect(kit).toMatch(/GiveNames\.ssid\(random\)[\s\S]*GiveNames\.passphrase\(random\)/);
    expect(kotlinCode).not.toMatch(/java\.util\.Random\b|kotlin\.random|Math\.random|ThreadLocalRandom|\bRandom\(/);
  });

  it('never runs beside a nearby group, hosted or joined: GROUP_BUSY either way', () => {
    expect(kit).toMatch(/private fun claimNearby\(\) = synchronized\(groups\) \{\s*if \(giving != null \|\| giveForming\) throw NearbyException\(NearbyCode\.GROUP_BUSY/);
    expect(kitFun('host')).toMatch(/claimNearby\(\)/);
    expect(kitFun('join')).toMatch(/claimNearby\(\)/);
    expect(kitFun('startGiveApp')).toMatch(/if \(nearbyGroups > 0\) throw NearbyException\(NearbyCode\.GROUP_BUSY/);
    // Keeping the file needs no radio; serving it does, on Android 10 and later.
    expect(moduleKt).toMatch(/AsyncFunction\("keepInstallFile"\)[^\n]*\n\s*run\(promise\)/);
    expect(moduleKt).toMatch(/AsyncFunction\("startGiveApp"\)[^\n]*\n\s*radio\(promise\)/);
  });

  it('ends with every stop: its own, stopAll, the app leaving the screen, and the module going', () => {
    expect(kitFun('stopAll')).toMatch(/^\s*fun stopAll\(\) \{\s*stopGiveApp\(\)/);
    expect(moduleKt).toMatch(/AsyncFunction\("stopGiveApp"\)[^\n]*\n[^\n]*\?\.stopGiveApp\(\)/);
    expect(moduleKt).toMatch(/OnActivityEntersBackground \{ io\.execute \{ stopAll\(backgrounded = true\) \} \}/);
    expect(moduleKt).toMatch(/OnDestroy \{\s*stopAll\(\)/);
    expect(moduleKt).toMatch(/private fun stopAll\(backgrounded: Boolean = false\) \{[\s\S]*?kit\?\.stopAll\(\)/);
  });

  it('says not available on an iPhone, which has no Android install file to give', () => {
    for (const f of ['keepInstallFile', 'keptInstallFile', 'dropInstallFile', 'startGiveApp', 'giveAppStatus', 'stopGiveApp']) {
      expect(moduleSwift).toMatch(new RegExp(`AsyncFunction\\("${f}"\\) \\{ \\([^)]*promise: Promise\\) in\\n\\s*self\\.androidOnly\\(promise\\)\\n\\s*\\}`));
    }
    expect(moduleSwift).toMatch(/private func androidOnly\(_ promise: Promise\) \{\s*run\(promise\) \{\s*throw NearbyError\(NearbyCode\.NOT_AVAILABLE, /);
  });
});
