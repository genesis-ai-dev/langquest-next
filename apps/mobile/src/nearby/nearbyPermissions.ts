import type { NearbyPermission, PermissionAnswers, PhoneSystem } from './nearbyPermissionsModel';

/**
 * Share nearby's permission prompts (docs/nearby-sync-plan.md 5.8, section 9) are a phone's:
 * Android's (nearbyPermissions.android.ts) and an iPhone's (nearbyPermissions.ios.ts). The web
 * shares nothing nearby (decision 58) and never reaches this file; it is the shape both phones'
 * files keep, and here nothing is granted or asked.
 */

export function phoneSystem(): PhoneSystem {
  return { os: 'android', sdk: 0 };
}

export function askingForNearby(): boolean {
  return false;
}

export async function checkNearbyPermissions(): Promise<PermissionAnswers> {
  return {};
}

export async function askNearbyPermissions(_permissions: readonly NearbyPermission[]): Promise<PermissionAnswers> {
  return {};
}

export async function openNearbySettings(): Promise<void> {}
