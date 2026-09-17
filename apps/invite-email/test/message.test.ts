import { invitationContent, parseMessage } from '../src/message';

const now = Date.parse('2026-09-17T12:00:00Z');
const invitation = {
  inviteId: '10000000-0000-0000-0000-000000000001',
  orgId: 'team-one', token: 'a'.repeat(64), email: 'Person@Example.com',
  expiresAt: '2026-09-18T12:00:00Z'
};

describe('invitation email content', () => {
  it('normalizes valid delivery details', () => {
    expect(parseMessage(invitation, now)).toEqual({ ...invitation,
      email: 'person@example.com', expiresAt: '2026-09-18T12:00:00.000Z' });
  });
  it('rejects expired, invalid, and excessively long-lived invites', () => {
    for (const expiresAt of ['2026-09-16', 'invalid', '2028-01-01']) {
      expect(parseMessage({ ...invitation, expiresAt }, now)).toBeNull();
    }
    expect(parseMessage({ ...invitation, token: 'not-an-invite' }, now)).toBeNull();
    expect(parseMessage(null, now)).toBeNull();
  });
  it('rejects email header injection and multiple recipients', () => {
    for (const email of ['a@example.com\r\nBcc: b@example.com',
      'a@example.com,b@example.com', '<a@example.com>']) {
      expect(parseMessage({ ...invitation, email }, now)).toBeNull();
    }
  });
  it('provides a code fallback in both formats without HTML injection', () => {
    const content = invitationContent({ ...invitation,
      orgId: '\"><img src=x onerror=alert(1)>' });
    expect(content.text).toContain(invitation.token);
    expect(content.html).toContain(invitation.token);
    expect(content.html).not.toContain('<img');
    expect(content.html).toContain('&amp;token=');
    expect(content.html).toContain('langquestnext://invite?org=');
  });
});
