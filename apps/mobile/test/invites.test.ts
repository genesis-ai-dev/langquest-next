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
});
