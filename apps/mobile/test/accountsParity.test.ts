import { MANAGED_DOMAIN as SERVER_DOMAIN, makeSignInName as serverName } from '../../../supabase/functions/_shared/accounts';
import { MANAGED_DOMAIN, makeSignInName } from '../src/accounts';

// The `join` Edge Function makes sign-in names on the server and the app
// reads them back on Sign In: one rule, written twice because Edge Functions
// cannot import the app (docs/invites-and-accounts.md).
describe('sign-in names: the server and the app agree', () => {
  it('uses the same domain', () => {
    expect(SERVER_DOMAIN).toBe(MANAGED_DOMAIN);
  });

  it.each([
    ['Nyibol Deng', 482],
    ['Achol Mabior', 7],
    ['  Gatkuoth   Riek ', 999],
    ['Ñandú Pérez-López', 12],
    ['ሰላም', 3],
    ['', 1000],
    ['A very long name that goes on past the limit', 55]
  ])('%s', (name, digits) => {
    expect(serverName(name, digits)).toBe(makeSignInName(name, digits));
  });

  it('widens to more digits when three keep clashing', () => {
    expect(makeSignInName('Kept Person', 1234567, 5)).toBe('kept-person-34567');
    expect(serverName('Kept Person', 1234567, 5)).toBe(makeSignInName('Kept Person', 1234567, 5));
    expect(makeSignInName('Kept Person', 7, 5)).toBe('kept-person-00007');
  });
});
