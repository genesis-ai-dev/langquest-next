import { AccessibilityInfo, Platform } from 'react-native';

/**
 * How long a toast shows before a screen reader doubles it (decision 159):
 * 3.5 s, or longer when Android's "Time to take action" asks for more.
 * Android answers that setting through getRecommendedTimeoutMillis; iOS has
 * none and the web cannot tell, so they keep 3.5 s. Read once when the
 * toast host mounts (`readToastTime`), so a toast and the second Back that
 * leaves the app (backModel.ts `leavesNow`) last the same time.
 */
export const TOAST_MS = 3500;
let base = TOAST_MS;

export function toastTime(): number {
  return base;
}

export function readToastTime(): void {
  if (Platform.OS !== 'android') return;
  // Android answers at least the time it is given.
  AccessibilityInfo.getRecommendedTimeoutMillis(TOAST_MS).then((ms) => { base = ms; }, () => undefined);
}
