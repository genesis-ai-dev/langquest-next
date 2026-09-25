import { describe, expect, it } from 'vitest';
import { parseRecoveryLink, recoveryRedirect } from '../src/recoveryLink';

describe('untrusted recovery deep links', () => {
  const fragment = '#type=recovery&access_token=access&refresh_token=refresh';
  it('accepts the registered recovery URL and both required session tokens', () => {
    expect(parseRecoveryLink(recoveryRedirect + fragment)).toEqual({
      accessToken: 'access', refreshToken: 'refresh'
    });
  });
  it('accepts a PKCE code on the registered recovery URL', () => {
    expect(parseRecoveryLink(recoveryRedirect + '?code=one-time-code'))
      .toEqual({ code: 'one-time-code' });
  });
  it.each([
    'https://attacker.example/auth/recovery',
    'langquestnext://attacker/recovery',
    'langquestnext://auth/invite',
    'langquestnext://auth/recovery/extra'
  ])('does not create a session for the unrelated target %s', (target) => {
    expect(parseRecoveryLink(target + fragment)).toBeNull();
  });
  it('does not treat signup or invite credentials as recovery', () => {
    expect(parseRecoveryLink(recoveryRedirect + fragment.replace('recovery', 'signup'))).toBeNull();
  });
  it('rejects incomplete credentials without manufacturing a session', () => {
    expect(() => parseRecoveryLink(recoveryRedirect + '#type=recovery&access_token=access'))
      .toThrow('incomplete');
  });
  it('reports an expired recovery link', () => {
    expect(() => parseRecoveryLink(recoveryRedirect + '#error=access_denied&error_code=otp_expired'))
      .toThrow('expired');
  });
});
