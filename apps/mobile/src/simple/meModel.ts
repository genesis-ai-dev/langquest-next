// The words on Me (decision 71; the demo's simple Me). Pure, for tests.

const passages = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'passage' : 'passages'}`;

/**
 * "Ready for offline": how many kept passages are on this device, in the
 * fewest words (the full picture is one tap away, on the Sync screen).
 * The simple screens say "device", not "phone" (demo ADR-040).
 */
export function offlineCount(s: { kept: number; ready: number } | null): string {
  if (!s) return 'Checking this device…';
  if (s.kept === 0) return 'No passages kept on this device yet';
  if (s.ready === s.kept) return `${passages(s.kept)} on this device`;
  return `${s.ready.toLocaleString('en-US')} of ${passages(s.kept)} ready on this device`;
}

/** What More settings holds, as Me's row says it. */
export const MORE_SETTINGS_SUB = 'Password, notifications, sync, account';
