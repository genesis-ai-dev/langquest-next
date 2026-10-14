import { t } from '../src/i18n';
import { listingFailure, looksLikeEmail, sendFailure, signInFailure } from '../src/org/model';

describe('the organization screens\' refusals, in words', () => {
  it('the Explore listing: refused, or no connection', () => {
    expect(listingFailure({ code: '42501' })).toBe(t('org.listing.notAllowed'));
    expect(listingFailure({})).toBe(t('common.tryWhenConnected'));
  });

  it('an invite email, by the send-invite function\'s status', () => {
    expect(sendFailure(503)).toBe(t('org.invite.emailNotSetUp'));
    expect(sendFailure(409)).toBe(t('org.invite.emailPending'));
    expect(sendFailure(403)).toBe(t('org.invite.emailUnavailable'));
    expect(sendFailure(0)).toBe(t('common.tryWhenConnected'));
    expect(sendFailure(500)).toBe(t('org.invite.emailRetry'));
  });

  it('a sign-in code the server would not make', () => {
    expect(signInFailure(new Error('not allowed to help'))).toBe(t('org.signIn.notAllowed'));
    expect(signInFailure(new Error('fetch failed'))).toBe(t('common.tryWhenConnected'));
  });

  it('an address worth trying to send to', () => {
    expect(looksLikeEmail(' ana@x.org ')).toBe(true);
    expect(looksLikeEmail('ana@x')).toBe(false);
    expect(looksLikeEmail('ana')).toBe(false);
  });
});
