export interface InviteMessage {
  inviteId: string;
  orgId: string;
  token: string;
  email: string;
  expiresAt: string;
}

export function parseMessage(input: unknown, now = Date.now()): InviteMessage | null {
  if (!input || typeof input !== 'object') return null;
  const p = input as Record<string, unknown>;
  if (typeof p.inviteId !== 'string' || !/^[\da-f-]{36}$/i.test(p.inviteId)
    || typeof p.orgId !== 'string' || !p.orgId || p.orgId.length > 200
    || typeof p.token !== 'string' || !/^[\da-f]{32,128}$/i.test(p.token)
    || typeof p.email !== 'string' || p.email.length > 254
    || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(p.email)
    || typeof p.expiresAt !== 'string') return null;
  const expiry = Date.parse(p.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now
    || expiry > now + 91 * 86_400_000) return null;
  return { inviteId: p.inviteId, orgId: p.orgId, token: p.token,
    email: p.email.toLowerCase(), expiresAt: new Date(expiry).toISOString() };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[c]!);
}

export function invitationContent(p: InviteMessage) {
  const link = `langquestnext://invite?org=${encodeURIComponent(p.orgId)}`
    + `&token=${encodeURIComponent(p.token)}`;
  return {
    subject: 'Your LangQuest invitation',
    text: `You have been invited to LangQuest.\n\nOpen this link on your phone:\n${link}`
      + `\n\nOr paste this code in Join with an invite:\n${p.token}`
      + `\n\nThis invite expires ${p.expiresAt}.`
      + '\n\nIf you did not expect this invitation, you can ignore it.',
    html: '<h1>Your LangQuest invitation</h1>'
      + '<p>You have been invited to join a team in LangQuest.</p>'
      + `<p><a href="${escapeHtml(link)}">Open LangQuest on your phone</a></p>`
      + '<p>Or open <strong>Join with an invite</strong> and paste this code:</p>'
      + `<p><code>${escapeHtml(p.token)}</code></p>`
      + `<p>This invite expires ${escapeHtml(p.expiresAt)}.</p>`
      + '<p>If you did not expect this invitation, you can ignore it.</p>'
  };
}
