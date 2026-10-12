import { invitationContent, parseMessage, passwordResetContent } from '../src/message';
import { EMAIL_CATALOGS } from '../src/text';

const now = Date.parse('2026-09-17T12:00:00Z');
const invitation = {
  inviteId: '10000000-0000-0000-0000-000000000001',
  orgId: 'team-one', token: 'a'.repeat(64), email: 'Person@Example.com',
  expiresAt: '2026-09-18T12:00:00Z'
};

describe('invitation email content', () => {
  it('normalizes valid delivery details', () => {
    expect(parseMessage(invitation, now)).toEqual({ ...invitation,
      email: 'person@example.com', expiresAt: '2026-09-18T12:00:00.000Z' });
  });
  it('rejects expired, invalid, and excessively long-lived invites', () => {
    for (const expiresAt of ['2026-09-16', 'invalid', '2028-01-01']) {
      expect(parseMessage({ ...invitation, expiresAt }, now)).toBeNull();
    }
    expect(parseMessage({ ...invitation, token: 'not-an-invite' }, now)).toBeNull();
    expect(parseMessage(null, now)).toBeNull();
  });
  it('rejects email header injection and multiple recipients', () => {
    for (const email of ['a@example.com\r\nBcc: b@example.com',
      'a@example.com,b@example.com', '<a@example.com>']) {
      expect(parseMessage({ ...invitation, email }, now)).toBeNull();
    }
  });
  it('provides a code fallback in both formats without HTML injection', () => {
    const content = invitationContent({ ...invitation,
      orgId: '\"><img src=x onerror=alert(1)>' });
    expect(content.text).toContain(invitation.token);
    expect(content.html).toContain(invitation.token);
    expect(content.html).not.toContain('<img');
    expect(content.html).toContain('&amp;token=');
    expect(content.html).toContain('langquestnext://invite?org=');
  });
  it('links to the app\'s https address once it has one, with the key after the #', () => {
    const content = invitationContent(invitation, 'https://next.langquest.org/');
    expect(content.text).toContain(`https://next.langquest.org/invite#org=${encodeURIComponent(invitation.orgId)}&token=${invitation.token}`);
    expect(content.html).toContain('>Open LangQuest</a>');
    expect(content.html).not.toContain('langquestnext://');
  });
});

describe('emails in the sender’s language (LAN-42)', () => {
  it('keeps a known language and drops anything else', () => {
    expect(parseMessage({ ...invitation, locale: 'es' }, now)?.locale).toBe('es');
    expect(parseMessage({ ...invitation, locale: 'zh-Hans' }, now)?.locale).toBe('zh-Hans');
    expect(parseMessage({ ...invitation, locale: 'en' }, now)).not.toHaveProperty('locale');
    expect(parseMessage({ ...invitation, locale: 'xx<script>' }, now)).not.toHaveProperty('locale');
  });
  it('writes the date for the language and lays Arabic out right to left', () => {
    const english = invitationContent(invitation);
    expect(english.text).toContain('This invite expires on September 18, 2026.');
    const arabic = invitationContent({ ...invitation, locale: 'ar' });
    expect(arabic.html).toContain('dir="rtl"');
    expect(arabic.html).toContain('<code dir="ltr">');
  });
  it('has the same words in every language as in English', () => {
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [k] : keys(v).map((kk) => `${k}.${kk}`))).sort();
    const want = keys(EMAIL_CATALOGS.en!);
    for (const [code, catalog] of Object.entries(EMAIL_CATALOGS)) expect(keys(catalog), code).toEqual(want);
  });
  it('says how to choose a new password, with the address escaped', () => {
    const reset = passwordResetContent({ email: 'a<b>@example.com', link: 'https://next.langquest.org/reset#t=1', minutes: 60 });
    expect(reset.subject).toBe('Choose a new LangQuest password');
    expect(reset.text).toContain('This link works for 60 minutes.');
    expect(reset.html).not.toContain('a<b>');
  });
});
