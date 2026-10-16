import { t } from '../src/i18n';
import { liveRoles, listingFailure, looksLikeEmail, sendFailure, signInFailure } from '../src/org/model';

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

  it('lists the roles still in use, the most privileged first, then by name, and none for an organization not yet read', () => {
    const role = (name: string, privileges: number, retired = false) =>
      ({ retired, name: { value: name }, privileges: { value: Array.from({ length: privileges }, (_, i) => i) } });
    expect(liveRoles(undefined)).toEqual([]);
    expect(liveRoles({ b: role('Beta', 2), a: role('Alpha', 2), gone: role('Old', 9, true), top: role('Top', 5), bare: { name: { value: '' }, privileges: { value: null } } }))
      .toEqual([
        { id: 'top', name: 'Top', privileges: 5 },
        { id: 'a', name: 'Alpha', privileges: 2 },
        { id: 'b', name: 'Beta', privileges: 2 },
        { id: 'bare', name: 'bare', privileges: 0 }
      ]);
  });
});
