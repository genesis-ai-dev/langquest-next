import { deriveSession } from '../src/session';
import { claim, deadMessage, HOLD_MS, holdScanned, inviteCard, nextStep, outcomeOfError, type HeldInvite } from '../src/heldInvite';
import { inviteUri, parseKey, signInUri } from '../src/inviteCode';
import { isManagedEmail, makeSignInName, MANAGED_DOMAIN, signInAddress, signInName } from '../src/accounts';

/**
 * The situations of docs/invites-and-accounts.md section 6, as the held
 * invite sees them. Each test is one row of that table.
 */
const token = 'c'.repeat(64);
const t0 = 1_790_000_000_000;
const scanned = (now = t0): HeldInvite => holdScanned(null, { token, orgId: 'org-r' }, now);

describe('the held invite', () => {
  it('signed out, new person: the account they create joins, with no second Join', () => {
    // Why: Caleb had to find the invite again and tap Join after signing up.
    const held = claim(scanned(), 'next-account');
    expect(nextStep(held, null, t0 + 1000)).toEqual({ step: 'none' });
    const step = nextStep(held, 'caleb', t0 + 60_000);
    expect(step.step).toBe('redeem');
    // Bound to that account, so a later sign-in by someone else cannot take it.
    if (step.step === 'redeem') expect(step.held.claim).toEqual({ kind: 'account', actorId: 'caleb' });
  });

  it('leaving the scan screen loses nothing: the invite is held, not the screen', () => {
    // Whatever screens come and go, the decision reads only the held invite and who is signed in.
    const held = claim(scanned(), 'next-account');
    const again = JSON.parse(JSON.stringify(held)) as HeldInvite; // restored from storage after a restart
    expect(nextStep(again, 'caleb', t0 + 5 * 60_000)).toEqual(nextStep(held, 'caleb', t0 + 5 * 60_000));
  });

  it('an unclaimed invite never joins on its own: the signed-in person is asked', () => {
    // Why: on a shared phone the person signed in may not be the one the invite is for.
    expect(nextStep(scanned(), 'ayen', t0 + 1000)).toEqual({ step: 'ask', held: scanned() });
  });

  it('an invite claimed by one account is not used by another on the same phone', () => {
    const held = claim(scanned(), { actorId: 'nyibol' });
    expect(nextStep(held, 'ayen', t0 + 1000)).toEqual({ step: 'none' });
    expect(nextStep(held, 'nyibol', t0 + 1000).step).toBe('redeem');
  });

  it('scanning the same code again keeps the choice; a different code replaces it', () => {
    const held = claim(scanned(), 'next-account');
    expect(holdScanned(held, { token }, t0 + 5000).claim).toEqual({ kind: 'next-account' });
    const other = holdScanned(held, { token: 'd'.repeat(64) }, t0 + 5000);
    expect(other.token).toBe('d'.repeat(64));
    expect(other.claim).toEqual({ kind: 'unclaimed' });
  });

  it('is let go after a day, signed in or not', () => {
    const held = claim(scanned(), 'next-account');
    expect(nextStep(held, 'caleb', t0 + HOLD_MS + 1)).toEqual({ step: 'drop' });
    expect(nextStep(held, null, t0 + HOLD_MS + 1)).toEqual({ step: 'drop' });
    // A phone whose clock jumped far backwards does not keep it forever either.
    expect(nextStep(held, 'caleb', t0 - HOLD_MS - 1)).toEqual({ step: 'drop' });
  });
});

describe('what a failed redemption means', () => {
  it('offline or a fault keeps the invite for later', () => {
    // Why: dropping a good invite is the one mistake the person cannot undo.
    for (const m of ['Network request failed', 'TypeError: fetch failed', 'rpc: something odd', 'timed out']) {
      expect(outcomeOfError(m), m).toEqual({ kind: 'retry' });
    }
  });

  it("the server's refusals end it, each with its reason", () => {
    expect(outcomeOfError('invite expired')).toEqual({ kind: 'dead', reason: 'expired' });
    expect(outcomeOfError('invite already used')).toEqual({ kind: 'dead', reason: 'used' });
    expect(outcomeOfError('invite not found')).toEqual({ kind: 'dead', reason: 'not_found' });
    expect(outcomeOfError('invite role is no longer available')).toEqual({ kind: 'dead', reason: 'retired' });
  });

  it('says who to ask for a new one', () => {
    expect(deadMessage('expired', 'Ryder')).toBe('This invite has expired. Ask Ryder for a new one.');
    expect(deadMessage('used')).toBe('This invite has already been used. Ask for a new one.');
  });
});

describe('the invite card', () => {
  it("shows the server's word: who it is for, the role and the language", () => {
    expect(inviteCard({ status: 'ok', label: 'Nyibol Deng', roleName: 'Translator', scopeLevel: 'lane',
      languageName: 'Anglish', orgName: "Ryder's Translation Organization", invitedBy: 'ryderwishart' }))
      .toEqual({ title: 'Invite for Nyibol Deng', detail: "Translator · Anglish · Ryder's Translation Organization", from: 'ryderwishart' });
  });

  it('a group invite is named, not addressed to one person', () => {
    expect(inviteCard({ status: 'ok', label: 'Juba workshop', group: true, roleName: 'Translator', scopeLevel: 'org', orgName: 'Org' }).title)
      .toBe('Juba workshop');
  });

  it('offline, or for an unknown code, claims nothing', () => {
    // Why: a link can be edited by whoever forwards it; only the server's preview is shown as fact.
    expect(inviteCard(null)).toEqual({ title: 'Invitation to join an organization', detail: null, from: null });
    expect(inviteCard({ status: 'not_found' }).detail).toBeNull();
  });
});

describe('the one scanner reads both kinds of key', () => {
  it('tells an invite from a sign-in key', () => {
    expect(parseKey(inviteUri('org1', token))).toEqual({ kind: 'invite', token, orgId: 'org1' });
    expect(parseKey(token)).toEqual({ kind: 'invite', token });
    expect(parseKey(signInUri('e'.repeat(64)))).toEqual({ kind: 'signin', code: 'e'.repeat(64) });
  });

  it('refuses anything else', () => {
    for (const junk of ['', 'hello', 'langquestnext://signin?code=short', 'https://example.com/?code=' + 'e'.repeat(64)]) {
      expect(parseKey(junk), junk).toBeNull();
    }
  });
});

describe('looked-after accounts', () => {
  it('sign in with a sign-in name or an email, in one field', () => {
    expect(signInAddress(' Nyibol-482 ')).toBe(`nyibol-482@${MANAGED_DOMAIN}`);
    expect(signInAddress('Caleb@Example.org')).toBe('caleb@example.org');
  });

  it('are told apart by their address alone', () => {
    expect(isManagedEmail(`nyibol-482@${MANAGED_DOMAIN}`)).toBe(true);
    expect(isManagedEmail('nyibol@gmail.com')).toBe(false);
    expect(isManagedEmail(null)).toBe(false);
    expect(signInName(`nyibol-482@${MANAGED_DOMAIN}`)).toBe('nyibol-482');
    expect(signInName('caleb@example.org')).toBeNull();
  });

  it('get readable sign-in names that survive any script', () => {
    expect(makeSignInName('Nyibol Deng', 482)).toBe('nyibol-deng-482');
    expect(makeSignInName('  Akol  ', 7)).toBe('akol-007');
    expect(makeSignInName('Ñandú José', 1)).toBe('nandu-jose-001');
    expect(makeSignInName('ንጉሥ', 99)).toBe('member-099');
    expect(makeSignInName('a'.repeat(60), 1).length).toBeLessThanOrEqual(28);
  });
});

describe('who may invite', () => {
  const ownerState = {
    members: { me: { role: { value: 'owner', hlc: '', eventId: '' }, removed: { value: false, hlc: '', eventId: '' } } }
  } as unknown as Parameters<typeof deriveSession>[2];

  it('a looked-after account never may, whatever its role says', () => {
    // Why: inviting hands out other people's access; someone with no email of
    // their own cannot be reached if that goes wrong. The server refuses too.
    const managed = deriveSession('me', `nyibol-482@${MANAGED_DOMAIN}`, ownerState, true);
    expect(managed.isManaged).toBe(true);
    expect(managed.can('invite_members')).toBe(false);
    expect(managed.can('manage_structure')).toBe(true);
    const own = deriveSession('me', 'ryder@example.org', ownerState, true);
    expect(own.can('invite_members')).toBe(true);
  });
});
