/**
 * The invite code, as text. Pure: no Expo, no network, so it is testable and
 * the screens and the scanner cannot disagree about what a code is.
 *
 * The QR carries the org and the token so a scanner knows where it is going
 * before it redeems. Parsing is lenient because people forward the code in a
 * message rather than scanning, and an invite that only works from a camera
 * is an invite most of these users cannot accept.
 */
export function inviteUri(orgId: string, token: string): string {
  // Only the org and the token: anything else a link carried (a name, a
  // role, who sent it) would be shown on the scan screen as if it were true,
  // and anyone can edit a link. What the invite grants is the server's, read
  // when it is redeemed.
  return `langquestnext://invite?org=${encodeURIComponent(orgId)}&token=${encodeURIComponent(token)}`;
}

export function parseInvite(input: string): { orgId?: string; token: string } | null {
  const raw = input.trim();
  if (!raw) return null;
  if (!/^langquestnext:\/\/invite\?/.test(raw)) {
    return /^[0-9a-f]{32,128}$/i.test(raw) ? { token: raw } : null;
  }
  const m = /[?&]token=([^&\s]+)/.exec(raw);
  if (m?.[1]) {
    try {
      const token = decodeURIComponent(m[1]);
      if (!/^[0-9a-f]{32,128}$/i.test(token)) return null;
      const org = /[?&]org=([^&\s]+)/.exec(raw)?.[1];
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
export function signInUri(code: string): string {
  return `langquestnext://signin?code=${encodeURIComponent(code)}`;
}

export function parseSignInKey(input: string): { code: string } | null {
  const m = /^langquestnext:\/\/signin\?(?:.*&)?code=([0-9a-f]{64})(?:&|$)/i.exec(input.trim());
  return m?.[1] ? { code: m[1].toLowerCase() } : null;
}

/** Every key the one scanner reads: an invite (link or bare code) or a sign-in key. */
export type ScannedKey = { kind: 'invite'; token: string; orgId?: string } | { kind: 'signin'; code: string };

export function parseKey(input: string): ScannedKey | null {
  const signin = parseSignInKey(input);
  if (signin) return { kind: 'signin', ...signin };
  const invite = parseInvite(input);
  return invite ? { kind: 'invite', ...invite } : null;
}
