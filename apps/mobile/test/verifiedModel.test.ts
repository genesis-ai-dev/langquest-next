import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  codeOf, domainProblem, emailProblem, isPublicEmailDomain, maskedEmail, normalizeDomain, PUBLIC_EMAIL_DOMAINS, stageOf, suggestedEmail,
  type VerificationState
} from '../src/verified/model';

const migration = readFileSync(join(__dirname, '../../../supabase/migrations/20261027000000_verified_organizations.sql'), 'utf8');

describe('a blue check: what an admin types (decisions.md 173)', () => {
  it('turns what someone pastes for their website into a domain', () => {
    expect(normalizeDomain('https://www.UnfoldingWord.org/about?x=1')).toBe('unfoldingword.org');
    expect(normalizeDomain('  wordcollective.com.  ')).toBe('wordcollective.com');
    expect(normalizeDomain('http://fia.bible:8080/')).toBe('fia.bible');
    expect(normalizeDomain('door43.org')).toBe('door43.org');
  });

  it('refuses what the database refuses: no host, or a free email service', () => {
    expect(domainProblem('unfoldingword.org')).toBeNull();
    expect(domainProblem('localhost')).toBe('bad_domain');
    expect(domainProblem('-bad-.org')).toBe('bad_domain');
    for (const d of ['gmail.com', 'yahoo.co.uk', 'hotmail.fr', 'outlook.de', 'people.langquest.org']) expect(domainProblem(d), d).toBe('public_domain');
  });

  it('takes an address at the domain or under it, and no other', () => {
    expect(emailProblem('ana@unfoldingword.org', 'unfoldingword.org')).toBeNull();
    expect(emailProblem('ana@mail.unfoldingword.org', 'unfoldingword.org')).toBeNull();
    expect(emailProblem('ana@notunfoldingword.org', 'unfoldingword.org')).toBe('email_not_at_domain');
    expect(emailProblem('ana@gmail.com', 'unfoldingword.org')).toBe('email_not_at_domain');
    expect(emailProblem('ana', 'unfoldingword.org')).toBe('bad_email');
  });

  it('suggests the admin\'s own sign-in address only where it is at the domain', () => {
    expect(suggestedEmail('Ana@UnfoldingWord.org', 'unfoldingword.org')).toBe('ana@unfoldingword.org');
    expect(suggestedEmail('ana@gmail.com', 'unfoldingword.org')).toBe('');
    expect(suggestedEmail(null, 'unfoldingword.org')).toBe('');
  });

  it('reads six digits however they are typed', () => {
    expect(codeOf('042 917')).toBe('042917');
    expect(codeOf('042-917')).toBe('042917');
    expect(codeOf('04291')).toBeNull();
    expect(codeOf('abcdef')).toBeNull();
  });

  it('shows the address the code went to without spelling it out', () => {
    expect(maskedEmail('ana@unfoldingword.org')).toBe('a…@unfoldingword.org');
  });

  it('holds the same free email services as the database', () => {
    const list = /array\[([\s\S]*?)\]\)/.exec(migration.slice(migration.indexOf('_public_email_domain')))![1]!;
    const inSql = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(inSql.sort()).toEqual([...PUBLIC_EMAIL_DOMAINS].sort());
    for (const family of ['yahoo', 'hotmail', 'outlook']) expect(migration).toContain(`'^${family}\\.[a-z.]+$'`);
    expect(isPublicEmailDomain('yahoo.com.br')).toBe(true);
  });
});

describe('where a request stands', () => {
  const at = Date.parse('2026-10-27T12:00:00Z');
  const request = (r: Partial<NonNullable<VerificationState['request']>>): VerificationState => ({
    verified: null,
    request: { status: 'confirming', domain: 'unfoldingword.org', email: 'ana@unfoldingword.org', codeSentAt: null, codeExpiresAt: null,
      canSendAgainAt: null, confirmedAt: null, decidedAt: null, createdAt: '2026-10-27T11:00:00Z', ...r }
  });
  it('verified wins; then waiting; a live code; turned down; else the form', () => {
    expect(stageOf({ verified: { domain: 'unfoldingword.org', grantedAt: '2026-10-27T00:00:00Z' }, request: null }, at)).toBe('verified');
    expect(stageOf(request({ status: 'waiting' }), at)).toBe('waiting');
    expect(stageOf(request({ codeExpiresAt: '2026-10-27T12:20:00Z' }), at)).toBe('code');
    expect(stageOf(request({ codeExpiresAt: '2026-10-27T11:50:00Z' }), at)).toBe('ask');
    expect(stageOf(request({ status: 'declined' }), at)).toBe('declined');
    expect(stageOf(request({ status: 'withdrawn' }), at)).toBe('ask');
    expect(stageOf(null, at)).toBe('ask');
  });
});
