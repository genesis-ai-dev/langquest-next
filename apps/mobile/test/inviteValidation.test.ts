import { inviteUri, parseInvite } from '../src/invites/inviteCode';

describe('invite codes', () => {
  const token = 'a'.repeat(64); // as invites.ts newToken makes them

  it('puts only the org and the token in the link', () => {
    // Why: the scan screen would show anything else a link carried as fact,
    // and a link can be edited by whoever forwards it.
    expect(inviteUri('org1', token)).toBe(`langquestnext://invite?org=org1&token=${token}`);
  });

  it('round-trips the link it renders into the QR', () => {
    const parsed = parseInvite(inviteUri('org1', token));
    expect(parsed).toEqual({ orgId: 'org1', token });
  });

  it('accepts a bare token pasted out of a message', () => {
    // Why: people forward the code in chat, not the whole deep link, and an
    // invite that only works from a scanner is an invite most people cannot use.
    expect(parseInvite(`  ${token}  `)).toEqual({ token });
    // Typed by hand, a code is not read half way (it would be refused at its 32nd character).
    expect(parseInvite(token.slice(0, 32))).toBeNull();
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

  it('reads https links only at the app\'s own addresses', () => {
    const at = (host: string) => `https://${host}/invite#org=org1&token=${token}`;
    expect(parseInvite(at('next.langquest.org'))).toEqual({ token, orgId: 'org1' });
    expect(parseInvite(at('next-preview.langquest.org'))).toEqual({ token, orgId: 'org1' });
    expect(parseInvite(at('Next.LangQuest.org'))).toEqual({ token, orgId: 'org1' });
    for (const host of ['example.com', 'next.langquest.org.evil.example', 'evil.example@next.langquest.org', 'langquest.org']) {
      expect(parseInvite(at(host)), host).toBeNull();
    }
  });
});
