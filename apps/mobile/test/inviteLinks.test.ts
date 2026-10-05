import { inviteUri, parseInvite, parseKey, parseSignInKey, signInUri } from '../src/inviteCode';

// One https link for invites and sign-in, opened by the app or the web app (decisions.md 54, amended).

const token = 'a'.repeat(32);
const code = 'b'.repeat(64);
const app = 'https://next.langquest.org';

describe('https links', () => {
  it('puts the key after the #, so no server sees it', () => {
    expect(inviteUri('org 1', token, app)).toBe(`${app}/invite#org=org%201&token=${token}`);
    expect(signInUri(code, app)).toBe(`${app}/signin#code=${code}`);
  });

  it('reads both forms, from any of our hosts, and the old scheme', () => {
    expect(parseInvite(inviteUri('org1', token, app))).toEqual({ orgId: 'org1', token });
    expect(parseInvite(inviteUri('org1', token, 'https://next-preview.langquest.org'))).toEqual({ orgId: 'org1', token });
    expect(parseInvite(inviteUri('org1', token))).toEqual({ orgId: 'org1', token });
    expect(parseInvite(`${app}/invite?org=org1&token=${token}`)).toEqual({ orgId: 'org1', token });
    expect(parseSignInKey(signInUri(code, app))).toEqual({ code });
    expect(parseSignInKey(signInUri(code))).toEqual({ code });
    expect(parseKey(signInUri(code, app))).toEqual({ kind: 'signin', code });
  });

  it('is not fooled by other paths, plain http or a short key', () => {
    expect(parseInvite(`${app}/other#token=${token}`)).toBeNull();
    expect(parseInvite(`http://next.langquest.org/invite#token=${token}`)).toBeNull();
    expect(parseInvite(`${app}/invite#token=short`)).toBeNull();
    expect(parseSignInKey(`${app}/#code=${code}`)).toBeNull();
    expect(parseSignInKey(`${app}/signin#code=${code.slice(1)}`)).toBeNull();
  });
});
