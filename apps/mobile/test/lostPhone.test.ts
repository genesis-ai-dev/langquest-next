// "A phone of mine was lost or taken" (decisions.md 200, docs/nearby-sync-plan.md section 6):
// New password sends `lost` only when it is on, and More settings' row is for email accounts.
import { lostPhoneRowShown, newPasswordBody } from '../src/auth/model';

const sent: unknown[] = [];
vi.mock('../src/server/auth', () => ({
  passwordReset: async (body: unknown) => {
    sent.push(body);
    return { data: { email: 'ana@x.org', userId: 'u1' }, error: null };
  }
}));
vi.mock('../src/i18n', () => ({ currentLanguage: () => 'en' }));

describe('a lost or taken phone', () => {
  beforeEach(() => { sent.length = 0; });

  it('New password sends lost only when the choice is on', () => {
    expect(newPasswordBody('c0de', 'secret1', false)).toEqual({ code: 'c0de', password: 'secret1' });
    expect(newPasswordBody('c0de', 'secret1', true)).toEqual({ code: 'c0de', password: 'secret1', lost: true });
  });

  it('the call to password-reset carries lost, and leaves it out when off, as builds before it did', async () => {
    const { chooseNewPassword } = await import('../src/auth/passwordReset');
    await chooseNewPassword('c0de', 'secret1', true);
    await chooseNewPassword('c0de', 'secret1');
    expect(sent).toEqual([{ code: 'c0de', password: 'secret1', lost: true }, { code: 'c0de', password: 'secret1' }]);
    expect(Object.keys(sent[1] as object)).not.toContain('lost');
  });

  it('More settings offers the row to an account with its own email only', () => {
    expect(lostPhoneRowShown({ isManaged: false, email: 'ana@x.org' })).toBe(true);
    expect(lostPhoneRowShown({ isManaged: true, email: 'akol-3@managed.langquest.org' })).toBe(false);
    expect(lostPhoneRowShown({ isManaged: false, email: null })).toBe(false);
  });
});
