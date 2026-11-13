import { Linking, PermissionsAndroid, Platform, type Permission } from 'react-native';
import { nearbyPermissionsFor, type NearbyPermission, type PermissionAnswer, type PermissionAnswers } from './nearbyPermissionsModel';

/**
 * Share nearby's permission prompts through React Native's `PermissionsAndroid`
 * (docs/nearby-sync-plan.md 5.8, section 9). No native code: it lists every permission the
 * module's manifest declares. Asked only when the person presses the screen's button after its
 * line saying why, never at launch and never for a background. What to ask and what an answer
 * means are nearbyPermissionsModel.ts.
 */

const full = (p: NearbyPermission) => `android.permission.${p}` as Permission;

/** This phone's Android API level. */
export function androidSdk(): number {
  return typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version) || 0;
}

/** A prompt is open: it takes the app to the background, which is not leaving it (as the recorder's microphone prompt). */
let asking = 0;
export function askingForNearby(): boolean {
  return asking > 0;
}

/** What is granted now, with no prompt. A check says only granted or denied. */
export async function checkNearbyPermissions(sdk = androidSdk()): Promise<PermissionAnswers> {
  const out: PermissionAnswers = {};
  for (const p of nearbyPermissionsFor(sdk)) out[p] = (await PermissionsAndroid.check(full(p))) ? 'granted' : 'denied';
  return out;
}

/** The system's prompts for these, in one request: Android groups them as it shows them. */
export async function askNearbyPermissions(permissions: readonly NearbyPermission[]): Promise<PermissionAnswers> {
  if (permissions.length === 0) return {};
  asking += 1;
  try {
    const answers = await PermissionsAndroid.requestMultiple(permissions.map(full));
    const out: PermissionAnswers = {};
    for (const p of permissions) out[p] = (answers[full(p)] ?? 'denied') as PermissionAnswer;
    return out;
  } finally {
    asking -= 1;
  }
}

/** Android will not prompt again: the app's own settings page. */
export async function openNearbySettings(): Promise<void> {
  await Linking.openSettings();
}
