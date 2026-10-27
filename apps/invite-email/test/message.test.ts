import { invitationContent, parseCodeMessage, parseMessage, passwordResetContent, verificationCodeContent } from '../src/message';
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

describe('blue check code email (decisions.md 173)', () => {
  const code = {
    requestId: '10000000-0000-0000-0000-000000000002', email: 'Admin@Bible-Society.Example', code: '042917',
    orgName: 'Bible Society', domain: 'bible-society.example', expiresAt: '2026-09-17T12:30:00Z'
  };
  it('takes a code the database made: six digits, half an hour, one address at the domain', () => {
    expect(parseCodeMessage(code, now)).toEqual({ ...code, email: 'admin@bible-society.example', expiresAt: '2026-09-17T12:30:00.000Z' });
    for (const bad of [{ code: '12345' }, { code: '1234567' }, { code: 'abcdef' }, { expiresAt: '2026-09-17T14:00:00Z' },
      { expiresAt: '2026-09-17T11:59:00Z' }, { email: 'a@example.com\r\nBcc: b@example.com' }, { email: 'a@example.com,b@example.com' },
      { orgName: 'Bible\r\nSociety' }, { orgName: ' ' }, { domain: 'https://bible-society.example/' }, { requestId: 'nope' }]) {
      expect(parseCodeMessage({ ...code, ...bad }, now), JSON.stringify(bad)).toBeNull();
    }
  });
  it('says who asked, for which website, the code and how long it works, with nothing unescaped', () => {
    const c = verificationCodeContent(parseCodeMessage({ ...code, orgName: 'Bible <b>Society</b>' }, now)!, now);
    expect(c.subject).toBe('Your LangQuest code: 042917');
    expect(c.text).toContain('Bible <b>Society</b> asked LangQuest for a blue check for the website bible-society.example.');
    expect(c.text).toContain('042917');
    expect(c.text).toContain('The code works for 30 minutes.');
    expect(c.html).toContain('Bible &lt;b&gt;Society&lt;/b&gt;');
    expect(c.html).not.toContain('<b>Society');
  });
  it('is written in the admin\'s language, right to left where it reads that way', () => {
    const fr = verificationCodeContent(parseCodeMessage({ ...code, locale: 'fr' }, now)!, now);
    expect(fr.subject).toBe('Votre code LangQuest : 042917');
    const ar = verificationCodeContent(parseCodeMessage({ ...code, locale: 'ar' }, now)!, now);
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.html).toContain('<strong dir="ltr">042917</strong>');
  });
});
