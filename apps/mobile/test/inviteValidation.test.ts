import { inviteUri, parseInvite } from '../src/inviteCode';

describe('invite codes', () => {
  const token = 'a'.repeat(48);

  it('round-trips the link it renders into the QR', () => {
    const parsed = parseInvite(inviteUri('org1', token));
    expect(parsed).toEqual({ orgId: 'org1', token });
  });

  it('accepts a bare token pasted out of a message', () => {
    // Why: people forward the code in chat, not the whole deep link, and an
    // invite that only works from a scanner is an invite most people cannot use.
    expect(parseInvite(`  ${token}  `)).toEqual({ token });
  });

  it('survives an org id that needs escaping', () => {
    const parsed = parseInvite(inviteUri('org one/two', token));
    expect(parsed?.orgId).toBe('org one/two');
  });

  it('refuses text that is not an invite rather than sending it to the server', () => {
    for (const junk of ['', '   ', 'hello', 'https://example.com', 'abc123']) {
      expect(parseInvite(junk), junk).toBeNull();
    }
  });

  it('returns null for a malformed percent escape instead of throwing', () => {
    const input = 'https://example.com/invite?org=%E0%A4%A&token=abc';
    expect(() => parseInvite(input)).not.toThrow();
    expect(parseInvite(input)).toBeNull();
  });

  it('returns null for a non-invite https URL with a token query', () => {
    expect(parseInvite(`https://example.com/not-invite?token=${token}`)).toBeNull();
  });
});
