/**
 * Sync protocol version this client speaks. Sent with every append and pull;
 * the server refuses clients below its `server_config.min_client_version`
 * with a distinct error so the app can say "upgrade" instead of silently
 * folding a stream it can no longer read correctly. Bump when an event or
 * RPC change makes older clients unsafe, not on every reducer change.
 */
export const CLIENT_PROTOCOL_VERSION = 1;

/** An app version as the stores print it: one to three dot-separated numbers ('2026.1022.1830'). */
export const VERSION_TEXT = '\\d+(?:\\.\\d+){0,2}';
export const VERSION_PATTERN = new RegExp(`^${VERSION_TEXT}$`);

/** A version as numbers, part by part: '2026.1.22' → [2026, 1, 22]. Null for anything else. */
export function versionParts(v: string | null | undefined): number[] | null {
  if (!v || !VERSION_PATTERN.test(v)) return null;
  return v.split('.').map(Number);
}

/** Negative when a is older than b, positive when newer, 0 when the same (1.0 is 1.0.0). */
export function compareVersions(a: string, b: string): number {
  const pa = versionParts(a) ?? [];
  const pb = versionParts(b) ?? [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
