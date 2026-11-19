import type { PermissionsState, RadioOff } from './nearbyPermissionsModel';
import type { NearbyWhyNot } from './nearbyRunModel';

/** One of sync's `NEARBY_DIAG_BLOCKED` (apps/mobile/test/nearbyDiagModel.test.ts holds them equal). */
export type NearbyBlocked = Exclude<NearbyWhyNot, 'loading'> | `${RadioOff}-off` | 'permission-approximate' | 'permission-blocked';

/**
 * Why Share nearby cannot run, as diagnostics say it (packages/sync/src/nearbyDiag.ts): the
 * phone's or the identity's reason first, then a radio off, then permissions refused. Null while
 * it is being worked out, while a prompt is still to come, and when it can run. Only a phone's
 * files import this, so the web carries none of it; the type is spelt here, since only a phone's
 * own file (`.native`, `.android`, `.ios`) may import the nearby entry. An iPhone's reasons are
 * among Android's: it never says `android-too-old`, `no-wifi-direct`, `location-off` or
 * `permission-approximate`.
 */
export function nearbyBlockedOf(whyNot: NearbyWhyNot | null, radiosOff: readonly RadioOff[], permissions: PermissionsState): NearbyBlocked | null {
  if (whyNot === 'loading') return null;
  if (whyNot !== null) return whyNot;
  if (radiosOff[0]) return `${radiosOff[0]}-off`;
  if (permissions === 'blocked' || permissions === 'approximate') return `permission-${permissions}`;
  return null;
}
