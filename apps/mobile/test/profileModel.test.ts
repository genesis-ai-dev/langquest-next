// Edit Profile's email and password (LAN-304,
// docs/decisions/2026-11-18-edit-profile-holds-email-and-password.md): what
// Save does with the fields, and what the screen says about signing in.
import { emailEdit, emailErrorText, ownEmail, passwordRequired, saveProblem, savedText, signInLine, type EmailEdit } from '../src/account/profileModel';
import { t } from '../src/i18n';

const KEPT = 'nyibol-482@people.langquest.org';
const OWN = 'ana@example.org';

/** saveProblem with the quiet defaults: nothing typed, the email as it is, a password held. */
const problem = (p: { edit?: EmailEdit; password?: string; confirm?: string; hasPassword?: boolean | null }) =>
  saveProblem({ edit: p.edit ?? { kind: 'same' }, password: p.password ?? '', confirm: p.confirm ?? '', hasPassword: p.hasPassword === undefined ? true : p.hasPassword });

describe('Edit Profile\'s email', () => {
  it('starts with the account\'s own email, and empty for a looked-after account, whose address nobody can use', () => {
    expect(ownEmail(OWN)).toBe(OWN);
    expect(ownEmail(KEPT)).toBe('');
    expect(ownEmail(null)).toBe('');
  });

  it('changes nothing while the field holds the address the account has, however it is typed', () => {
    expect(emailEdit(OWN, OWN)).toEqual({ kind: 'same' });
    expect(emailEdit('  Ana@Example.ORG ', OWN)).toEqual({ kind: 'same' });
    // A looked-after account that leaves the field empty keeps its sign-in name.
    expect(emailEdit('', KEPT)).toEqual({ kind: 'same' });
    expect(emailEdit('  ', KEPT)).toEqual({ kind: 'same' });
  });

  it('adds or changes an address, kept in lower case without spaces, with nothing to prove it (as at sign-up)', () => {
    expect(emailEdit(' Nyibol@Mail.example ', KEPT)).toEqual({ kind: 'change', address: 'nyibol@mail.example' });
    expect(emailEdit('ana.new@example.org', OWN)).toEqual({ kind: 'change', address: 'ana.new@example.org' });
  });

  it('refuses what is not an address, and a looked-after address, which the server makes and nobody chooses', () => {
    for (const typed of ['ana', 'ana@', 'ana@example', '@example.org', 'ana @example.org', `${'a'.repeat(250)}@x.org`]) {
      expect(emailEdit(typed, OWN), typed).toEqual({ kind: 'bad' });
    }
    expect(emailEdit('someone-123@people.langquest.org', KEPT)).toEqual({ kind: 'bad' });
    expect(problem({ edit: { kind: 'bad' } })).toBe(t('entry.errors.badEmail'));
  });

  it('keeps an own email: clearing it is refused, since an account with an email cannot go back to none', () => {
    expect(emailEdit('', OWN)).toEqual({ kind: 'empty' });
    expect(problem({ edit: { kind: 'empty' } })).toBe(t('account.profile.emailRequired'));
    expect(problem({ edit: { kind: 'same' } })).toBe('');
    expect(problem({ edit: { kind: 'change', address: OWN } })).toBe('');
  });

  it('says why the server refused, in words, and never the server\'s English', () => {
    expect(emailErrorText('offline')).toBe(t('account.profile.emailNeedsConnection'));
    expect(emailErrorText('email_exists')).toBe(t('account.profile.emailTaken'));
    expect(emailErrorText('validation_failed')).toBe(t('entry.errors.badEmail'));
    expect(emailErrorText('session_not_found')).toBe(t('entry.errors.sessionEnded'));
    expect(emailErrorText('password_required')).toBe(t('account.profile.passwordWithEmail'));
    expect(emailErrorText('unavailable')).toBe(t('account.profile.emailFailed'));
    expect(emailErrorText('Another account already uses this email.')).toBe(t('account.profile.emailFailed'));
  });
});

describe('Edit Profile\'s password, for every account', () => {
  it('refuses fewer than 6 characters, and nothing typed is no change', () => {
    expect(problem({})).toBe('');
    expect(problem({ password: 'abc12', confirm: 'abc12' })).toBe(t('account.profile.shortPassword'));
    expect(problem({ password: 'abc123', confirm: 'abc123' })).toBe('');
  });

  it('is typed twice, as on Create Account and New password, and the two must match', () => {
    expect(problem({ password: 'abc123', confirm: '' })).toBe(t('entry.createAccount.mismatch'));
    expect(problem({ password: 'abc123', confirm: 'abc124' })).toBe(t('entry.createAccount.mismatch'));
    // Too short is said first: the confirmation cannot fix that.
    expect(problem({ password: 'abc', confirm: 'abd' })).toBe(t('account.profile.shortPassword'));
  });

  it('comes with the first email of an account that has none, since helpers\' codes stop then', () => {
    const add: EmailEdit = { kind: 'change', address: 'nyibol@mail.example' };
    expect(passwordRequired(add, false)).toBe(true);
    expect(problem({ edit: add, hasPassword: false })).toBe(t('account.profile.passwordWithEmail'));
    expect(problem({ edit: add, hasPassword: false, password: 'kept-pass-1', confirm: 'kept-pass-1' })).toBe('');
    // An account with a password changes its email alone; not yet read, the server decides.
    expect(passwordRequired(add, true)).toBe(false);
    expect(problem({ edit: add, hasPassword: true })).toBe('');
    expect(passwordRequired(add, null)).toBe(false);
    // Nothing to require while no email is being added.
    expect(passwordRequired({ kind: 'same' }, false)).toBe(false);
  });

  it('says what they sign in with: the address being saved, their own email, or the sign-in name to write down', () => {
    expect(signInLine(KEPT, { kind: 'same' })).toBe(t('account.profile.signInWith', { name: 'nyibol-482' }));
    expect(signInLine(OWN, { kind: 'same' })).toBe(t('account.profile.signInWithEmail', { email: OWN }));
    expect(signInLine(KEPT, { kind: 'change', address: 'nyibol@mail.example' })).toBe(t('account.profile.signInWithEmail', { email: 'nyibol@mail.example' }));
    expect(signInLine(null, { kind: 'same' })).toBe('');
  });
});

describe('the toast after Save', () => {
  const same = { kind: 'same' } as const;
  const change = { kind: 'change', address: 'nyibol@mail.example' } as const;
  it('names what the person signs in with when that changed', () => {
    expect(savedText({ current: OWN, edit: same, password: false })).toBe(t('account.profile.saved'));
    expect(savedText({ current: KEPT, edit: same, password: true })).toBe(t('account.profile.savedWithPassword', { name: 'nyibol-482' }));
    expect(savedText({ current: OWN, edit: same, password: true })).toBe(t('account.profile.savedWithPassword', { name: OWN }));
    expect(savedText({ current: KEPT, edit: change, password: true })).toBe(t('account.profile.savedWithPassword', { name: 'nyibol@mail.example' }));
    expect(savedText({ current: OWN, edit: change, password: false })).toBe(t('account.profile.savedWithEmail', { email: 'nyibol@mail.example' }));
  });
});
