import { emailDir, emailLanguage, emailText, fill, formatEmailDate } from './text';

export interface InviteMessage {
  inviteId: string;
  orgId: string;
  token: string;
  email: string;
  expiresAt: string;
  /** The inviter's app language ("es", "zh-Hans"); the email is written in it. English when absent or unknown. */
  locale?: string;
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
    email: p.email.toLowerCase(), expiresAt: new Date(expiry).toISOString(),
    ...(emailLanguage(p.locale) !== 'en' ? { locale: emailLanguage(p.locale) } : {}) };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[c]!);
}

/**
 * The link opens the app on a phone that has it and the web app anywhere
 * else, once `appUrl` names the app's https address (APP_URL in
 * wrangler.jsonc, decisions.md 54, amended); the key rides after the `#`.
 * Without it, the older `langquestnext://` link. Same forms as the app's
 * apps/mobile/src/inviteCode.ts, which reads both.
 */
export function invitationContent(p: InviteMessage, appUrl = '') {
  const params = `org=${encodeURIComponent(p.orgId)}&token=${encodeURIComponent(p.token)}`;
  const base = appUrl.replace(/\/$/, '');
  const link = base ? `${base}/invite#${params}` : `langquestnext://invite?${params}`;
  const lang = p.locale ?? 'en';
  const w = emailText(lang).invite;
  const date = formatEmailDate(p.expiresAt, lang);
  const dir = emailDir(lang);
  return {
    subject: w.subject,
    text: `${w.intro}\n\n${base ? w.openLink : w.openLinkOnPhone}\n${link}`
      + `\n\n${fill(w.orPasteCode, { screen: w.joinScreen })}\n${p.token}`
      + `\n\n${fill(w.expires, { date })}`
      + `\n\n${w.ignore}`,
    html: `<div dir="${dir}" lang="${escapeHtml(lang)}">`
      + `<h1>${escapeHtml(w.heading)}</h1>`
      + `<p>${escapeHtml(w.intro)}</p>`
      + `<p><a href="${escapeHtml(link)}">${escapeHtml(base ? w.openButton : w.openButtonOnPhone)}</a></p>`
      + `<p>${fill(escapeHtml(w.orPasteCode), { screen: `<strong>${escapeHtml(w.joinScreen)}</strong>` })}</p>`
      + `<p><code dir="ltr">${escapeHtml(p.token)}</code></p>`
      + `<p>${escapeHtml(fill(w.expires, { date }))}</p>`
      + `<p>${escapeHtml(w.ignore)}</p>`
      + '</div>'
  };
}

/**
 * The email that lets someone choose a new password, in the language their
 * app showed when they asked. Not sent yet: Forgot password waits for deep
 * links (docs/invites-and-accounts.md); this is its words, ready for it.
 */
export function passwordResetContent(p: { email: string; link: string; minutes: number; locale?: string }) {
  const lang = emailLanguage(p.locale);
  const w = emailText(lang).reset;
  const intro = fill(w.intro, { email: p.email });
  const expires = fill(w.expires, { minutes: new Intl.NumberFormat(lang === 'pt' ? 'pt-BR' : lang).format(p.minutes) });
  return {
    subject: w.subject,
    text: `${intro}\n\n${w.openButton}:\n${p.link}\n\n${expires}\n\n${w.ignore}`,
    html: `<div dir="${emailDir(lang)}" lang="${escapeHtml(lang)}">`
      + `<h1>${escapeHtml(w.heading)}</h1>`
      + `<p>${escapeHtml(intro)}</p>`
      + `<p><a href="${escapeHtml(p.link)}">${escapeHtml(w.openButton)}</a></p>`
      + `<p>${escapeHtml(expires)}</p>`
      + `<p>${escapeHtml(w.ignore)}</p>`
      + '</div>'
  };
}
