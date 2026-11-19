import { Linking, Platform } from 'react-native';
import { nearbyLinkNative } from '../../modules/nearby-link';
import type { NearbyPermission, PermissionAnswers, PhoneSystem } from './nearbyPermissionsModel';

/**
 * Share nearby's permission prompt on an iPhone (docs/nearby-sync-plan.md 5.8, section 7's phase
 * 5), with the same exports as Android's file (nearbyPermissions.android.ts). Bluetooth is the only
 * prompt an app can ask ahead, and the module asks it (`askPermission()`), only when the person
 * presses the screen's button after its line saying why. iOS asks once: a refusal stays until the
 * person allows it in the app's settings, so it comes back as `never_ask_again`. Local Network has
 * no way to ask ahead (iOS prompts at the first connection over Wi-Fi) and each Wi-Fi join shows a
 * system prompt, so neither is asked or checked here. What an answer means is
 * nearbyPermissionsModel.ts.
 */

/** An iPhone, at its iOS major version, for the rules in nearbyPermissionsModel.ts; no Android rule reads it. */
export function phoneSystem(): PhoneSystem {
  const major = Number.parseInt(String(Platform.Version), 10);
  return { os: 'ios', sdk: Number.isFinite(major) ? major : 0 };
}

/** A prompt is open: iOS shows it over the app, which is not leaving it. */
let asking = 0;
export function askingForNearby(): boolean {
  return asking > 0;
}

/**
 * The prompt was answered with a refusal this run. A check says only whether Bluetooth is allowed,
 * so a refusal from an earlier run reads as `denied`, and the next press finds out at once that iOS
 * will not ask, with no prompt.
 */
let refused = false;

/** What is allowed now, with no prompt: Bluetooth, from the module's facts. */
export async function checkNearbyPermissions(): Promise<PermissionAnswers> {
  const native = nearbyLinkNative();
  if (!native) return {};
  const { granted } = await native.capabilities();
  if (granted) return { BLUETOOTH: 'granted' };
  return { BLUETOOTH: refused ? 'never_ask_again' : 'denied' };
}

/** iOS's Bluetooth prompt, the first time; after that the module only answers. */
export async function askNearbyPermissions(permissions: readonly NearbyPermission[]): Promise<PermissionAnswers> {
  const native = nearbyLinkNative();
  if (!native || !permissions.includes('BLUETOOTH')) return {};
  asking += 1;
  try {
    const granted = await native.askPermission();
    refused = !granted;
    return { BLUETOOTH: granted ? 'granted' : 'never_ask_again' };
  } finally {
    asking -= 1;
  }
}

/** iOS will not prompt again: the app's page in Settings, where Bluetooth and Local Network are switched on. */
export async function openNearbySettings(): Promise<void> {
  await Linking.openSettings();
}
