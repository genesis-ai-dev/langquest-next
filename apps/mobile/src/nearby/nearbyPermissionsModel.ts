/**
 * What Share nearby asks of Android before its radios may run (docs/nearby-sync-plan.md 5.8,
 * section 9, Carl's answers 7 and 15). Pure: the Android version, what is granted and what the
 * module says come in as plain values, and what to ask, what to say first and what a refusal
 * means go out as plain values and keys, so every rule is tested without a phone. The words
 * are the screen's (src/i18n, and for a phone that wears a cover src/disguise/i18n); this file
 * names only which one. The prompting itself is nearbyPermissions.android.ts.
 *
 * The module's AndroidManifest.xml declares the set (`modules/nearby-link`): Bluetooth and
 * Bluetooth admin up to API 30 need no prompt; on 29 and 30 a scan and Wi-Fi Direct need
 * location, fine and coarse; on 31 and 32 the three Bluetooth permissions (the "Nearby devices"
 * prompt) and fine and coarse for Wi-Fi Direct, two prompts; from 33 the three and
 * `NEARBY_WIFI_DEVICES`, one prompt. Never location from 33, never anything for a background.
 */

/** The runtime permissions the module's manifest declares, by their names after `android.permission.`. */
export type NearbyPermission =
  | 'ACCESS_FINE_LOCATION' | 'ACCESS_COARSE_LOCATION' | 'BLUETOOTH_SCAN' | 'BLUETOOTH_ADVERTISE' | 'BLUETOOTH_CONNECT' | 'NEARBY_WIFI_DEVICES';

/** Android 10: `WifiP2pConfig.Builder` is API 29, so below it the module ships and does nothing (Carl's answer 7). */
export const NEARBY_MIN_SDK = 29;

const LOCATION: readonly NearbyPermission[] = ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'];
const BLUETOOTH: readonly NearbyPermission[] = ['BLUETOOTH_SCAN', 'BLUETOOTH_ADVERTISE', 'BLUETOOTH_CONNECT'];

/** What this Android version asks at run time, in the order its prompts come; nothing below Android 10. */
export function nearbyPermissionsFor(sdk: number): readonly NearbyPermission[] {
  if (sdk < NEARBY_MIN_SDK) return [];
  if (sdk <= 30) return LOCATION;
  if (sdk <= 32) return [...BLUETOOTH, ...LOCATION];
  return [...BLUETOOTH, 'NEARBY_WIFI_DEVICES'];
}

/** What a permission came back as: React Native's `PermissionsAndroid.RESULTS`. */
export type PermissionAnswer = 'granted' | 'denied' | 'never_ask_again';

/** Each permission this Android asks, and its answer or what a check found (a check says only granted or denied). */
export type PermissionAnswers = Partial<Record<NearbyPermission, PermissionAnswer>>;

/**
 * Where the permissions stand:
 * - `granted`: everything this Android asks is granted;
 * - `needed`: something is missing and may be asked for;
 * - `approximate`: Android 12 or 12L gave "Approximate" (coarse only), and Wi-Fi Direct needs
 *   fine there, so the screen asks again and says why;
 * - `blocked`: Android will not prompt again ("Don't ask again", or a second refusal): only
 *   the app's settings can grant it;
 * - `none`: this Android asks nothing, because nearby sync does not run on it.
 */
export type PermissionsState = 'granted' | 'needed' | 'approximate' | 'blocked' | 'none';

export function permissionsStateOf(sdk: number, answers: PermissionAnswers): PermissionsState {
  const wanted = nearbyPermissionsFor(sdk);
  if (wanted.length === 0) return 'none';
  const missing = wanted.filter((p) => answers[p] !== 'granted');
  if (missing.length === 0) return 'granted';
  if (missing.some((p) => answers[p] === 'never_ask_again')) return 'blocked';
  if (sdk >= 31 && sdk <= 32 && missing.length === 1 && missing[0] === 'ACCESS_FINE_LOCATION' && answers.ACCESS_COARSE_LOCATION === 'granted') return 'approximate';
  return 'needed';
}

/** What is still to ask: everything not granted, in the order the prompts come. */
export function missingPermissions(sdk: number, answers: PermissionAnswers): NearbyPermission[] {
  return nearbyPermissionsFor(sdk).filter((p) => answers[p] !== 'granted');
}

/**
 * The line shown before a prompt, saying why (section 9):
 * - `location`: Android 10 and 11 call Bluetooth scanning and Wi-Fi Direct location; nothing
 *   about location is collected, and people will question the prompt, so it is said first;
 * - `nearby-and-location`: Android 12 and 12L, two prompts, the second saying location;
 * - `nearby-devices`: Android 13 and later, one "Nearby devices" prompt;
 * - `precise`: the person chose "Approximate" on 12 or 12L, which Wi-Fi Direct cannot use;
 * - `settings`: Android will not ask again, so the way is the app's settings.
 */
export type PermissionReason = 'location' | 'nearby-and-location' | 'nearby-devices' | 'precise' | 'settings';

export function permissionReasonOf(sdk: number, state: PermissionsState): PermissionReason | null {
  if (state === 'granted' || state === 'none') return null;
  if (state === 'blocked') return 'settings';
  if (state === 'approximate') return 'precise';
  if (sdk <= 30) return 'location';
  if (sdk <= 32) return 'nearby-and-location';
  return 'nearby-devices';
}

/**
 * The next thing between the person and the radios, as far as permissions go:
 * - `warn`: on a phone that wears a cover, the one notice before any prompt (Carl's answer 15):
 *   someone with equipment can tell a phone is broadcasting, and Android names the app, so do
 *   this alone. Its words are src/disguise/i18n's, through `NearbyCoverNotes`;
 * - `explain`: the line saying why, then the screen's button calls `ask` with `permissions`;
 * - `settings`: Android will not prompt, so the button opens the app's settings;
 * - `ready`: nothing is missing.
 *
 * `warned` is whether the warning was shown for this press. The first press on a worn phone
 * warns even with everything granted (`firstPress`), and any later press that would bring a
 * prompt warns again, because a prompt names the application in front of whoever is there.
 */
export type PermissionStep =
  | { t: 'warn' }
  | { t: 'explain'; reason: PermissionReason; permissions: NearbyPermission[] }
  | { t: 'settings' }
  | { t: 'ready' };

export interface PermissionStepFacts {
  sdk: number;
  answers: PermissionAnswers;
  worn: boolean;
  warned: boolean;
  firstPress: boolean;
}

export function permissionStepOf(f: PermissionStepFacts): PermissionStep {
  const state = permissionsStateOf(f.sdk, f.answers);
  const prompts = state === 'needed' || state === 'approximate';
  if (f.worn && !f.warned && (prompts || f.firstPress)) return { t: 'warn' };
  if (state === 'blocked') return { t: 'settings' };
  if (prompts) return { t: 'explain', reason: permissionReasonOf(f.sdk, state)!, permissions: missingPermissions(f.sdk, f.answers) };
  return { t: 'ready' };
}

/**
 * What a prompt's answers mean, merged over what was held: a second "Deny" on Android 11 and
 * later comes back as `never_ask_again`, and so blocks; a single one leaves it to ask again.
 */
export function afterPrompt(held: PermissionAnswers, answers: PermissionAnswers): PermissionAnswers {
  return { ...held, ...answers };
}

// ---- whether the phone can share at all ---------------------------------------------------

/** What the module says of the phone (`NativeCapabilities` in modules/nearby-link), as far as this file reads it. */
export interface PhoneFacts {
  sdk: number;
  bluetoothLe: boolean;
  directByName: boolean;
  bluetoothOn: boolean;
  wifiOn: boolean;
  locationOn: boolean;
}

/**
 * Why Share nearby is disabled, with a line saying so and its `onPress` kept for help mode
 * (5.8, Carl's answer 7):
 * - `not-in-build`: this binary has no module (an older one under a newer update);
 * - `android-too-old`: below Android 10;
 * - `no-bluetooth-le`, `no-wifi-direct`: the phone lacks the radio.
 */
export type NearbyUnavailable = 'not-in-build' | 'android-too-old' | 'no-bluetooth-le' | 'no-wifi-direct';

export function unavailableReasonOf(facts: PhoneFacts | null, inBuild: boolean, sdk: number): NearbyUnavailable | null {
  if (!inBuild) return 'not-in-build';
  if ((facts?.sdk ?? sdk) < NEARBY_MIN_SDK) return 'android-too-old';
  if (!facts) return null;
  if (!facts.bluetoothLe) return 'no-bluetooth-le';
  if (!facts.directByName) return 'no-wifi-direct';
  return null;
}

/** A radio the person must turn on, because an app generally cannot (5.8). */
export type RadioOff = 'bluetooth' | 'wifi' | 'location';

/**
 * Which of them is off. Location counts only on Android 10 and 11, where a scan without
 * `neverForLocation` reportedly returns nothing with Location off; the real-phone test confirms
 * it (section 11). From 12 the scan never derives location and the toggle does not matter.
 */
export function radiosOffOf(facts: PhoneFacts | null): RadioOff[] {
  if (!facts) return [];
  const off: RadioOff[] = [];
  if (!facts.bluetoothOn) off.push('bluetooth');
  if (!facts.wifiOn) off.push('wifi');
  if (facts.sdk <= 30 && !facts.locationOn) off.push('location');
  return off;
}
