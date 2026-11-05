// A blue check for an organization (decisions.md 173): what an admin types,
// checked as the database checks it (supabase/migrations/
// 20261027000000_verified_organizations.sql), so the form says what is wrong
// before anything is sent. Pure, so it is tested (test/verifiedModel.test.ts).

/** Free email services: an address there proves nothing about an organization. The SQL holds the same list. */
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net',
  'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'qq.com', '163.com', '126.com', 'naver.com',
  'hey.com', 'fastmail.com', 'tutanota.com', 'people.langquest.org'
];
const PUBLIC_FAMILIES = [/^yahoo\.[a-z.]+$/, /^hotmail\.[a-z.]+$/, /^outlook\.[a-z.]+$/];

const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.includes(domain) || PUBLIC_FAMILIES.some((r) => r.test(domain));
}

/**
 * What someone types for their website, as a domain: "https://www.UnfoldingWord.org/about"
 * is "unfoldingword.org". The leading "www." goes, since an organization's email is at the bare domain.
 */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  d = d.replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (d.startsWith('www.')) d = d.slice(4);
  return d;
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** What is wrong with a domain, as the database would answer; null when it would be taken. */
export function domainProblem(domain: string): 'bad_domain' | 'public_domain' | null {
  if (domain.length < 4 || domain.length > 253 || !HOST.test(domain)) return 'bad_domain';
  if (isPublicEmailDomain(domain)) return 'public_domain';
  return null;
}

/** What is wrong with the address for this domain; null when it is at the domain or under it. */
export function emailProblem(email: string, domain: string): 'bad_email' | 'email_not_at_domain' | null {
  if (email.length < 6 || email.length > 254 || !/^[^\s@<>]+@[a-z0-9.-]+$/.test(email)) return 'bad_email';
  const at = email.slice(email.indexOf('@') + 1);
  return at === domain || at.endsWith(`.${domain}`) ? null : 'email_not_at_domain';
}

/** Six digits, as typed with spaces or a dash ("042 917"); null until it is six. */
export function codeOf(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** The address at the domain an admin probably means: their own sign-in address when it is there. */
export function suggestedEmail(signInEmail: string | null | undefined, domain: string): string {
  const e = normalizeEmail(signInEmail ?? '');
  return domain && !domainProblem(domain) && !emailProblem(e, domain) ? e : '';
}

/** Where a request stands, as the sheet shows it. */
export type VerificationStage = 'verified' | 'ask' | 'code' | 'waiting' | 'declined';

export interface VerificationState {
  verified: { domain: string; grantedAt: string } | null;
  request: {
    status: 'confirming' | 'waiting' | 'granted' | 'declined' | 'withdrawn';
    domain: string; email: string; codeSentAt: string | null; codeExpiresAt: string | null; canSendAgainAt: string | null;
    confirmedAt: string | null; decidedAt: string | null; createdAt: string;
  } | null;
}

/** The step to show: verified, a code to type (a live one was sent), waiting for LangQuest, turned down, or the form. */
export function stageOf(s: VerificationState | null, now = Date.now()): VerificationStage {
  if (s?.verified) return 'verified';
  const r = s?.request;
  if (r?.status === 'waiting') return 'waiting';
  if (r?.status === 'confirming' && r.codeExpiresAt && Date.parse(r.codeExpiresAt) > now) return 'code';
  if (r?.status === 'declined') return 'declined';
  return 'ask';
}

/** "j…@unfoldingword.org": enough to recognise the address the code went to. */
export function maskedEmail(email: string): string {
  const at = email.indexOf('@');
  return at <= 1 ? email : `${email[0]}…${email.slice(at)}`;
}
