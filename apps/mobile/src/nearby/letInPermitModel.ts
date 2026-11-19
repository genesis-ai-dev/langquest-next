// Let someone in's permission step (docs/nearby-sync-plan.md 14.4, "Its permissions"), as a pure
// rule apart from letInModel.ts: only Android's hook (useLetIn.android.ts) calls it, so the web,
// which loads letInModel through Let someone in's stub, carries none of Share nearby's permission
// rules for it. Screens take only its type. Tested in test/letIn.test.ts.
import { permissionsStateOf, permissionStepOf, type NearbyPermission, type PermissionAnswers, type PermissionReason } from './nearbyPermissionsModel';

/**
 * What Let someone in does while the nearby permissions are missing (Carl, 2026-11-19). It used to
 * tell the person to open Share nearby, allow what Android asks and come back, with no way there,
 * and a carrier coming from Give the app (which asks only for its own Wi-Fi permission) was stuck.
 * Now, as Give the app does, it asks Android itself:
 * - `explain`: Share nearby's line for this Android version, then the screen's Continue asks for
 *   `permissions` (`permissionStepOf`, so both screens ask alike);
 * - `settings`: Android will not ask again, so the screen opens the app's settings;
 * - `covered`: a phone that wears a cover asks nothing here, since Share nearby's warning comes
 *   before any prompt (decision 231); its own line sends the person there.
 * Null when nothing is missing, or before the answers are read.
 */
export type LetInPermit = { t: 'explain'; reason: PermissionReason; permissions: NearbyPermission[] } | { t: 'settings' } | { t: 'covered' };

export function letInPermit(o: { sdk: number; answers: PermissionAnswers | undefined; worn: boolean }): LetInPermit | null {
  if (!o.answers) return null;
  const state = permissionsStateOf(o.sdk, o.answers);
  if (state === 'granted' || state === 'none') return null;
  if (o.worn) return { t: 'covered' };
  const step = permissionStepOf({ sdk: o.sdk, answers: o.answers, worn: false, warned: true, firstPress: false });
  if (step.t === 'settings') return { t: 'settings' };
  return step.t === 'explain' ? { t: 'explain', reason: step.reason, permissions: step.permissions } : null;
}
