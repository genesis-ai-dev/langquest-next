/**
 * The invite code, as text. Pure: no Expo, no network, so it is testable and
 * the screens and the scanner cannot disagree about what a code is.
 *
 * The QR carries the org and the token so a scanner knows where it is going
 * before it redeems. Parsing is lenient because people forward the code in a
 * message rather than scanning, and an invite that only works from a camera
 * is an invite most of these users cannot accept.
 *
 * A link is the app's https address when the build knows it (decisions.md
 * 54, amended): `https://next.langquest.org/invite#org=…&token=…`, which a
 * phone with the app opens in the app (universal links, app links) and
 * anything else opens in the web app. The key rides after the `#`, so it is
 * never sent to a server or kept in its logs. Without an address, the
 * older `langquestnext://` link; both are always read.
 */
export function inviteUri(orgId: string, token: string, appUrl?: string | null): string {
  // Only the org and the token: anything else a link carried (a name, a
  // role, who sent it) would be shown on the scan screen as if it were true,
  // and anyone can edit a link. What the invite grants is the server's, read
  // when it is redeemed.
  const params = `org=${encodeURIComponent(orgId)}&token=${encodeURIComponent(token)}`;
  return appUrl ? `${appUrl}/invite#${params}` : `langquestnext://invite?${params}`;
}

/**
 * The parameters of a link for `path` (`invite`, `signin`), in either form; null when it is not one.
 * Plain http only on this machine: the web app served locally makes its links
 * from its own address (appUrl.ts), and must read back the links it makes.
 */
function linkParams(raw: string, path: 'invite' | 'signin'): string | null {
  const scheme = new RegExp(`^langquestnext://${path}\\?(.*)$`, 'i').exec(raw);
  if (scheme) return scheme[1]!;
  const https = new RegExp(`^(?:https://([^/?#\\s]+)|http://${LOCAL_HOST}(?::\\d+)?)/${path}/?[?#](.*)$`, 'i').exec(raw);
  if (!https) return null;
  // An https link is the app's only when it is at one of the app's own addresses: a key read out of a link to
  // anywhere else would let a page that is not ours put a code in front of someone as if it were.
  if (https[1] !== undefined && !appHosts().has(https[1].toLowerCase())) return null;
  return https[2]!;
}

/**
 * The hosts the app's links are made at: the two it declares for universal links and app links (app.json,
 * associatedDomains and intentFilters) and the address this build was given (appUrl.ts).
 */
const DECLARED_HOSTS = ['next.langquest.org', 'next-preview.langquest.org'];
function appHosts(): Set<string> {
  const hosts = new Set(DECLARED_HOSTS);
  try {
    const own = process.env.EXPO_PUBLIC_APP_URL;
    if (own) hosts.add(new URL(own).host.toLowerCase());
  } catch { /* not an address: only the declared hosts */ }
  return hosts;
}

/** This machine, by the names a local web server answers to. */
const LOCAL_HOST = '(?:localhost|127\\.0\\.0\\.1|\\[::1\\]|[a-z0-9-]+\\.localhost)';

export function parseInvite(input: string): { orgId?: string; token: string } | null {
  const raw = input.trim();
  if (!raw) return null;
  const params = linkParams(raw, 'invite');
  if (params === null) {
    // A bare code is read only whole: every invite is 64 hex characters (invites.ts newToken), and a
    // code typed by hand would otherwise be read, and fail, at its 32nd character.
    return /^[0-9a-f]{64}$/i.test(raw) ? { token: raw } : null;
  }
  const query = `&${params}`;
  const m = /[?&#]token=([^&\s#]+)/.exec(query);
  if (m?.[1]) {
    try {
      const token = decodeURIComponent(m[1]);
      if (!/^[0-9a-f]{32,128}$/i.test(token)) return null;
      const org = /[?&#]org=([^&\s#]+)/.exec(query)?.[1];
      return { token, ...(org ? { orgId: decodeURIComponent(org) } : {}) };
    } catch { return null; }
  }
  // A bare token pasted out of a message.
  return null;
}

/**
 * A sign-in key (docs/invites-and-accounts.md flow F): a steward's one-time
 * code that lets a looked-after person choose a new password. Same shape of
 * secret as an invite, a different door.
 */
export function signInUri(code: string, appUrl?: string | null): string {
  const params = `code=${encodeURIComponent(code)}`;
  return appUrl ? `${appUrl}/signin#${params}` : `langquestnext://signin?${params}`;
}

export function parseSignInKey(input: string): { code: string } | null {
  const params = linkParams(input.trim(), 'signin');
  const m = params === null ? null : /(?:^|&)code=([0-9a-f]{64})(?:&|$)/i.exec(params);
  return m?.[1] ? { code: m[1].toLowerCase() } : null;
}

/** Every key the one scanner reads: an invite (link or bare code) or a sign-in key. */
type ScannedKey = { kind: 'invite'; token: string; orgId?: string } | { kind: 'signin'; code: string };

export function parseKey(input: string): ScannedKey | null {
  const signin = parseSignInKey(input);
  if (signin) return { kind: 'signin', ...signin };
  const invite = parseInvite(input);
  return invite ? { kind: 'invite', ...invite } : null;
}
